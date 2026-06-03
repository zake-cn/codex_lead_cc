#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudePtyEnv,
  buildFinalClaudeEnv,
  getClaudeRuntimeCommand,
  loadClaudeRuntimeEnvFile,
} from "../claude/claude_runtime_env.js";
import type {
  BridgeCommandResult,
  BridgeInputKey,
  BridgeStatus,
  BridgeStatusPayload,
  SessionFile,
} from "../types.js";
import { BRIDGE_INPUT_KEYS } from "../types.js";
import { CompletionDetector, DEFAULT_COMPLETION_OPTIONS, DONE_MARKER } from "./completion_detector.js";
import { startClaudePty, type ClaudePty } from "./pty.js";
import { SimpleAnsiTerminalScreen } from "./terminal_screen.js";

const INBOX_POLL_MS = 100;

interface BridgeOptions {
  sessionFile: string;
}

interface FileBridgeRequest {
  type: "send" | "input";
  request_id: string;
  prompt?: string;
  key?: BridgeInputKey;
  timeout_sec: number;
  created_at: string;
}

interface ActiveInteraction {
  requestId: string;
  streamFile: string;
  resultFile: string;
  startedAt: number;
  deadlineAt: number;
  seenDoneMarker: boolean;
  timer: ReturnType<typeof setInterval>;
}

class CcBridge {
  private state: BridgeStatus = "idle";
  private readonly screen = new SimpleAnsiTerminalScreen();
  private readonly detector = new CompletionDetector();
  private lastOutputAt = Date.now();
  private lastOutput = "";
  private spinnerDetected = false;
  private permissionPromptDetected = false;
  private suggestedKeys: string[] = [];
  private active: ActiveInteraction | undefined;
  private inboxTimer: ReturnType<typeof setInterval> | undefined;

  private readonly inboxDir: string;
  private readonly streamsDir: string;
  private readonly resultsDir: string;
  private readonly rawOutputLog: string;

  constructor(
    private readonly sessionFile: string,
    private readonly session: SessionFile,
    private readonly pty: ClaudePty,
  ) {
    this.inboxDir = path.join(this.session.bridge_dir, "inbox");
    this.streamsDir = path.join(this.session.bridge_dir, "streams");
    this.resultsDir = path.join(this.session.bridge_dir, "results");
    this.rawOutputLog = path.join(this.session.bridge_dir, "raw_output.log");
    this.pty.onData((chunk) => this.onPtyOutput(chunk));
    this.pty.onExit(() => this.onPtyExit());
  }

  start(): void {
    mkdirSync(this.inboxDir, { recursive: true });
    mkdirSync(this.streamsDir, { recursive: true });
    mkdirSync(this.resultsDir, { recursive: true });
    process.on("SIGTERM", () => this.shutdown());
    process.on("SIGINT", () => this.shutdown());
    writeSessionPatch(this.sessionFile, {
      bridge_pid: process.pid,
      cc_pid: this.pty.pid,
    });
    this.writeState();
    this.inboxTimer = setInterval(() => this.processInbox(), INBOX_POLL_MS);
  }

  private processInbox(): void {
    const requestFile = this.nextRequestFile();
    if (!requestFile) return;

    const runningFile = `${requestFile}.processing`;
    let requestId = requestIdFromFile(requestFile);
    try {
      renameSync(requestFile, runningFile);
      const request = this.parseRequest(runningFile);
      requestId = request.request_id;
      this.handleRequest(request);
    } catch (error) {
      this.writeImmediateResult(requestId, {
        status: "interrupted",
        error: messageFrom(error),
      });
    } finally {
      if (existsSync(runningFile)) {
        try { unlinkSync(runningFile); } catch { /* non-fatal */ }
      }
    }
  }

