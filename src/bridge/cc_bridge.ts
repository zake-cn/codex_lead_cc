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
import { SimpleAnsiTerminalScreen, stripAnsi, type TerminalScreenSnapshot } from "./terminal_screen.js";

const INBOX_POLL_MS = 100;
const SUBMIT_DELAY_MS = 150;
const EFFECTIVE_OUTPUT_MIN_CHARS = 2;

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
  request: FileBridgeRequest;
  requestId: string;
  streamFile: string;
  cleanStreamFile: string;
  resultFile: string;
  debugDir: string;
  rawStreamFile: string;
  finalOutputFile: string;
  sentPromptText: string;
  startedAt: number;
  deadlineAt: number;
  seenDoneMarker: boolean;
  submittedAt?: number;
  firstOutputAfterSubmitAt?: number;
  outputAfterStartSeen: boolean;
  effectiveOutputSeen: boolean;
  lastMeaningfulOutputAt?: number;
  inputEchoDetected: boolean;
  inputEchoOnly: boolean;
  decisionReason: string;
  cleanEmittedLineKeys: Set<string>;
  submitTimer?: ReturnType<typeof setTimeout>;
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
    }, request);
  }

  private handleSend(request: FileBridgeRequest): void {
    if (this.state === "exited") {
      this.writeImmediateResult(request.request_id, { status: "exited" }, request);
      return;
    }
    if (this.active || this.state === "running") {
      this.writeImmediateResult(request.request_id, { status: "busy" }, request);
      return;
    }
    if (this.state === "needs_permission") {
      this.writeImmediateResult(request.request_id, {
        status: "needs_permission",
        suggested_keys: this.suggestedKeys,
      }, request);
      return;
    }
    if (!request.prompt) {
      this.writeImmediateResult(request.request_id, {
        status: "interrupted",
        error: "send request is missing prompt.",
      }, request);
      return;
    }

    const active = this.startInteraction(request);
    this.sendPromptToClaude(active, request.prompt);
  }

  private handleInput(request: FileBridgeRequest): void {
    if (this.state === "exited") {
      this.writeImmediateResult(request.request_id, { status: "exited" }, request);
      return;
    }
    if (this.active || this.state === "running") {
      this.writeImmediateResult(request.request_id, { status: "busy" }, request);
      return;
    }
    if (!request.key || !isBridgeInputKey(request.key)) {
      this.writeImmediateResult(request.request_id, {
        status: "interrupted",
        error: "input request has an invalid key.",
      }, request);
      return;
    }

    if (request.key === "1" || request.key === "2" || request.key === "3") {
      this.screen.clear();
      this.permissionPromptDetected = false;
      this.suggestedKeys = [];
    }

    const active = this.startInteraction(request);
    active.submittedAt = Date.now();
    active.decisionReason = "input_sent";
    this.pty.write(inputKeyToBytes(request.key));
    this.writeState();
  }

  private startInteraction(request: FileBridgeRequest): ActiveInteraction {
    const now = Date.now();
    const streamFile = path.join(this.streamsDir, `${request.request_id}.log`);
    const resultFile = path.join(this.resultsDir, `${request.request_id}.json`);
    const debugDir = path.join(this.session.artifact_root, "debug", request.request_id);
    const rawStreamFile = path.join(debugDir, "raw_stream.log");
    const finalOutputFile = path.join(debugDir, "final_output.txt");
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(streamFile, "", "utf8");
    writeFileSync(rawStreamFile, "", "utf8");
    writeFileSync(finalOutputFile, "", "utf8");
    writeJsonAtomic(path.join(debugDir, "request.json"), request);

    this.state = "running";
    this.lastOutputAt = now;
    this.detector.reset();
    const active: ActiveInteraction = {
      request,
      requestId: request.request_id,
      streamFile,
      cleanStreamFile: streamFile,
      resultFile,
      debugDir,
      rawStreamFile,
      finalOutputFile,
      sentPromptText: request.type === "send" ? request.prompt ?? "" : request.key ?? "",
      startedAt: now,
      deadlineAt: now + request.timeout_sec * 1_000,
      seenDoneMarker: false,
      outputAfterStartSeen: false,
      effectiveOutputSeen: false,
      inputEchoDetected: false,
      inputEchoOnly: false,
      decisionReason: "started",
      cleanEmittedLineKeys: new Set<string>(),
      timer: setInterval(() => this.checkCompletion(), DEFAULT_COMPLETION_OPTIONS.checkIntervalMs),
    };
    active.timer.unref();
    this.active = active;
    this.writeState();
    return active;
  }

  private sendPromptToClaude(active: ActiveInteraction, prompt: string): void {
    this.pty.write(prompt);
    active.decisionReason = "prompt_written_waiting_for_enter";
    active.submitTimer = setTimeout(() => {
      if (this.active?.requestId !== active.requestId) return;
      active.submittedAt = Date.now();
      active.decisionReason = "enter_sent";
      this.pty.write("\r");
      this.writeState();
    }, SUBMIT_DELAY_MS);
    active.submitTimer.unref();
  }

  private onPtyOutput(chunk: string): void {
    this.lastOutputAt = Date.now();
    this.lastOutput = tail(`${this.lastOutput}${chunk}`, 4_000);
    appendFileSync(this.rawOutputLog, chunk, "utf8");
    this.screen.feed(chunk);

    if (this.active) {
      if (chunk.includes(DONE_MARKER)) {
        this.active.seenDoneMarker = true;
        this.active.effectiveOutputSeen = true;
        this.active.lastMeaningfulOutputAt = Date.now();
        this.active.decisionReason = "done_marker";
      }
      appendFileSync(this.active.rawStreamFile, chunk, "utf8");
      const cleanOutput = cleanChunkForClient(this.active, chunk);
      if (cleanOutput) appendFileSync(this.active.cleanStreamFile, cleanOutput, "utf8");
    }

    this.refreshScreenDetection();
    if (this.active) {
      this.updateActiveOutputDetection(this.active, chunk, this.screen.snapshot());
    }
    if (this.permissionPromptDetected) {
      if (this.active) {
        this.active.effectiveOutputSeen = true;
        this.active.decisionReason = "permission_prompt";
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
    const snapshot = this.screen.snapshot();
    const inputBoxStillContainsPrompt = this.inputBoxStillContainsPrompt(this.active, snapshot);
    if (inputBoxStillContainsPrompt && !this.active.effectiveOutputSeen) {
      this.active.decisionReason = "input_box_still_contains_prompt";
    }
    let result = this.detector.check({
      now: Date.now(),
      startedAt: this.active.startedAt,
      submittedAt: this.active.submittedAt,
      lastOutputAt: this.lastOutputAt,
      deadlineAt: this.active.deadlineAt,
      seenDoneMarker: this.active.seenDoneMarker,
      effectiveOutputSeen: this.active.effectiveOutputSeen,
      inputBoxStillContainsPrompt,
      snapshot,
    });
    this.refreshScreenDetection();
    this.writeState();
    if (result) {
      if (result.status === "timeout") {
        this.active.decisionReason = !this.active.effectiveOutputSeen
          ? "timeout_no_effective_output"
          : this.spinnerDetected
            ? "timeout_current_spinner_detected"
            : "timeout_waiting_for_quiet_window";
      }
      if (result.status === "not_submitted" && this.active.decisionReason === "enter_sent") {
        this.active.decisionReason = inputBoxStillContainsPrompt ? "input_echo_only" : "no_effective_output";
      }
      if (result.status === "not_submitted" && this.active.request.type === "input") {
        result = {
          ...result,
          error: "Input did not produce effective Claude Code output.",
        };
      }
      this.finishActive(result);
    }
  }

  private finishActive(result: BridgeCommandResult): void {
    if (!this.active) return;
    const active = this.active;
    clearInterval(active.timer);
    if (active.submitTimer) clearTimeout(active.submitTimer);
    this.active = undefined;

    if (result.status === "completed") this.state = "idle";
    else if (result.status === "needs_permission") this.state = "needs_permission";
    else if (result.status === "timeout") this.state = "timeout";
    else if (result.status === "interrupted") this.state = "interrupted";
    else if (result.status === "not_submitted") this.state = "not_submitted";
    else if (result.status === "exited") this.state = "exited";

    const finalOutput = this.buildFinalOutput(active, result);
    writeFileSync(active.finalOutputFile, finalOutput, "utf8");
    const finalResult: BridgeCommandResult = {
      ...result,
      output_file: active.finalOutputFile,
      raw_output_file: active.rawStreamFile,
    };
    writeJsonAtomic(active.resultFile, finalResult);
    this.writeDebugFinish(active, finalResult);
    this.writeState();
  }

  private writeImmediateResult(
    requestId: string,
    result: BridgeCommandResult,
    request?: Partial<FileBridgeRequest>,
  ): void {
    const streamFile = path.join(this.streamsDir, `${requestId}.log`);
    const resultFile = path.join(this.resultsDir, `${requestId}.json`);
    const debugDir = path.join(this.session.artifact_root, "debug", requestId);
    const rawOutputFile = path.join(debugDir, "raw_stream.log");
    const finalOutputFile = path.join(debugDir, "final_output.txt");
    mkdirSync(debugDir, { recursive: true });
    if (!existsSync(streamFile)) {
      writeFileSync(streamFile, "", "utf8");
    }
    if (!existsSync(rawOutputFile)) writeFileSync(rawOutputFile, "", "utf8");
    const finalOutput = this.buildImmediateOutput(result);
    writeFileSync(finalOutputFile, finalOutput, "utf8");
    const finalResult: BridgeCommandResult = {
      ...result,
      output_file: finalOutputFile,
      raw_output_file: rawOutputFile,
    };
    writeJsonAtomic(resultFile, finalResult);
    this.writeImmediateDebug(requestId, finalResult, request);
    this.writeState();
  }

  private buildFinalOutput(active: ActiveInteraction, result: BridgeCommandResult): string {
    const snapshot = this.screen.snapshot();
    const cleanStream = existsSync(active.cleanStreamFile)
      ? readFileSync(active.cleanStreamFile, "utf8")
      : "";
    const streamOutput = cleanFinalText(cleanStream, active.sentPromptText);

    if (result.status === "needs_permission") {
      return buildPermissionOutput(streamOutput, snapshot, active.sentPromptText);
    }

    const screenOutput = cleanFinalText(snapshot.text, active.sentPromptText);
    let output = streamOutput || screenOutput;
    if (["timeout", "interrupted", "not_submitted", "exited"].includes(result.status)) {
      output = tailMeaningfulLines(output, 30);
      const summary = result.error || terminalStatusSummary(result.status);
      if (summary && !output.includes(summary)) {
        output = [output, summary].filter(Boolean).join("\n");
      }
    }
    return output ? `${output.replace(/\s+$/g, "")}\n` : "";
  }

  private buildImmediateOutput(result: BridgeCommandResult): string {
    if (result.status === "needs_permission") {
      return buildPermissionOutput("", this.screen.snapshot());
    }
    const summary = result.error || terminalStatusSummary(result.status);
    return summary ? `${summary.replace(/\s+$/g, "")}\n` : "";
  }

  private updateActiveOutputDetection(
    active: ActiveInteraction,
    chunk: string,
    snapshot: TerminalScreenSnapshot,
  ): void {
    const plain = normalizeForDetection(stripAnsi(chunk));
    if (!plain) return;
    active.outputAfterStartSeen = true;

    if (active.submittedAt && !active.firstOutputAfterSubmitAt) {
      active.firstOutputAfterSubmitAt = Date.now();
    }

    if (isInputEcho(active.sentPromptText, plain)) {
      active.inputEchoDetected = true;
      if (!active.effectiveOutputSeen) {
        active.inputEchoOnly = true;
        active.decisionReason = "input_echo_detected";
      }
    }

    if (!active.submittedAt) return;

    const detection = this.detector.inspect(snapshot);
    if (detection.permissionPromptDetected) {
      active.effectiveOutputSeen = true;
      active.inputEchoOnly = false;
      active.lastMeaningfulOutputAt = Date.now();
      active.decisionReason = "permission_prompt";
      return;
    }
    if (detection.spinnerDetected) {
      active.effectiveOutputSeen = true;
      active.inputEchoOnly = false;
      active.lastMeaningfulOutputAt = Date.now();
      active.decisionReason = "spinner_or_loading";
      return;
    }

    const effectiveText = removeInputEcho(active.sentPromptText, plain);
    if (hasMeaningfulEffectiveText(effectiveText)) {
      active.effectiveOutputSeen = true;
      active.inputEchoOnly = false;
      active.lastMeaningfulOutputAt = Date.now();
      active.decisionReason = "effective_output";
    }
  }

  private inputBoxStillContainsPrompt(
    active: ActiveInteraction,
    snapshot: TerminalScreenSnapshot,
  ): boolean {
    if (active.request.type !== "send") return false;
    if (!active.sentPromptText.trim()) return false;
    const promptTail = promptNeedle(active.sentPromptText);
    if (!promptTail) return false;
    const visibleTail = normalizeForDetection(
      `${snapshot.text.slice(-1_000)}\n${snapshot.bottom_lines.join("\n")}`,
    );
    return visibleTail.includes(promptTail);
  }

  private writeDebugFinish(active: ActiveInteraction, result: BridgeCommandResult): void {
    const snapshot = this.screen.snapshot();
    writeFileSync(path.join(active.debugDir, "screen_snapshot_at_finish.txt"), [
      "## bottom_lines",
      ...snapshot.bottom_lines,
      "",
      "## screen",
      snapshot.text,
      "",
      "## raw_tail",
      stripAnsi(snapshot.raw_tail),
    ].join("\n"), "utf8");
    writeJsonAtomic(path.join(active.debugDir, "result.json"), result);
    writeJsonAtomic(path.join(active.debugDir, "decision.json"), this.decisionPayload(active, result, snapshot));
  }

  private writeImmediateDebug(
    requestId: string,
    result: BridgeCommandResult,
    request?: Partial<FileBridgeRequest>,
  ): void {
    const debugDir = path.join(this.session.artifact_root, "debug", requestId);
    const snapshot = this.screen.snapshot();
    writeJsonAtomic(path.join(debugDir, "request.json"), request ?? { request_id: requestId });
    writeFileSync(path.join(debugDir, "screen_snapshot_at_finish.txt"), snapshot.text, "utf8");
    writeJsonAtomic(path.join(debugDir, "result.json"), result);
    writeJsonAtomic(path.join(debugDir, "decision.json"), {
      request_id: requestId,
      status: result.status,
      reason: result.status,
      seen_done_marker: false,
      effective_output_seen: false,
      input_echo_detected: false,
      input_echo_only: false,
      spinner_detected: this.spinnerDetected,
      permission_prompt_detected: this.permissionPromptDetected,
      quiet_ms: DEFAULT_COMPLETION_OPTIONS.quietMs,
      bottom_lines: snapshot.bottom_lines,
      raw_tail_contains_esc_to_interrupt: /esc to interrupt/i.test(stripAnsi(snapshot.raw_tail)),
      raw_tail_ignored_for_spinner: true,
    });
  }

  private decisionPayload(
    active: ActiveInteraction,
    result: BridgeCommandResult,
    snapshot: TerminalScreenSnapshot,
  ): Record<string, unknown> {
    const now = Date.now();
    return {
      request_id: active.requestId,
      status: result.status,
      reason: active.decisionReason || result.status,
      seen_done_marker: active.seenDoneMarker,
      output_after_start_seen: active.outputAfterStartSeen,
      effective_output_seen: active.effectiveOutputSeen,
      input_echo_detected: active.inputEchoDetected,
      input_echo_only: active.inputEchoOnly || (!active.effectiveOutputSeen && active.inputEchoDetected),
      spinner_detected: this.spinnerDetected,
      permission_prompt_detected: this.permissionPromptDetected,
      quiet_ms: DEFAULT_COMPLETION_OPTIONS.quietMs,
      submit_grace_ms: DEFAULT_COMPLETION_OPTIONS.submitGraceMs,
      bottom_lines: snapshot.bottom_lines,
      raw_tail_contains_esc_to_interrupt: /esc to interrupt/i.test(stripAnsi(snapshot.raw_tail)),
      raw_tail_ignored_for_spinner: true,
      runtime_ms: now - active.startedAt,
      submitted_after_ms: active.submittedAt ? now - active.submittedAt : undefined,
      first_output_after_submit_ms:
        active.submittedAt && active.firstOutputAfterSubmitAt
          ? active.firstOutputAfterSubmitAt - active.submittedAt
          : undefined,
      last_meaningful_output_after_submit_ms:
        active.submittedAt && active.lastMeaningfulOutputAt
          ? active.lastMeaningfulOutputAt - active.submittedAt
          : undefined,
      input_box_still_contains_prompt: this.inputBoxStillContainsPrompt(active, snapshot),
      error: result.error,
    };
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
      last_output: trimStatusOutput(cleanStatusText(snapshot.text || this.lastOutput)),
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

function normalizeForDetection(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u001b\[[?]2004[hl]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function promptNeedle(prompt: string): string {
  const normalized = normalizeForDetection(prompt);
  if (!normalized) return "";
  const compact = normalized.replace(/\s+/g, " ");
  return compact.slice(Math.max(0, compact.length - 80));
}

function isInputEcho(sentText: string, plainOutput: string): boolean {
  const needle = promptNeedle(sentText);
  if (!needle) return false;
  const haystack = plainOutput.replace(/\s+/g, " ");
  if (needle.length < 8) {
    const withoutPrompt = haystack
      .replace(/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#>]\s*/i, "")
      .replace(/^>\s*/, "")
      .trim();
    return withoutPrompt === needle;
  }
  if (haystack.includes(needle)) return true;
  if (needle.length > 24 && haystack.includes(needle.slice(-24))) return true;
  return false;
}

function removeInputEcho(sentText: string, plainOutput: string): string {
  const prompt = normalizeForDetection(sentText);
  const promptOneLine = prompt.replace(/\s+/g, " ");
  const promptTail = promptNeedle(sentText);
  let out = plainOutput.replace(/\s+/g, " ");
  for (const part of [promptOneLine, promptTail, promptTail.slice(-40), promptTail.slice(-24)]) {
    if (part) out = out.split(part).join(" ");
  }
  return out
    .replace(/\b(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s*/gi, " ")
    .replace(/[>$#]\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMeaningfulEffectiveText(value: string): boolean {
  const cleaned = value
    .replace(/\b(?:thinking|loading|processing|waiting|working)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return false;
  if (/^[|/\\\-.>_$#\s]+$/.test(cleaned)) return false;
  const meaningfulChars = cleaned.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return meaningfulChars >= EFFECTIVE_OUTPUT_MIN_CHARS;
}

function cleanChunkForClient(active: ActiveInteraction, chunk: string): string {
  const stripped = stripAnsi(chunk)
    .replace(/\r/g, "\n")
    .replace(/\u001b\[[?]2004[hl]/g, "");
  const out: string[] = [];
  for (const rawLine of stripped.split("\n")) {
    const line = cleanClientLine(rawLine);
    if (!line) continue;
    if (isInputEcho(active.sentPromptText, line)) continue;
    if (isTuiNoiseLine(line)) continue;
    const key = normalizeClientLine(line);
    if (!key || (key.length >= 4 && active.cleanEmittedLineKeys.has(key))) continue;
    if (key.length >= 4) active.cleanEmittedLineKeys.add(key);
    out.push(line);
  }
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}

function cleanStatusText(value: string): string {
  const lines = stripAnsi(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .map(cleanClientLine)
    .filter((line) => line && !isTuiNoiseLine(line));
  return lines.slice(-20).join("\n");
}

function cleanFinalText(value: string, sentText: string): string {
  const promptLines = new Set(
    normalizeForDetection(sentText)
      .split("\n")
      .map(normalizeClientLine)
      .filter(Boolean),
  );
  const candidateLines: string[] = [];
  for (const rawLine of stripAnsi(value).replace(/\r/g, "\n").split("\n")) {
    let line = cleanClientLine(rawLine);
    if (!line || line.includes(DONE_MARKER) || isTuiNoiseLine(line)) continue;
    const normalized = normalizeClientLine(line);
    if (promptLines.has(normalized) || isInputEcho(sentText, normalized)) continue;

    const normalizedPrompt = normalizeForDetection(sentText).replace(/\s+/g, " ");
    if (normalizedPrompt && normalized.includes(normalizedPrompt)) {
      line = line.replace(normalizedPrompt, "").trim();
    }
    if (line) candidateLines.push(line);
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of stripLeadingPromptEchoFragments(candidateLines, sentText)) {
    const key = normalizeClientLine(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n").trim();
}

function stripLeadingPromptEchoFragments(lines: string[], sentText: string): string[] {
  const prompt = normalizeForDetection(sentText).replace(/\s+/g, "");
  if (!prompt || lines.length === 0) return lines;

  let joined = "";
  for (let index = 0; index < Math.min(lines.length, 100); index++) {
    const fragment = normalizeClientLine(lines[index]).replace(/^>\s*/, "").replace(/\s+/g, "");
    if (!fragment || !prompt.startsWith(`${joined}${fragment}`)) return lines;
    joined += fragment;
    if (joined === prompt) return lines.slice(index + 1);
  }
  return lines;
}

function buildPermissionOutput(
  cleanStream: string,
  snapshot: TerminalScreenSnapshot,
  sentText = "",
): string {
  const visible = cleanFinalText(
    `${cleanStream}\n${snapshot.bottom_lines.slice(-12).join("\n")}\n${snapshot.text}`,
    sentText,
  );
  const lines = visible.split("\n").map((line) => line.trim()).filter(Boolean);
  const optionOne = lines.findIndex((line) => /^1[.)]\s+/.test(line));
  const optionTwo = lines.findIndex((line) => /^2[.)]\s+/.test(line));
  const optionThree = lines.findIndex((line) => /^3[.)]\s+/.test(line));
  const menuComplete = optionOne >= 0 && optionTwo > optionOne && optionThree > optionTwo;
  const options = menuComplete
    ? [lines[optionOne], lines[optionTwo], lines[optionThree]]
    : ["1. Yes", "2. Yes, and don't ask again", "3. No"];
  const descriptionEnd = menuComplete ? optionOne : lines.length;
  const description = lines
    .slice(Math.max(0, descriptionEnd - 6), descriptionEnd)
    .filter((line) => !/^Claude Code 请求权限[:：]?$/i.test(line))
    .filter((line) => !/^\d[.)]\s+/.test(line))
    .filter((line) => !looksLikePromptFragment(sentText, line));
  const body = [
    "Claude Code 请求权限：",
    ...description,
    ...options,
  ].join("\n");
  return `${body.replace(/\s+$/g, "")}\n`;
}

function looksLikePromptFragment(sentText: string, line: string): boolean {
  const prompt = normalizeForDetection(sentText).replace(/\s+/g, " ").toLowerCase();
  const candidate = normalizeClientLine(line).toLowerCase();
  return Boolean(prompt && candidate && prompt.includes(candidate));
}

function tailMeaningfulLines(value: string, maxLines: number): string {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .filter(Boolean)
    .slice(-maxLines)
    .join("\n");
}

function terminalStatusSummary(status: BridgeCommandResult["status"]): string {
  if (status === "timeout") return "Claude Code bridge round timed out.";
  if (status === "interrupted") return "Claude Code bridge round was interrupted.";
  if (status === "not_submitted") return "Claude Code input produced no effective output.";
  if (status === "exited") return "Claude Code process exited.";
  if (status === "busy") return "Claude Code bridge is busy with another round.";
  return "";
}

function cleanClientLine(value: string): string {
  return value
    .replace(/[\u001b\x9b][^\n]*/g, "")
    .replace(/^[│┃]\s?/u, "")
    .replace(/\s?[│┃]$/u, "")
    .replace(/\s+$/g, "")
    .trim();
}

function normalizeClientLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isTuiNoiseLine(line: string): boolean {
  const normalized = normalizeClientLine(line);
  if (!normalized) return true;
  if (/^[╭╮╰╯│─┌┐└┘├┤┬┴┼═║╔╗╚╝+\-\s]+$/u.test(normalized)) return true;
  if (/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s*$/i.test(normalized)) return true;
  if (/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s+\S/i.test(normalized)) return true;
  if (/^\W*(?:esc to interrupt|press esc|ctrl-c to|\? for shortcuts)\b/i.test(normalized)) return true;
  if (/\b(?:esc to interrupt|press esc|ctrl-c to|\? for shortcuts|auto-accept edits|bypass permissions)\b/i.test(normalized)) {
    return true;
  }
  if (/^[|/\\\-⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●✶✽·\s]+$/u.test(normalized)) return true;
  if (/^(?:thinking|loading|processing|waiting|working)\b/i.test(normalized)) return true;
  return false;
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
