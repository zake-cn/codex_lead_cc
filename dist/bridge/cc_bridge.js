#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudePtyEnv, buildFinalClaudeEnv, getClaudeRuntimeCommand, loadClaudeRuntimeEnvFile, } from "../claude/claude_runtime_env.js";
import { BRIDGE_INPUT_KEYS } from "../types.js";
import { CompletionDetector, DEFAULT_COMPLETION_OPTIONS, DONE_MARKER, detectPermissionPrompt, detectSpinner } from "./completion_detector.js";
import { startClaudePty } from "./pty.js";
import { SimpleAnsiTerminalScreen, stripAnsi } from "./terminal_screen.js";
const INBOX_POLL_MS = 100;
const SUBMIT_DELAY_MS = 150;
const EFFECTIVE_OUTPUT_MIN_CHARS = 2;
export class CcBridge {
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
    // Bug 4: stale-state recovery timer.  Runs after timeout/interrupted/
    // not_submitted to poll the screen and transition back to idle once
    // Claude Code has recovered.
    recoveryTimer;
    // TEST-ONLY gate: when true onPtyExit is a no-op so rmSync in tests
    // can proceed without a late exit event writing into a deleted dir.
    disposingForTest = false;
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
        // Allow interrupt keys (ctrl-c, escape) to bypass busy protection so the
        // user can stop a running Claude Code session.  Normal input keys are
        // still blocked — only one round at a time.
        if (this.active || this.state === "running") {
            if (request.key === "ctrl-c" || request.key === "escape") {
                // Send the interrupt to PTY and finish the active round.
                // The original cc-send waiter gets an "interrupted" result so it
                // doesn't have to wait for timeout.
                this.pty.write(inputKeyToBytes(request.key));
                this.writeImmediateResult(request.request_id, { status: "completed" }, request);
                this.finishActive({ status: "interrupted" });
                return;
            }
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
        const finalOutputFile = path.join(debugDir, "final_output.txt");
        mkdirSync(debugDir, { recursive: true });
        writeFileSync(streamFile, "", "utf8");
        writeFileSync(rawStreamFile, "", "utf8");
        writeFileSync(finalOutputFile, "", "utf8");
        writeJsonAtomic(path.join(debugDir, "request.json"), request);
        this.state = "running";
        this.lastOutputAt = now;
        this.detector.reset();
        // Bug 4: cancel any stale-state recovery — a new active round is starting.
        this.cancelRecoveryTimer();
        const active = {
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
            cleanEmittedLineKeys: new Set(),
            echoBoundaryReached: false,
            consumedEchoChars: "",
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
                this.active.lastMeaningfulOutputAt = Date.now();
                this.active.decisionReason = "done_marker";
            }
            appendFileSync(this.active.rawStreamFile, chunk, "utf8");
            const cleanOutput = cleanChunkForClient(this.active, chunk);
            if (cleanOutput)
                appendFileSync(this.active.cleanStreamFile, cleanOutput, "utf8");
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
                // Bug 4: a new permission prompt replaces stale-state recovery.
                this.cancelRecoveryTimer();
            }
        }
        this.writeState();
    }
    onPtyExit() {
        // TEST-ONLY: when disposing, the temp dir may already be gone.
        // Don't touch state or write any files.
        if (this.disposingForTest)
            return;
        this.state = "exited";
        this.cancelRecoveryTimer();
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
        // Bug 4: the result file MUST preserve the original status (timeout /
        // interrupted / not_submitted) for the caller.  Below we start a
        // background recovery timer that may later refresh the persistent
        // state to idle — but it never rewrites this result file.
        const finalOutput = this.buildFinalOutput(active, result);
        writeFileSync(active.finalOutputFile, finalOutput, "utf8");
        const finalResult = {
            ...result,
            output_file: active.finalOutputFile,
            raw_output_file: active.rawStreamFile,
        };
        writeJsonAtomic(active.resultFile, finalResult);
        this.writeDebugFinish(active, finalResult);
        this.writeState();
        // Start background recovery: if Claude Code finishes after a timeout /
        // interrupt, the persistent state can eventually return to idle.
        if (result.status === "timeout" ||
            result.status === "interrupted" ||
            result.status === "not_submitted") {
            this.startRecoveryTimer();
        }
    }
    writeImmediateResult(requestId, result, request) {
        const streamFile = path.join(this.streamsDir, `${requestId}.log`);
        const resultFile = path.join(this.resultsDir, `${requestId}.json`);
        const debugDir = path.join(this.session.artifact_root, "debug", requestId);
        const rawOutputFile = path.join(debugDir, "raw_stream.log");
        const finalOutputFile = path.join(debugDir, "final_output.txt");
        mkdirSync(debugDir, { recursive: true });
        if (!existsSync(streamFile)) {
            writeFileSync(streamFile, "", "utf8");
        }
        if (!existsSync(rawOutputFile))
            writeFileSync(rawOutputFile, "", "utf8");
        const finalOutput = this.buildImmediateOutput(result);
        writeFileSync(finalOutputFile, finalOutput, "utf8");
        const finalResult = {
            ...result,
            output_file: finalOutputFile,
            raw_output_file: rawOutputFile,
        };
        writeJsonAtomic(resultFile, finalResult);
        this.writeImmediateDebug(requestId, finalResult, request);
        this.writeState();
    }
    buildFinalOutput(active, result) {
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
    buildImmediateOutput(result) {
        if (result.status === "needs_permission") {
            return buildPermissionOutput("", this.screen.snapshot());
        }
        const summary = result.error || terminalStatusSummary(result.status);
        return summary ? `${summary.replace(/\s+$/g, "")}\n` : "";
    }
    updateActiveOutputDetection(active, chunk, snapshot) {
        const plain = normalizeForDetection(stripAnsi(chunk));
        if (!plain)
            return;
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
        if (!active.submittedAt)
            return;
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
    decisionPayload(active, result, snapshot) {
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
            first_output_after_submit_ms: active.submittedAt && active.firstOutputAfterSubmitAt
                ? active.firstOutputAfterSubmitAt - active.submittedAt
                : undefined,
            last_meaningful_output_after_submit_ms: active.submittedAt && active.lastMeaningfulOutputAt
                ? active.lastMeaningfulOutputAt - active.submittedAt
                : undefined,
            input_box_still_contains_prompt: this.inputBoxStillContainsPrompt(active, snapshot),
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
            last_output: trimStatusOutput(cleanStatusText(snapshot.text || this.lastOutput)),
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
    // ── Bug 4: stale-state recovery ──
    startRecoveryTimer() {
        if (this.recoveryTimer)
            return; // already running
        this.recoveryTimer = setInterval(() => {
            this.tickRecovery();
        }, DEFAULT_COMPLETION_OPTIONS.checkIntervalMs);
        this.recoveryTimer.unref();
    }
    // now parameter allows fake-timer injection in tests.
    tickRecovery(now) {
        // Guard: a new round or state transition already took over.
        if (this.active) {
            this.cancelRecoveryTimer();
            return;
        }
        if (this.state !== "timeout" &&
            this.state !== "interrupted" &&
            this.state !== "not_submitted") {
            this.cancelRecoveryTimer();
            return;
        }
        // Use stateless helpers (no sticky spinner history) so the decision
        // depends ONLY on the currently visible bottom area.
        const snapshot = this.screen.snapshot();
        const spinnerNow = detectSpinner(snapshot);
        const permissionNow = detectPermissionPrompt(snapshot);
        if (permissionNow.detected) {
            // Permission menu appeared after the round finished — surface it.
            this.state = "needs_permission";
            this.permissionPromptDetected = true;
            this.suggestedKeys = permissionNow.suggestedKeys;
            this.cancelRecoveryTimer();
            this.writeState();
            return;
        }
        const nowEffective = now ?? Date.now();
        const quietFor = nowEffective - this.lastOutputAt;
        if (!spinnerNow && quietFor >= DEFAULT_COMPLETION_OPTIONS.quietMs) {
            // Screen is clean and quiet — Claude Code is back at the prompt.
            this.state = "idle";
            this.spinnerDetected = false;
            this.cancelRecoveryTimer();
            this.writeState();
        }
    }
    cancelRecoveryTimer() {
        if (this.recoveryTimer) {
            clearInterval(this.recoveryTimer);
            this.recoveryTimer = undefined;
        }
    }
    // ── Test-only: safe disposal without state writes ──
    /**
     * TEST-ONLY.  Cancel all timers, drop the active interaction silently,
     * and stop the PTY so the test harness can safely remove the temp
     * session directory.  Does NOT call finishActive / writeState /
     * writeJsonAtomic — no result files are created or overwritten.
     *
     * Callers MUST `await` a short event-loop tick after this returns
     * before rmSync'ing the session directory, so any in-flight PTY exit
     * event (which is a no-op thanks to the disposingForTest gate) has
     * time to settle.
     */
    disposeForTest() {
        this.disposingForTest = true;
        this.cancelRecoveryTimer();
        if (this.inboxTimer) {
            clearInterval(this.inboxTimer);
            this.inboxTimer = undefined;
        }
        if (this.active) {
            clearInterval(this.active.timer);
            if (this.active.submitTimer)
                clearTimeout(this.active.submitTimer);
            this.active = undefined;
        }
        try {
            this.pty.kill("SIGTERM");
        }
        catch { /* ignore */ }
    }
    shutdown() {
        this.cancelRecoveryTimer();
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
export function inputKeyToBytes(key) {
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
export function isInputEcho(sentText, plainOutput) {
    const needle = promptNeedle(sentText);
    if (!needle)
        return false;
    const haystack = plainOutput.replace(/\s+/g, " ");
    // Strip common prompt indicators so "> prompt text" still matches
    const stripped = haystack
        .replace(/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#>]\s*/i, "")
        .replace(/^>\s*/, "")
        .trim();
    if (needle.length < 8) {
        return stripped === needle;
    }
    // Full-needle match on stripped or raw haystack
    if (stripped === needle || stripped.includes(needle))
        return true;
    if (haystack.includes(needle))
        return true;
    if (needle.length > 24 && haystack.includes(needle.slice(-24)))
        return true;
    if (needle.length > 24 && stripped.includes(needle.slice(-24)))
        return true;
    // Multi-line prompt: check each prompt line individually so wrapped
    // or split echo fragments are caught
    const promptLineNeedles = normalizeForDetection(sentText)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 4);
    for (const lineNeedle of promptLineNeedles) {
        if (stripped === lineNeedle)
            return true;
        if (lineNeedle.length >= 12 && stripped.includes(lineNeedle))
            return true;
        if (lineNeedle.length > 24 && stripped.includes(lineNeedle.slice(-24)))
            return true;
    }
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
function cleanChunkForClient(active, chunk) {
    const stripped = stripAnsi(chunk)
        .replace(/\r/g, "\n")
        .replace(/\u001b\[[?]2004[hl]/g, "");
    const out = [];
    for (const rawLine of stripped.split("\n")) {
        const line = cleanClientLine(rawLine);
        if (!line)
            continue;
        if (isTuiNoiseLine(line))
            continue;
        // Strict leading-echo boundary: only filter by prompt in the echo
        // region at the start.  Once the first non-echo line appears we
        // stop prompt-based filtering for the rest of the stream.
        if (!active.echoBoundaryReached) {
            if (isLineInEchoRegion(line, active))
                continue;
            // First non-echo line — end echo region permanently.
            active.echoBoundaryReached = true;
        }
        const key = normalizeClientLine(line);
        if (!key || (key.length >= 4 && active.cleanEmittedLineKeys.has(key)))
            continue;
        if (key.length >= 4)
            active.cleanEmittedLineKeys.add(key);
        out.push(line);
    }
    return out.length > 0 ? `${out.join("\n")}\n` : "";
}
function cleanStatusText(value) {
    const lines = stripAnsi(value)
        .replace(/\r/g, "\n")
        .split("\n")
        .map(cleanClientLine)
        .filter((line) => line && !isTuiNoiseLine(line));
    return lines.slice(-20).join("\n");
}
export function cleanFinalText(value, sentText) {
    const rawLines = stripAnsi(value).replace(/\r/g, "\n").split("\n");
    const cleaned = [];
    for (const rawLine of rawLines) {
        const line = cleanClientLine(rawLine);
        if (line && !line.includes(DONE_MARKER) && !isTuiNoiseLine(line)) {
            cleaned.push(line);
        }
    }
    if (cleaned.length === 0)
        return "";
    const normalizedPrompt = normalizeForDetection(sentText);
    const promptCompact = normalizedPrompt.replace(/\s+/g, "");
    // Strict leading-echo boundary: scan from the start and remove only
    // lines that are explainable as prompt input-box echo (with optional
    // ❯/> prefixes, ANSI codes, line wrapping, empty prompt-box lines).
    // Once the first line with novel content appears — Claude's actual
    // thinking or answer body — we stop ALL prompt-based filtering.
    // Everything after the echo boundary is preserved verbatim (dedup
    // only), even if later lines happen to match prompt text exactly.
    let echoEnd = 0;
    let consumed = "";
    for (let i = 0; i < cleaned.length; i++) {
        const stripped = strippedLineForEcho(cleaned[i]);
        const compact = stripped.replace(/\s+/g, "");
        if (!compact) {
            echoEnd = i + 1;
            continue;
        }
        if (isEchoFragment(compact, promptCompact, consumed)) {
            echoEnd = i + 1;
            // Advance consumed to track how much of the prompt is accounted for
            const remaining = promptCompact.slice(consumed.length);
            if (remaining.startsWith(compact)) {
                consumed += compact;
            }
            else if (compact.length > 0 && remaining.length > 0) {
                // Partial overlap — consume the matching prefix
                for (let o = Math.min(remaining.length, compact.length); o > 0; o--) {
                    if (remaining.startsWith(compact.slice(0, o))) {
                        consumed += compact.slice(0, o);
                        break;
                    }
                }
            }
            if (consumed.length >= promptCompact.length) {
                echoEnd = i + 1;
                break;
            }
            continue;
        }
        // Novel content — echo region ends
        break;
    }
    // After the echo boundary: only dedup, never filter by prompt.
    const result = [];
    const seen = new Set();
    for (let i = echoEnd; i < cleaned.length; i++) {
        const key = normalizeClientLine(cleaned[i]);
        if (key && !seen.has(key)) {
            seen.add(key);
            result.push(cleaned[i]);
        }
    }
    return result.join("\n").trim();
}
// ── Echo-region helpers ──
/** Strip prompt-indicator prefix and normalize for echo detection. */
function strippedLineForEcho(line) {
    return normalizeClientLine(line).replace(/^[❯▶▸●○>]\s*/, "");
}
/**
 * Check whether `compact` is explainable as part of the input-echo
 * region for the given prompt.  `consumed` tracks how much of the
 * prompt has already been accounted for by previous echo lines.
 */
function isEchoFragment(compact, promptCompact, consumed) {
    if (!compact || !promptCompact)
        return false;
    const remaining = promptCompact.slice(consumed.length);
    if (!remaining)
        return false;
    // The fragment is a prefix of the remaining prompt
    if (remaining.startsWith(compact))
        return true;
    // The remaining prompt is a prefix of the fragment (extra chars from
    // ANSI codes, terminal artefacts).  Only when remaining is long enough
    // that this is unlikely to be a coincidental word match.
    if (remaining.length >= 8 && compact.startsWith(remaining))
        return true;
    // The fragment is fully contained somewhere in the prompt (wrapped
    // echo, partial match)
    if (promptCompact.includes(compact))
        return true;
    // Short fragment that matches part of remaining
    if (compact.length <= 40 && remaining.length >= compact.length &&
        remaining.includes(compact))
        return true;
    // Compact line contains a long-enough prefix of remaining prompt
    // somewhere inside it (wrapped echo continuation).
    if (compact.length >= 8 && remaining.length >= 8 &&
        compact.includes(remaining.slice(0, Math.min(40, remaining.length))))
        return true;
    return false;
}
/**
 * Per-line check used by cleanChunkForClient for incremental echo
 * detection across stream chunks.  Delegates to isEchoFragment after
 * stripping and normalizing the line.
 */
function isLineInEchoRegion(line, active) {
    const stripped = strippedLineForEcho(line);
    const compact = stripped.replace(/\s+/g, "");
    if (!compact)
        return true; // empty/prefix-only line → still in echo region
    const normalizedPrompt = normalizeForDetection(active.sentPromptText);
    const promptCompact = normalizedPrompt.replace(/\s+/g, "");
    const result = isEchoFragment(compact, promptCompact, active.consumedEchoChars);
    if (result) {
        // Advance consumed tracker across chunks
        const remaining = promptCompact.slice(active.consumedEchoChars.length);
        if (remaining.startsWith(compact)) {
            active.consumedEchoChars += compact;
        }
        else if (compact.length > 0 && remaining.length > 0) {
            for (let o = Math.min(remaining.length, compact.length); o > 0; o--) {
                if (remaining.startsWith(compact.slice(0, o))) {
                    active.consumedEchoChars += compact.slice(0, o);
                    break;
                }
            }
        }
    }
    return result;
}
function buildPermissionOutput(cleanStream, snapshot, sentText = "") {
    const visible = cleanFinalText(`${cleanStream}\n${snapshot.bottom_lines.slice(-12).join("\n")}\n${snapshot.text}`, sentText);
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
function looksLikePromptFragment(sentText, line) {
    const prompt = normalizeForDetection(sentText).replace(/\s+/g, " ").toLowerCase();
    const candidate = normalizeClientLine(line).toLowerCase();
    return Boolean(prompt && candidate && prompt.includes(candidate));
}
function tailMeaningfulLines(value, maxLines) {
    return value
        .split("\n")
        .map((line) => line.replace(/\s+$/g, ""))
        .filter(Boolean)
        .slice(-maxLines)
        .join("\n");
}
function terminalStatusSummary(status) {
    if (status === "timeout")
        return "Claude Code bridge round timed out.";
    if (status === "interrupted")
        return "Claude Code bridge round was interrupted.";
    if (status === "not_submitted")
        return "Claude Code input produced no effective output.";
    if (status === "exited")
        return "Claude Code process exited.";
    if (status === "busy")
        return "Claude Code bridge is busy with another round.";
    return "";
}
function cleanClientLine(value) {
    return value
        .replace(/[\u001b\x9b][^\n]*/g, "")
        .replace(/^[│┃]\s?/u, "")
        .replace(/\s?[│┃]$/u, "")
        .replace(/\s+$/g, "")
        .trim();
}
function normalizeClientLine(value) {
    return value.replace(/\s+/g, " ").trim();
}
function isTuiNoiseLine(line) {
    const normalized = normalizeClientLine(line);
    if (!normalized)
        return true;
    if (/^[╭╮╰╯│─┌┐└┘├┤┬┴┼═║╔╗╚╝+\-\s]+$/u.test(normalized))
        return true;
    if (/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s*$/i.test(normalized))
        return true;
    if (/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s+\S/i.test(normalized))
        return true;
    if (/^\W*(?:esc to interrupt|press esc|ctrl-c to|\? for shortcuts)\b/i.test(normalized))
        return true;
    if (/\b(?:esc to interrupt|press esc|ctrl-c to|\? for shortcuts|auto-accept edits|bypass permissions)\b/i.test(normalized)) {
        return true;
    }
    if (/^[|/\\\-⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏●✶✽·\s]+$/u.test(normalized))
        return true;
    if (/^(?:thinking|loading|processing|waiting|working)\b/i.test(normalized))
        return true;
    return false;
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