  private handleRequest(request: FileBridgeRequest): void {
    if (request.type === "send") {
      this.handleSend(request);
      return;
    }
    if (request.type === "input") {
      this.handleInput(request);
      return;
    }
    this.writeImmediateResult(request.request_id, {
      status: "interrupted",
      error: `Unknown request type: ${(request as { type?: unknown }).type}`,
    });
  }

  private handleSend(request: FileBridgeRequest): void {
    if (this.state === "exited") {
      this.writeImmediateResult(request.request_id, { status: "exited" });
      return;
    }
    if (this.active || this.state === "running") {
      this.writeImmediateResult(request.request_id, { status: "busy" });
      return;
    }
    if (this.state === "needs_permission") {
      this.writeImmediateResult(request.request_id, {
        status: "needs_permission",
        suggested_keys: this.suggestedKeys,
      });
      return;
    }
    if (!request.prompt) {
      this.writeImmediateResult(request.request_id, {
        status: "interrupted",
        error: "send request is missing prompt.",
      });
      return;
    }

    this.startInteraction(request);
    this.pty.write(ensureSubmitted(request.prompt));
  }

  private handleInput(request: FileBridgeRequest): void {
    if (this.state === "exited") {
      this.writeImmediateResult(request.request_id, { status: "exited" });
      return;
    }
    if (this.active || this.state === "running") {
      this.writeImmediateResult(request.request_id, { status: "busy" });
      return;
    }
    if (!request.key || !isBridgeInputKey(request.key)) {
      this.writeImmediateResult(request.request_id, {
        status: "interrupted",
        error: "input request has an invalid key.",
      });
      return;
    }

    if (request.key === "1" || request.key === "2" || request.key === "3") {
      this.screen.clear();
      this.permissionPromptDetected = false;
      this.suggestedKeys = [];
    }

    this.startInteraction(request);
    this.pty.write(inputKeyToBytes(request.key));
  }

  private startInteraction(request: FileBridgeRequest): void {
    const now = Date.now();
    const streamFile = path.join(this.streamsDir, `${request.request_id}.log`);
    const resultFile = path.join(this.resultsDir, `${request.request_id}.json`);
    writeFileSync(streamFile, "", "utf8");

    this.state = "running";
    this.lastOutputAt = now;
    const active: ActiveInteraction = {
      requestId: request.request_id,
      streamFile,
      resultFile,
      startedAt: now,
      deadlineAt: now + request.timeout_sec * 1_000,
      seenDoneMarker: false,
      timer: setInterval(() => this.checkCompletion(), DEFAULT_COMPLETION_OPTIONS.checkIntervalMs),
    };
    active.timer.unref();
    this.active = active;
    this.writeState();
  }

  private onPtyOutput(chunk: string): void {
    this.lastOutputAt = Date.now();
    this.lastOutput = tail(`${this.lastOutput}${chunk}`, 4_000);
    appendFileSync(this.rawOutputLog, chunk, "utf8");
    this.screen.feed(chunk);

    if (this.active) {
      if (chunk.includes(DONE_MARKER)) {
        this.active.seenDoneMarker = true;
      }
      appendFileSync(this.active.streamFile, chunk, "utf8");
    }

    this.refreshScreenDetection();
    if (this.permissionPromptDetected) {
      if (this.active) {
        this.finishActive({
          status: "needs_permission",
          suggested_keys: this.suggestedKeys,
        });
      } else if (this.state !== "exited") {
        this.state = "needs_permission";
      }
    }
    this.writeState();
  }

  private onPtyExit(): void {
    this.state = "exited";
    if (this.active) {
      this.finishActive({ status: "exited" });
    } else {
      this.writeState();
    }
  }

  private checkCompletion(): void {
    if (!this.active) return;
    const result = this.detector.check({
      now: Date.now(),
      startedAt: this.active.startedAt,
      lastOutputAt: this.lastOutputAt,
      deadlineAt: this.active.deadlineAt,
      seenDoneMarker: this.active.seenDoneMarker,
      snapshot: this.screen.snapshot(),
    });
    this.refreshScreenDetection();
    this.writeState();
    if (result) {
      this.finishActive(result);
    }
  }

