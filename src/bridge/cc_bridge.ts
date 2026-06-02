#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net, { type Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudeWorkerEnv,
  buildFinalClaudeEnv,
  getClaudeRuntimeCommand,
  loadClaudeRuntimeEnvFile,
} from "../claude/claude_runtime_env.js";
import type {
  BridgeCommandResult,
  BridgeStatus,
  BridgeStatusPayload,
  SessionFile,
} from "../types.js";
import { CompletionDetector, DEFAULT_COMPLETION_OPTIONS, DONE_MARKER } from "./completion_detector.js";
import { startClaudePty, type ClaudePty } from "./pty.js";
import { encodeFrame, parseFrame, type BridgeRequest } from "./protocol.js";
import { SimpleAnsiTerminalScreen } from "./terminal_screen.js";

interface BridgeOptions {
  sessionFile: string;
}

interface ActiveInteraction {
  client: Socket;
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
  private server: net.Server | undefined;

  constructor(
    private readonly sessionFile: string,
    private readonly session: SessionFile,
    private readonly pty: ClaudePty,
  ) {
    this.pty.onData((chunk) => this.onPtyOutput(chunk));
    this.pty.onExit(() => this.onPtyExit());
  }

  attach(server: net.Server): void {
    this.server = server;
    server.on("connection", (client) => this.handleClient(client));
    process.on("SIGTERM", () => this.shutdown());
    process.on("SIGINT", () => this.shutdown());
    writeSessionPatch(this.sessionFile, {
      bridge_pid: process.pid,
      cc_pid: this.pty.pid,
    });
  }

  private handleClient(client: Socket): void {
    client.setEncoding("utf8");
    let buffer = "";
    let handled = false;

    client.on("data", (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const raw = buffer.slice(0, newline);
      handled = true;
      this.handleRequest(client, raw).catch((error) => {
        writeFrame(client, { type: "error", error: messageFrom(error) });
        client.end();
      });
    });
  }

  private async handleRequest(client: Socket, raw: string): Promise<void> {
    const request = parseFrame(raw) as BridgeRequest;
    if (request.type === "status") {
      writeFrame(client, { type: "status", status: this.statusPayload() });
      client.end();
      return;
    }
    if (request.type === "send") {
      this.startSend(client, request.prompt, request.timeout_sec);
      return;
    }
    if (request.type === "input") {
      this.startInput(client, request.key, request.timeout_sec);
      return;
    }
    throw new Error("Unknown bridge request.");
  }

  private startSend(client: Socket, prompt: string, timeoutSec: number): void {
    if (this.state === "exited") {
      finishClient(client, { status: "exited" });
      return;
    }
    if (this.active || this.state === "running") {
      finishClient(client, { status: "busy" });
      return;
    }
    if (this.state === "needs_permission") {
      finishClient(client, { status: "needs_permission", suggested_keys: this.suggestedKeys });
      return;
    }

    this.startInteraction(client, timeoutSec);
    this.pty.write(ensureSubmitted(prompt));
  }

  private startInput(client: Socket, key: string, timeoutSec: number): void {
    if (this.state === "exited") {
      finishClient(client, { status: "exited" });
      return;
    }
    if (this.active || this.state === "running") {
      finishClient(client, { status: "busy" });
      return;
    }

    if (key === "1" || key === "2" || key === "3") {
      this.screen.clear();
      this.permissionPromptDetected = false;
      this.suggestedKeys = [];
    }

    this.startInteraction(client, timeoutSec);
    this.pty.write(inputKeyToBytes(key));
  }

  private startInteraction(client: Socket, timeoutSec: number): void {
    const now = Date.now();
    this.state = "running";
    this.lastOutputAt = now;
    const active: ActiveInteraction = {
      client,
      startedAt: now,
      deadlineAt: now + timeoutSec * 1_000,
      seenDoneMarker: false,
      timer: setInterval(() => this.checkCompletion(), DEFAULT_COMPLETION_OPTIONS.checkIntervalMs),
    };
    active.timer.unref();
    this.active = active;

    client.on("close", () => {
      if (this.active?.client !== client) return;
      clearInterval(this.active.timer);
      this.active = undefined;
      if (this.state === "running") this.state = "interrupted";
    });
  }

