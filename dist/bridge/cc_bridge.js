#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudePtyEnv, buildFinalClaudeEnv, getClaudeRuntimeCommand, loadClaudeRuntimeEnvFile, } from "../claude/claude_runtime_env.js";
import { BRIDGE_INPUT_KEYS } from "../types.js";
import { CompletionDetector, DEFAULT_COMPLETION_OPTIONS, DONE_MARKER } from "./completion_detector.js";
import { startClaudePty } from "./pty.js";
import { SimpleAnsiTerminalScreen, stripAnsi } from "./terminal_screen.js";
const INBOX_POLL_MS = 100;
const SUBMIT_DELAY_MS = 150;
const EFFECTIVE_OUTPUT_MIN_CHARS = 2;
class CcBridge {
    sessionFile;
    session;
    pty;
    state = "idle";
    screen = new SimpleAnsiTerminalScreen();
    detector = new CompletionDetector();
    lastOutputAt = Date.now();
    lastOutput = "";
    spinnerDetected = false;
    permissionPromptDetected = false;
    suggestedKeys = [];
    active;
    inboxTimer;
    inboxDir;
    streamsDir;
    resultsDir;
    rawOutputLog;
    constructor(sessionFile, session, pty) {
        this.sessionFile = sessionFile;
        this.session = session;
        this.pty = pty;
        this.inboxDir = path.join(this.session.bridge_dir, "inbox");
        this.streamsDir = path.join(this.session.bridge_dir, "streams");
        this.resultsDir = path.join(this.session.bridge_dir, "results");
        this.rawOutputLog = path.join(this.session.bridge_dir, "raw_output.log");
        this.pty.onData((chunk) => this.onPtyOutput(chunk));
        this.pty.onExit(() => this.onPtyExit());
    }
    start() {
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
    processInbox() {
        const requestFile = this.nextRequestFile();
        if (!requestFile)
            return;
        const runningFile = `${requestFile}.processing`;
        let requestId = requestIdFromFile(requestFile);
        try {
            renameSync(requestFile, runningFile);
            const request = this.parseRequest(runningFile);
            requestId = request.request_id;
            this.handleRequest(request);
        }
        catch (error) {
            this.writeImmediateResult(requestId, {
                status: "interrupted",
                error: messageFrom(error),
            });
        }
        finally {
            if (existsSync(runningFile)) {
                try {
                    unlinkSync(runningFile);
                }
                catch { /* non-fatal */ }
            }
        }
    }
    handleRequest(request) {
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
            error: `Unknown request type: ${request.type}`,
        }, request);
    }
    handleSend(request) {
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
    handleInput(request) {
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
    startInteraction(request) {
        const now = Date.now();
        const streamFile = path.join(this.streamsDir, `${request.request_id}.log`);
        const resultFile = path.join(this.resultsDir, `${request.request_id}.json`);
        const debugDir = path.join(this.session.artifact_root, "debug", request.request_id);
        const rawStreamFile = path.join(debugDir, "raw_stream.log");
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(streamFile, "", "utf8");
        writeFileSync(rawStreamFile, "", "utf8");
        writeJsonAtomic(path.join(debugDir, "request.json"), request);
        this.state = "running";
        this.lastOutputAt = now;
        const active = {
            request,
            requestId: request.request_id,
            streamFile,
            resultFile,
            debugDir,
            rawStreamFile,
            sentPromptText: request.type === "send" ? request.prompt ?? "" : request.key ?? "",
            startedAt: now,
            deadlineAt: now + request.timeout_sec * 1_000,
            seenDoneMarker: false,
            effectiveOutputSeen: false,
            inputEchoDetected: false,
            inputEchoOnly: false,
            decisionReason: "started",
            timer: setInterval(() => this.checkCompletion(), DEFAULT_COMPLETION_OPTIONS.checkIntervalMs),
        };
        active.timer.unref();
        this.active = active;
        this.writeState();
        return active;
    }
    sendPromptToClaude(active, prompt) {
        this.pty.write(prompt);
        active.decisionReason = "prompt_written_waiting_for_enter";
        active.submitTimer = setTimeout(() => {
            if (this.active?.requestId !== active.requestId)
                return;
            active.submittedAt = Date.now();
            active.decisionReason = "enter_sent";
            this.pty.write("\r");
            this.writeState();
        }, SUBMIT_DELAY_MS);
        active.submitTimer.unref();
    }
    onPtyOutput(chunk) {
        this.lastOutputAt = Date.now();
        this.lastOutput = tail(`${this.lastOutput}${chunk}`, 4_000);
        appendFileSync(this.rawOutputLog, chunk, "utf8");
        this.screen.feed(chunk);
        if (this.active) {
            if (chunk.includes(DONE_MARKER)) {
                this.active.seenDoneMarker = true;
                this.active.effectiveOutputSeen = true;
                this.active.decisionReason = "done_marker";
            }
            appendFileSync(this.active.streamFile, chunk, "utf8");
            appendFileSync(this.active.rawStreamFile, chunk, "utf8");
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
            }
            else if (this.state !== "exited") {
                this.state = "needs_permission";
            }
        }
        this.writeState();
    }
    onPtyExit() {
        this.state = "exited";
        if (this.active) {
            this.finishActive({ status: "exited" });
        }
        else {
            this.writeState();
        }
    }
    checkCompletion() {
        if (!this.active)
            return;
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
    finishActive(result) {
        if (!this.active)
            return;
        const active = this.active;
        clearInterval(active.timer);
        if (active.submitTimer)
            clearTimeout(active.submitTimer);
        this.active = undefined;
        if (result.status === "completed")
            this.state = "idle";
        else if (result.status === "needs_permission")
            this.state = "needs_permission";
        else if (result.status === "timeout")
            this.state = "timeout";
        else if (result.status === "interrupted")
            this.state = "interrupted";
        else if (result.status === "not_submitted")
            this.state = "not_submitted";
        else if (result.status === "exited")
            this.state = "exited";
        writeJsonAtomic(active.resultFile, result);
        this.writeDebugFinish(active, result);
        this.writeState();
    }
    writeImmediateResult(requestId, result, request) {
        const streamFile = path.join(this.streamsDir, `${requestId}.log`);
        const resultFile = path.join(this.resultsDir, `${requestId}.json`);
        if (!existsSync(streamFile)) {
            writeFileSync(streamFile, "", "utf8");
        }
        writeJsonAtomic(resultFile, result);
        this.writeImmediateDebug(requestId, result, request);
        this.writeState();
    }
    updateActiveOutputDetection(active, chunk, snapshot) {
        const plain = normalizeForDetection(stripAnsi(chunk));
        if (!plain)
            return;
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
        if (!active.submittedAt)
            return;
        const detection = this.detector.inspect(snapshot);
        if (detection.permissionPromptDetected) {
            active.effectiveOutputSeen = true;
            active.inputEchoOnly = false;
            active.decisionReason = "permission_prompt";
            return;
        }
        if (detection.spinnerDetected) {
            active.effectiveOutputSeen = true;
            active.inputEchoOnly = false;
            active.decisionReason = "spinner_or_loading";
            return;
        }
        const effectiveText = removeInputEcho(active.sentPromptText, plain);
        if (hasMeaningfulEffectiveText(effectiveText)) {
            active.effectiveOutputSeen = true;
            active.inputEchoOnly = false;
            active.decisionReason = "effective_output";
        }
    }
    inputBoxStillContainsPrompt(active, snapshot) {
        if (active.request.type !== "send")
            return false;
        if (!active.sentPromptText.trim())
            return false;
        const promptTail = promptNeedle(active.sentPromptText);
        if (!promptTail)
            return false;
        const visibleTail = normalizeForDetection(`${snapshot.text.slice(-1_000)}\n${snapshot.bottom_lines.join("\n")}`);
        return visibleTail.includes(promptTail);
    }
    writeDebugFinish(active, result) {
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
    writeImmediateDebug(requestId, result, request) {
        const debugDir = path.join(this.session.artifact_root, "debug", requestId);
        mkdirSync(debugDir, { recursive: true });
        const snapshot = this.screen.snapshot();
        writeJsonAtomic(path.join(debugDir, "request.json"), request ?? { request_id: requestId });
        writeFileSync(path.join(debugDir, "raw_stream.log"), "", "utf8");
        writeFileSync(path.join(debugDir, "screen_snapshot_at_finish.txt"), snapshot.text, "utf8");
        writeJsonAtomic(path.join(debugDir, "result.json"), result);
        writeJsonAtomic(path.join(debugDir, "decision.json"), {
            status: result.status,
            seen_done_marker: false,
            effective_output_seen: false,
            input_echo_detected: false,
            input_echo_only: false,
            spinner_detected: this.spinnerDetected,
            permission_prompt_detected: this.permissionPromptDetected,
            quiet_ms: DEFAULT_COMPLETION_OPTIONS.quietMs,
            reason: result.status,
        });
    }
    decisionPayload(active, result, snapshot) {
        const now = Date.now();
        return {
            status: result.status,
            seen_done_marker: active.seenDoneMarker,
            effective_output_seen: active.effectiveOutputSeen,
            input_echo_detected: active.inputEchoDetected,
            input_echo_only: active.inputEchoOnly || (!active.effectiveOutputSeen && active.inputEchoDetected),
            spinner_detected: this.spinnerDetected,
            permission_prompt_detected: this.permissionPromptDetected,
            quiet_ms: DEFAULT_COMPLETION_OPTIONS.quietMs,
            submit_grace_ms: DEFAULT_COMPLETION_OPTIONS.submitGraceMs,
            runtime_ms: now - active.startedAt,
            submitted_after_ms: active.submittedAt ? now - active.submittedAt : undefined,
            first_output_after_submit_ms: active.submittedAt && active.firstOutputAfterSubmitAt
                ? active.firstOutputAfterSubmitAt - active.submittedAt
                : undefined,
            input_box_still_contains_prompt: this.inputBoxStillContainsPrompt(active, snapshot),
            reason: active.decisionReason || result.status,
            error: result.error,
        };
    }
    refreshScreenDetection() {
        const detection = this.detector.inspect(this.screen.snapshot());
        this.spinnerDetected = detection.spinnerDetected;
        this.permissionPromptDetected = detection.permissionPromptDetected;
        this.suggestedKeys = detection.suggestedKeys;
    }
    statusPayload() {
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
    writeState() {
        writeJsonAtomic(this.session.bridge_state_file, this.statusPayload());
    }
    nextRequestFile() {
        const first = readdirSync(this.inboxDir)
            .filter((name) => name.endsWith(".json"))
            .sort()[0];
        return first ? path.join(this.inboxDir, first) : undefined;
    }
    parseRequest(requestFile) {
        const parsed = JSON.parse(readFileSync(requestFile, "utf8"));
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
    shutdown() {
        if (this.active) {
            this.finishActive({ status: "interrupted" });
        }
        if (this.inboxTimer)
            clearInterval(this.inboxTimer);
        this.pty.kill("SIGTERM");
        this.writeState();
        process.exit(0);
    }
}
export async function bridgeMain(rawArgs) {
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
function loadBridgeSession(sessionFile) {
    const parsed = JSON.parse(readFileSync(sessionFile, "utf8"));
    const required = [
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
        if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
            throw new Error(`Session file is missing required bridge field: ${key}`);
        }
    }
    if (parsed.version !== 2) {
        throw new Error(`Unsupported session file version: ${parsed.version}`);
    }
    return parsed;
}
function parseBridgeArgs(rawArgs) {
    let sessionFile;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--session-file") {
            if (!next)
                throw new Error("--session-file requires a value.");
            sessionFile = next;
            i++;
        }
        else {
            throw new Error(`Unknown bridge argument: ${arg}`);
        }
    }
    if (!sessionFile)
        throw new Error("--session-file is required.");
    if (!path.isAbsolute(sessionFile)) {
        throw new Error(`--session-file must be an absolute path: ${sessionFile}`);
    }
    return { sessionFile };
}
function watchParent() {
    const parentPid = Number(process.env.CODEX_LEAD_CC_PARENT_PID ?? "");
    if (!Number.isInteger(parentPid) || parentPid <= 0)
        return;
    const timer = setInterval(() => {
        if (!isProcessAlive(parentPid)) {
            process.kill(process.pid, "SIGTERM");
        }
    }, 2_000);
    timer.unref();
}
function writeSessionPatch(sessionFile, patch) {
    try {
        const session = JSON.parse(readFileSync(sessionFile, "utf8"));
        writeJsonAtomic(sessionFile, { ...session, ...patch });
    }
    catch {
        // The bridge can operate without updating diagnostic pid fields.
    }
}
function writeJsonAtomic(filePath, value) {
    const tempPath = `${filePath}.tmp.${process.pid}`;
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tempPath, filePath);
}
function inputKeyToBytes(key) {
    if (key === "1")
        return "1\r";
    if (key === "2")
        return "2\r";
    if (key === "3")
        return "3\r";
    if (key === "enter")
        return "\r";
    if (key === "escape")
        return "\x1b";
    if (key === "ctrl-c")
        return "\x03";
    throw new Error(`Unsupported --key: ${key}`);
}
function isBridgeInputKey(value) {
    return typeof value === "string" && BRIDGE_INPUT_KEYS.includes(value);
}
function trimStatusOutput(value) {
    return value.replace(/\s+$/g, "").slice(-2_000);
}
function tail(value, max) {
    if (value.length <= max)
        return value;
    return value.slice(value.length - max);
}
function requestIdFromFile(requestFile) {
    return path.basename(requestFile).replace(/\.json$/, "");
}
function normalizeForDetection(value) {
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
function promptNeedle(prompt) {
    const normalized = normalizeForDetection(prompt);
    if (!normalized)
        return "";
    const compact = normalized.replace(/\s+/g, " ");
    return compact.slice(Math.max(0, compact.length - 80));
}
function isInputEcho(sentText, plainOutput) {
    const needle = promptNeedle(sentText);
    if (!needle)
        return false;
    const haystack = plainOutput.replace(/\s+/g, " ");
    if (haystack.includes(needle))
        return true;
    if (needle.length > 24 && haystack.includes(needle.slice(-24)))
        return true;
    return false;
}
function removeInputEcho(sentText, plainOutput) {
    const prompt = normalizeForDetection(sentText);
    const promptOneLine = prompt.replace(/\s+/g, " ");
    const promptTail = promptNeedle(sentText);
    let out = plainOutput.replace(/\s+/g, " ");
    for (const part of [promptOneLine, promptTail, promptTail.slice(-40), promptTail.slice(-24)]) {
        if (part)
            out = out.split(part).join(" ");
    }
    return out
        .replace(/\b(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s*/gi, " ")
        .replace(/[>$#]\s*$/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function hasMeaningfulEffectiveText(value) {
    const cleaned = value
        .replace(/\b(?:thinking|loading|processing|waiting|working)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned)
        return false;
    if (/^[|/\\\-.>_$#\s]+$/.test(cleaned))
        return false;
    const meaningfulChars = cleaned.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    return meaningfulChars >= EFFECTIVE_OUTPUT_MIN_CHARS;
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function messageFrom(error) {
    return error instanceof Error ? error.message : String(error);
}
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    bridgeMain(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${messageFrom(error)}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=cc_bridge.js.map