  private finishActive(result: BridgeCommandResult): void {
    if (!this.active) return;
    const active = this.active;
    clearInterval(active.timer);
    this.active = undefined;

    if (result.status === "completed") this.state = "idle";
    else if (result.status === "needs_permission") this.state = "needs_permission";
    else if (result.status === "timeout") this.state = "timeout";
    else if (result.status === "interrupted") this.state = "interrupted";
    else if (result.status === "exited") this.state = "exited";

    writeJsonAtomic(active.resultFile, result);
    this.writeState();
  }

  private writeImmediateResult(requestId: string, result: BridgeCommandResult): void {
    const streamFile = path.join(this.streamsDir, `${requestId}.log`);
    const resultFile = path.join(this.resultsDir, `${requestId}.json`);
    if (!existsSync(streamFile)) {
      writeFileSync(streamFile, "", "utf8");
    }
    writeJsonAtomic(resultFile, result);
    this.writeState();
  }

  private refreshScreenDetection(): void {
    const detection = this.detector.inspect(this.screen.snapshot());
    this.spinnerDetected = detection.spinnerDetected;
    this.permissionPromptDetected = detection.permissionPromptDetected;
    this.suggestedKeys = detection.suggestedKeys;
  }

  private statusPayload(): BridgeStatusPayload {
    this.refreshScreenDetection();
    const snapshot = this.screen.snapshot();
    return {
      status: this.state,
      bridge_pid: process.pid,
      cc_pid: this.pty.pid,
      session_id: this.session.session_id,
      project_label: path.basename(this.session.project_path) || this.session.project_path,
      last_output: trimStatusOutput(snapshot.text || this.lastOutput),
      bottom_lines: snapshot.bottom_lines,
      spinner_detected: this.spinnerDetected,
      permission_prompt_detected: this.permissionPromptDetected,
      suggested_keys: this.suggestedKeys,
    };
  }

  private writeState(): void {
    writeJsonAtomic(this.session.bridge_state_file, this.statusPayload());
  }

  private nextRequestFile(): string | undefined {
    const first = readdirSync(this.inboxDir)
      .filter((name) => name.endsWith(".json"))
      .sort()[0];
    return first ? path.join(this.inboxDir, first) : undefined;
  }

  private parseRequest(requestFile: string): FileBridgeRequest {
    const parsed = JSON.parse(readFileSync(requestFile, "utf8")) as Partial<FileBridgeRequest>;
    if (!parsed.request_id || typeof parsed.request_id !== "string") {
      throw new Error(`Request file is missing request_id: ${requestFile}`);
    }
    if (parsed.type !== "send" && parsed.type !== "input") {
      throw new Error(`Request file has invalid type: ${requestFile}`);
    }
    if (!Number.isInteger(parsed.timeout_sec) || Number(parsed.timeout_sec) <= 0) {
      throw new Error(`Request file has invalid timeout_sec: ${requestFile}`);
    }
    return {
      type: parsed.type,
      request_id: parsed.request_id,
      prompt: parsed.prompt,
      key: parsed.key,
      timeout_sec: Number(parsed.timeout_sec),
      created_at: typeof parsed.created_at === "string" ? parsed.created_at : new Date(0).toISOString(),
    };
  }

  private shutdown(): void {
    if (this.active) {
      this.finishActive({ status: "interrupted" });
    }
    if (this.inboxTimer) clearInterval(this.inboxTimer);
    this.pty.kill("SIGTERM");
    this.writeState();
    process.exit(0);
  }
}

