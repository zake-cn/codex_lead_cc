#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeWorkerEnv, buildFinalClaudeEnv, getClaudeRuntimeCommand, loadClaudeRuntimeEnvFile, } from "../claude/claude_runtime_env.js";
import { CompletionDetector, DEFAULT_COMPLETION_OPTIONS, DONE_MARKER } from "./completion_detector.js";
import { startClaudePty } from "./pty.js";
import { encodeFrame, parseFrame } from "./protocol.js";
import { SimpleAnsiTerminalScreen } from "./terminal_screen.js";
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
    server;
    constructor(sessionFile, session, pty) {
        this.sessionFile = sessionFile;
        this.session = session;
        this.pty = pty;
        this.pty.onData((chunk) => this.onPtyOutput(chunk));
        this.pty.onExit(() => this.onPtyExit());
    }
    attach(server) {
        this.server = server;
        server.on("connection", (client) => this.handleClient(client));
        process.on("SIGTERM", () => this.shutdown());
        process.on("SIGINT", () => this.shutdown());
        writeSessionPatch(this.sessionFile, {
            bridge_pid: process.pid,
            cc_pid: this.pty.pid,
        });
    }
    handleClient(client) {
        client.setEncoding("utf8");
        let buffer = "";
        let handled = false;
        client.on("data", (chunk) => {
            if (handled)
                return;
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline === -1)
                return;
            const raw = buffer.slice(0, newline);
            handled = true;
            this.handleRequest(client, raw).catch((error) => {
                writeFrame(client, { type: "error", error: messageFrom(error) });
                client.end();
            });
        });
    }
    async handleRequest(client, raw) {
        const request = parseFrame(raw);
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
    startSend(client, prompt, timeoutSec) {
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
    startInput(client, key, timeoutSec) {
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
    startInteraction(client, timeoutSec) {
        const now = Date.now();
        this.state = "running";
        this.lastOutputAt = now;
        const active = {
            client,
            startedAt: now,
            deadlineAt: now + timeoutSec * 1_000,
            seenDoneMarker: false,
            timer: setInterval(() => this.checkCompletion(), DEFAULT_COMPLETION_OPTIONS.checkIntervalMs),
        };
        active.timer.unref();
        this.active = active;
        client.on("close", () => {
            if (this.active?.client !== client)
                return;
            clearInterval(this.active.timer);
            this.active = undefined;
            if (this.state === "running")
                this.state = "interrupted";
        });
    }
    onPtyOutput(chunk) {
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
            }
            else if (this.state !== "exited") {
                this.state = "needs_permission";
            }
        }
    }
    onPtyExit() {
        this.state = "exited";
        if (this.active) {
            this.finishActive({ status: "exited" });
        }
    }
    checkCompletion() {
        if (!this.active)
            return;
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
    finishActive(result) {
        if (!this.active)
            return;
        const active = this.active;
        clearInterval(active.timer);
        this.active = undefined;
        if (result.status === "completed")
            this.state = "idle";
        else if (result.status === "needs_permission")
            this.state = "needs_permission";
        else if (result.status === "timeout")
            this.state = "timeout";
        else if (result.status === "interrupted")
            this.state = "interrupted";
        else if (result.status === "exited")
            this.state = "exited";
        finishClient(active.client, result);
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
            last_output: trimStatusOutput(snapshot.text || this.lastOutput),
            bottom_lines: snapshot.bottom_lines,
            spinner_detected: this.spinnerDetected,
            permission_prompt_detected: this.permissionPromptDetected,
            suggested_keys: this.suggestedKeys,
        };
    }
    shutdown() {
        if (this.active) {
            this.finishActive({ status: "interrupted" });
        }
        this.server?.close();
        this.pty.kill("SIGTERM");
        if (existsSync(this.session.bridge_socket)) {
            try {
                unlinkSync(this.session.bridge_socket);
            }
            catch { /* non-fatal */ }
        }
        process.exit(0);
    }
}
export async function bridgeMain(rawArgs) {
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
    let pty;
    try {
        pty = await startClaudePty({
            command: runtime.command,
            args: runtime.argsPrefix,
            cwd: session.project_path,
            env: workerEnv,
        });
        const bridge = new CcBridge(options.sessionFile, session, pty);
        bridge.attach(server);
    }
    catch (error) {
        server.close();
        if (existsSync(session.bridge_socket)) {
            try {
                unlinkSync(session.bridge_socket);
            }
            catch { /* non-fatal */ }
        }
        pty?.kill("SIGTERM");
        throw error;
    }
    watchParent();
}
function openBridgeServer(socketPath) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
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
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                chmodSync(socketPath, 0o600);
            }
            catch { /* non-fatal */ }
            resolve(server);
        });
    });
}
function loadBridgeSession(sessionFile) {
    const parsed = JSON.parse(readFileSync(sessionFile, "utf8"));
    const required = [
        "session_id",
        "project_path",
        "supervisor_home",
        "bridge_socket",
        "claude_env_file",
        "created_at",
    ];
    for (const key of required) {
        if (typeof parsed[key] !== "string" || !parsed[key].trim()) {
            throw new Error(`Session file is missing required bridge field: ${key}`);
        }
    }
    if (parsed.version !== 1) {
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
        writeFileSync(sessionFile, `${JSON.stringify({ ...session, ...patch }, null, 2)}\n`, "utf8");
    }
    catch {
        // The bridge can operate without updating diagnostic pid fields.
    }
}
function writeFrame(client, frame) {
    client.write(encodeFrame(frame));
}
function finishClient(client, result) {
    writeFrame(client, { type: "result", result });
    client.end();
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
function ensureSubmitted(prompt) {
    return prompt.endsWith("\n") || prompt.endsWith("\r") ? `${prompt}\r` : `${prompt}\r`;
}
function trimStatusOutput(value) {
    return value.replace(/\s+$/g, "").slice(-2_000);
}
function tail(value, max) {
    if (value.length <= max)
        return value;
    return value.slice(value.length - max);
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