  private onPtyOutput(chunk: string): void {
    this.lastOutputAt = Date.now();
    this.lastOutput = tail(`${this.lastOutput}${chunk}`, 4_000);
    this.screen.feed(chunk);

    if (this.active) {
      if (chunk.includes(DONE_MARKER)) {
        this.active.seenDoneMarker = true;
      }
      writeFrame(this.active.client, { type: "output", data: chunk });
    }

    this.refreshScreenDetection();
    if (this.permissionPromptDetected) {
      if (this.active) {
        this.finishActive({ status: "needs_permission", suggested_keys: this.suggestedKeys });
      } else if (this.state !== "exited") {
        this.state = "needs_permission";
      }
    }
  }

  private onPtyExit(): void {
    this.state = "exited";
    if (this.active) {
      this.finishActive({ status: "exited" });
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

    finishClient(active.client, result);
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
      last_output: trimStatusOutput(snapshot.text || this.lastOutput),
      bottom_lines: snapshot.bottom_lines,
      spinner_detected: this.spinnerDetected,
      permission_prompt_detected: this.permissionPromptDetected,
      suggested_keys: this.suggestedKeys,
    };
  }

  private shutdown(): void {
    if (this.active) {
      this.finishActive({ status: "interrupted" });
    }
    this.server?.close();
    this.pty.kill("SIGTERM");
    if (existsSync(this.session.bridge_socket)) {
      try { unlinkSync(this.session.bridge_socket); } catch { /* non-fatal */ }
    }
    process.exit(0);
  }
}

export async function bridgeMain(rawArgs: string[]): Promise<void> {
  const options = parseBridgeArgs(rawArgs);
  const session = loadBridgeSession(options.sessionFile);
  const server = await openBridgeServer(session.bridge_socket);
  const loadedClaudeEnv = loadClaudeRuntimeEnvFile(session.claude_env_file);
  const finalClaudeEnv = buildFinalClaudeEnv({
    baseEnv: process.env,
    loadedEnv: loadedClaudeEnv.env,
  });
  const runtime = getClaudeRuntimeCommand(finalClaudeEnv);
  const workerEnv = buildClaudeWorkerEnv(finalClaudeEnv);
  let pty: ClaudePty | undefined;
  try {
    pty = await startClaudePty({
      command: runtime.command,
      args: runtime.argsPrefix,
      cwd: session.project_path,
      env: workerEnv,
    });
    const bridge = new CcBridge(options.sessionFile, session, pty);
    bridge.attach(server);
  } catch (error) {
    server.close();
    if (existsSync(session.bridge_socket)) {
      try { unlinkSync(session.bridge_socket); } catch { /* non-fatal */ }
    }
    pty?.kill("SIGTERM");
    throw error;
  }
  watchParent();
}

function openBridgeServer(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new Error(`Timed out opening CC bridge socket: ${socketPath}`));
    }, 5_000);

    server.on("error", fail);
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
    mkdirSync(path.dirname(socketPath), { recursive: true });
    server.listen(socketPath, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { chmodSync(socketPath, 0o600); } catch { /* non-fatal */ }
      resolve(server);
    });
  });
}

function loadBridgeSession(sessionFile: string): SessionFile {
  const parsed = JSON.parse(readFileSync(sessionFile, "utf8")) as Partial<SessionFile>;
  const required: Array<keyof SessionFile> = [
    "session_id",
    "project_path",
    "supervisor_home",
    "bridge_socket",
    "claude_env_file",
    "created_at",
  ];
  for (const key of required) {
    if (typeof parsed[key] !== "string" || !(parsed[key] as string).trim()) {
      throw new Error(`Session file is missing required bridge field: ${key}`);
    }
  }
  if (parsed.version !== 1) {
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
    writeFileSync(sessionFile, `${JSON.stringify({ ...session, ...patch }, null, 2)}\n`, "utf8");
  } catch {
    // The bridge can operate without updating diagnostic pid fields.
  }
}

function writeFrame(client: Socket, frame: Parameters<typeof encodeFrame>[0]): void {
  client.write(encodeFrame(frame));
}

function finishClient(client: Socket, result: BridgeCommandResult): void {
  writeFrame(client, { type: "result", result });
  client.end();
}

function inputKeyToBytes(key: string): string {
  if (key === "1") return "1\r";
  if (key === "2") return "2\r";
  if (key === "3") return "3\r";
  if (key === "enter") return "\r";
  if (key === "escape") return "\x1b";
  if (key === "ctrl-c") return "\x03";
  throw new Error(`Unsupported --key: ${key}`);
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