export async function bridgeMain(rawArgs: string[]): Promise<void> {
  const options = parseBridgeArgs(rawArgs);
  const session = loadBridgeSession(options.sessionFile);
  mkdirSync(session.bridge_dir, { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "inbox"), { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "streams"), { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "results"), { recursive: true });

  const loadedClaudeEnv = loadClaudeRuntimeEnvFile(session.claude_env_file);
  const finalClaudeEnv = buildFinalClaudeEnv({
    baseEnv: process.env,
    loadedEnv: loadedClaudeEnv.env,
  });
  const runtime = getClaudeRuntimeCommand(finalClaudeEnv);
  const ptyEnv = buildClaudePtyEnv(finalClaudeEnv);
  const pty = await startClaudePty({
    command: runtime.command,
    args: runtime.argsPrefix,
    cwd: session.project_path,
    env: ptyEnv,
  });
  const bridge = new CcBridge(options.sessionFile, session, pty);
  bridge.start();
  watchParent();
}

function loadBridgeSession(sessionFile: string): SessionFile {
  const parsed = JSON.parse(readFileSync(sessionFile, "utf8")) as Partial<SessionFile>;
  const required: Array<keyof SessionFile> = [
    "session_id",
    "project_path",
    "supervisor_home",
    "session_dir",
    "artifact_root",
    "bridge_dir",
    "bridge_state_file",
    "claude_env_file",
    "created_at",
  ];
  for (const key of required) {
    if (typeof parsed[key] !== "string" || !(parsed[key] as string).trim()) {
      throw new Error(`Session file is missing required bridge field: ${key}`);
    }
  }
  if (parsed.version !== 2) {
    throw new Error(`Unsupported session file version: ${parsed.version}`);
  }
  return parsed as SessionFile;
}

function parseBridgeArgs(rawArgs: string[]): BridgeOptions {
  let sessionFile: string | undefined;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === "--session-file") {
      if (!next) throw new Error("--session-file requires a value.");
      sessionFile = next;
      i++;
    } else {
      throw new Error(`Unknown bridge argument: ${arg}`);
    }
  }
  if (!sessionFile) throw new Error("--session-file is required.");
  if (!path.isAbsolute(sessionFile)) {
    throw new Error(`--session-file must be an absolute path: ${sessionFile}`);
  }
  return { sessionFile };
}

function watchParent(): void {
  const parentPid = Number(process.env.CODEX_LEAD_CC_PARENT_PID ?? "");
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;
  const timer = setInterval(() => {
    if (!isProcessAlive(parentPid)) {
      process.kill(process.pid, "SIGTERM");
    }
  }, 2_000);
  timer.unref();
}

function writeSessionPatch(sessionFile: string, patch: Partial<SessionFile>): void {
  try {
    const session = JSON.parse(readFileSync(sessionFile, "utf8")) as Record<string, unknown>;
    writeJsonAtomic(sessionFile, { ...session, ...patch });
  } catch {
    // The bridge can operate without updating diagnostic pid fields.
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tempPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function inputKeyToBytes(key: BridgeInputKey): string {
  if (key === "1") return "1\r";
  if (key === "2") return "2\r";
  if (key === "3") return "3\r";
  if (key === "enter") return "\r";
  if (key === "escape") return "\x1b";
  if (key === "ctrl-c") return "\x03";
  throw new Error(`Unsupported --key: ${key}`);
}

function isBridgeInputKey(value: unknown): value is BridgeInputKey {
  return typeof value === "string" && (BRIDGE_INPUT_KEYS as readonly string[]).includes(value);
}

function ensureSubmitted(prompt: string): string {
  return prompt.endsWith("\n") || prompt.endsWith("\r") ? `${prompt}\r` : `${prompt}\r`;
}

function trimStatusOutput(value: string): string {
  return value.replace(/\s+$/g, "").slice(-2_000);
}

function tail(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(value.length - max);
}

function requestIdFromFile(requestFile: string): string {
  return path.basename(requestFile).replace(/\.json$/, "");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  bridgeMain(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${messageFrom(error)}\n`);
    process.exitCode = 1;
  });
}
