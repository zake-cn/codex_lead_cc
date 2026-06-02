#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareClaudeRuntimeEnvFile, redactConfigForDisplay, } from "../claude/claude_runtime_env.js";
import { assertPathInside, ensureUserConfigDirectories, isPathInside, loadOrCreateUserConfig, resetUserConfig, runtimeHomeWarning, userConfigPath, } from "../config/user_config.js";
import { detectInstallSource, parseUpdateArgs, runUpdate, } from "./update.js";
const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(wrapperDir, "..", "..");
// ── Default CLAUDE.md ──
const DEFAULT_CLAUDE_MD = [
    "# codex_lead_cc Supervisor Rules",
    "",
    "You are Codex Lead. Your cwd is supervisor_home.",
    "You must NOT read, write, or run commands inside the real project directory.",
    "Only Claude Code, running in the long-lived local CC Bridge PTY, may touch the project.",
    "",
    "ALL runtime files (sessions, artifacts, env files, bridge socket) are INSIDE supervisor_home.",
    "Do NOT create files under ~/.codex_lead_cc/runtime — that path is no longer used.",
    "",
    "## Environment",
    "",
    "- CODEX_LEAD_CC_BRIDGE_SOCKET — absolute path to the bridge socket for this Codex conversation",
    "- CODEX_LEAD_CC_SESSION_FILE — absolute path to session.json inside supervisor_home",
    "- CODEX_LEAD_CC_SESSION_ID — current session id",
    "- CODEX_LEAD_CC_BIN — absolute path to the codex_lead_cc binary",
    "",
    "## Allowed Commands",
    "",
    "Use only these bridge commands:",
    "",
    "```bash",
    'codex_lead_cc cc-send "prompt"',
    "codex_lead_cc cc-send <<'EOF'",
    "multi-line prompt",
    "EOF",
    "codex_lead_cc cc-input --key 1",
    "codex_lead_cc cc-status",
    "```",
    "",
    "Do NOT use MCP, subagents, delegate, submit, daemon, TaskContract, OperationRequest, worker pools, queues, or multiple Claude Code instances.",
    "",
    "## How to Work",
    "",
    "Send natural-language instructions to Claude Code through cc-send.",
    "cc-send streams the Claude Code PTY output to stdout and ends only when the bridge reports completed, needs_permission, timeout, interrupted, or exited.",
    "cc-send ending does NOT mean Claude Code exited. The Claude Code PTY stays alive for the next instruction.",
    "cc-input sends one key to the same PTY, streams output, and also leaves Claude Code running.",
    "cc-status only reads bridge state; it must not drive execution.",
    "",
    "The bridge completion decision is based on PTY screen state:",
    "- recent quiet output window",
    "- no bottom-screen loading/spinner",
    "- no permission menu",
    "- optional <<<CODEX_LEAD_CC_DONE>>> marker as an auxiliary signal",
    "",
    "Do NOT decide task completion from whether Claude Code is accepting input. Claude Code is usually input-ready even when the task is not done.",
    "",
    "## Permission Loop",
    "",
    "When cc-send or cc-input prints:",
    "",
    "```text",
    "<<<CODEX_LEAD_CC_STATUS>>>",
    "{\"status\":\"needs_permission\",\"suggested_keys\":[\"1\",\"2\",\"3\"]}",
    "<<<CODEX_LEAD_CC_STATUS_END>>>",
    "```",
    "",
    "Ask the human which option to grant.",
    'If the human chooses option 1, run: codex_lead_cc cc-input --key 1',
    'If the human chooses option 2, record that Codex may handle similar requests automatically, but still run: codex_lead_cc cc-input --key 1',
    'Only run codex_lead_cc cc-input --key 2 when the human explicitly asks Claude Code itself to stop asking.',
    'If the human chooses option 3, run: codex_lead_cc cc-input --key 3',
    "",
    "Human grants reusable policy to Codex. Codex grants one-shot approval to Claude Code.",
].join("\n");
// ── main ──
async function main() {
    const rawArgs = process.argv.slice(2);
    if (rawArgs[0] === "update") {
        process.exitCode = runUpdate(parseUpdateArgs(rawArgs.slice(1)), repoRoot);
        return;
    }
    if (rawArgs[0] === "config") {
        await runConfigCommand(rawArgs.slice(1));
        return;
    }
    if (rawArgs[0] === "cc-send") {
        const { ccSendMain } = await import("../bridge/cc_client.js");
        await ccSendMain(rawArgs.slice(1));
        return;
    }
    if (rawArgs[0] === "cc-input") {
        const { ccInputMain } = await import("../bridge/cc_client.js");
        await ccInputMain(rawArgs.slice(1));
        return;
    }
    if (rawArgs[0] === "cc-status") {
        const { ccStatusMain } = await import("../bridge/cc_client.js");
        await ccStatusMain(rawArgs.slice(1));
        return;
    }
    if (rawArgs[0] === "__bridge") {
        if (process.env.CODEX_LEAD_CC_INTERNAL_BRIDGE !== "1") {
            throw new Error("Unsupported command. Use only cc-send, cc-input, and cc-status for the CC Bridge.");
        }
        const { bridgeMain } = await import("../bridge/cc_bridge.js");
        await bridgeMain(rawArgs.slice(1));
        return;
    }
    if (rawArgs[0] === "delegate" || rawArgs[0] === "submit" || rawArgs[0] === "daemon") {
        throw new Error("Unsupported command. Use only cc-send, cc-input, and cc-status for the CC Bridge.");
        return;
    }
    const options = parseArgs(rawArgs);
    const userConfig = await loadOrCreateUserConfig();
    await ensureUserConfigDirectories(userConfig);
    if (options.doctor) {
        printDoctor(userConfig);
        return;
    }
    // Warn if runtime_home is outside supervisor_home
    const rtw = runtimeHomeWarning(userConfig);
    if (rtw)
        process.stderr.write(`Warning: ${rtw}\n`);
    ensureClaudeMd(userConfig.supervisor_home);
    const session = createSession(userConfig);
    const claudeEnv = prepareClaudeRuntimeEnvFile({
        runtimeHome: userConfig.runtime_home,
        sessionId: session.sessionId,
        config: userConfig.claude_runtime,
    });
    const sessionData = {
        ...session.data,
        claude_env_file: claudeEnv.env_file,
    };
    writeSessionFile(session.filePath, sessionData);
    const codexLeadBin = process.argv[1] || path.join(wrapperDir, "codex_lead_cc.js");
    assertReadyToLaunch(userConfig);
    const bridge = startCcBridge({
        sessionFile: session.filePath,
        sessionDir: session.sessionDir,
        supervisorHome: userConfig.supervisor_home,
    });
    if (bridge.pid) {
        sessionData.bridge_pid = bridge.pid;
        writeSessionFile(session.filePath, sessionData);
    }
    const bridgeReady = await waitForBridgeReady(session.data.bridge_socket, 5_000);
    if (!bridgeReady) {
        process.stderr.write(`Warning: CC bridge was not ready within 5s. See ${bridge.logPath}\n`);
    }
    const codexEnv = {
        ...process.env,
        PWD: userConfig.supervisor_home,
        CODEX_LEAD_CC_BRIDGE_SOCKET: session.data.bridge_socket,
        CODEX_LEAD_CC_SESSION_ID: session.sessionId,
        CODEX_LEAD_CC_SESSION_FILE: session.filePath,
        CODEX_LEAD_CC_SUPERVISOR_HOME: userConfig.supervisor_home,
        CODEX_LEAD_CC_BIN: codexLeadBin,
    };
    const child = spawn("codex", options.codexArgs, {
        cwd: userConfig.supervisor_home,
        env: codexEnv,
        stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
        stopCcBridge(bridge);
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exitCode = code ?? 1;
    });
}
function createSession(userConfig) {
    const sessionId = `session_${randomUUID().slice(0, 8)}`;
    const projectPath = process.cwd();
    const sessionDir = path.join(userConfig.runtime_home, "sessions", sessionId);
    const taskDir = path.join(sessionDir, "tasks");
    const artifactRoot = path.join(sessionDir, "artifacts");
    const bridgeSocket = path.join(sessionDir, "cc_bridge.sock");
    // ALL runtime paths MUST be inside supervisor_home
    assertPathInside(sessionDir, userConfig.supervisor_home, "sessionDir");
    assertPathInside(taskDir, userConfig.supervisor_home, "taskDir");
    assertPathInside(artifactRoot, userConfig.supervisor_home, "artifactRoot");
    assertPathInside(bridgeSocket, userConfig.supervisor_home, "bridgeSocket");
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    return {
        sessionId,
        sessionDir,
        filePath: path.join(sessionDir, "session.json"),
        data: {
            version: 1,
            session_id: sessionId,
            project_path: projectPath,
            supervisor_home: userConfig.supervisor_home,
            task_dir: taskDir,
            artifact_root: artifactRoot,
            bridge_socket: bridgeSocket,
            created_at: new Date().toISOString(),
        },
    };
}
function startCcBridge(args) {
    const logPath = path.join(args.sessionDir, "cc_bridge.log");
    const logFd = openSync(logPath, "a");
    const bridgeEntry = path.resolve(wrapperDir, "..", "bridge", "cc_bridge.js");
    const bridgeArgs = existsSync(bridgeEntry)
        ? [bridgeEntry, "--session-file", args.sessionFile]
        : [fileURLToPath(import.meta.url), "__bridge", "--session-file", args.sessionFile];
    const child = spawn(process.execPath, bridgeArgs, {
        cwd: args.supervisorHome,
        env: {
            ...process.env,
            CODEX_LEAD_CC_PARENT_PID: String(process.pid),
            CODEX_LEAD_CC_INTERNAL_BRIDGE: "1",
        },
        stdio: ["ignore", logFd, logFd],
        detached: false,
    });
    closeSync(logFd);
    child.on("error", (error) => {
        process.stderr.write(`Warning: failed to start CC bridge: ${error.message}\n`);
    });
    return { pid: child.pid, logPath, process: child };
}
async function waitForBridgeReady(socketPath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await canConnect(socketPath))
            return true;
        await sleep(100);
    }
    return canConnect(socketPath);
}
function stopCcBridge(bridge) {
    if (!bridge.pid || !isProcessAlive(bridge.pid))
        return;
    try {
        bridge.process.kill("SIGTERM");
    }
    catch {
        // The bridge also monitors the wrapper pid and will self-exit.
    }
}
function canConnect(socketPath) {
    return new Promise((resolve) => {
        if (!existsSync(socketPath)) {
            resolve(false);
            return;
        }
        const client = net.createConnection(socketPath);
        let buffer = "";
        const done = (ok) => {
            client.removeAllListeners();
            client.destroy();
            resolve(ok);
        };
        client.setEncoding("utf8");
        client.once("connect", () => {
            client.write(`${JSON.stringify({ type: "status" })}\n`);
        });
        client.on("data", (chunk) => {
            buffer += chunk;
            if (buffer.includes("\"type\":\"status\""))
                done(true);
        });
        client.once("error", () => done(false));
        client.setTimeout(250, () => done(false));
    });
}
function writeSessionFile(sessionFile, session) {
    writeFileSync(sessionFile, JSON.stringify(session, null, 2) + "\n", "utf8");
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ── CLI ──
function parseArgs(args) {
    let doctor = false;
    const codexArgs = [];
    for (const arg of args) {
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        if (arg === "--doctor") {
            doctor = true;
            continue;
        }
        codexArgs.push(arg);
    }
    return { doctor, codexArgs };
}
function ensureClaudeMd(supervisorHome) {
    const p = path.join(supervisorHome, "CLAUDE.md");
    if (!existsSync(p)) {
        mkdirSync(supervisorHome, { recursive: true });
        writeFileSync(p, DEFAULT_CLAUDE_MD, "utf8");
        return;
    }
    const existing = readFileSync(p, "utf8");
    if (existing.startsWith("# codex_lead_cc Supervisor Rules")) {
        writeFileSync(p, DEFAULT_CLAUDE_MD, "utf8");
    }
}
function assertReadyToLaunch(userConfig) {
    if (!checkCommand("codex").ok)
        throw new Error("codex command is not available on PATH.");
    if (!checkRuntimeCommand(userConfig.claude_runtime.command).ok) {
        process.stderr.write(`Warning: Claude "${userConfig.claude_runtime.command}" not available.\n`);
    }
}
// ── Doctor ──
function printDoctor(userConfig) {
    const installSource = detectInstallSource(repoRoot);
    let envBridgeOk = false;
    try {
        const sid = `doctor_${randomUUID().slice(0, 8)}`;
        const r = prepareClaudeRuntimeEnvFile({ runtimeHome: userConfig.runtime_home, sessionId: sid, config: userConfig.claude_runtime });
        envBridgeOk = Boolean(r.env_file && existsSync(r.env_file));
    }
    catch { /* ignore */ }
    const rtInside = isPathInside(userConfig.runtime_home, userConfig.supervisor_home);
    const taskProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
    const artifactProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
    const envProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
    const checks = [
        { name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
        checkCommand("npm"), checkCommand("codex"), checkCommand("git"),
        checkCommand("script"),
        checkRuntimeCommand(userConfig.claude_runtime.command),
        { name: "supervisor_home", ok: existsSync(userConfig.supervisor_home), detail: userConfig.supervisor_home },
        { name: "runtime_home", ok: existsSync(userConfig.runtime_home), detail: userConfig.runtime_home },
        { name: "runtime_home_inside_supervisor_home", ok: rtInside, detail: rtInside ? "ok" : `WARNING: runtime_home is outside supervisor_home — bridge writes may fail. Run: codex_lead_cc config reset` },
        { name: "task_dir_writable", ok: taskProbe.ok, detail: taskProbe.detail },
        { name: "artifact_root_writable", ok: artifactProbe.ok, detail: artifactProbe.detail },
        { name: "env_file_writable", ok: envProbe.ok, detail: envProbe.detail },
        { name: "codex_lead_cc_config", ok: existsSync(userConfig.config_path), detail: userConfig.config_path },
        { name: "claude_md", ok: existsSync(path.join(userConfig.supervisor_home, "CLAUDE.md")), detail: path.join(userConfig.supervisor_home, "CLAUDE.md") },
        { name: "install_source", ok: true, detail: installSource.detail, value: installSource },
        { name: "claude_runtime_command", ok: true, detail: userConfig.claude_runtime.command, value: { command: userConfig.claude_runtime.command, args_prefix: userConfig.claude_runtime.args_prefix } },
        { name: "env_bridge", ok: envBridgeOk, detail: envBridgeOk ? "claude_env.json generated" : "env bridge failed" },
    ];
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
}
function writeProbe(dir) {
    try {
        mkdirSync(dir, { recursive: true });
        return { ok: true, detail: dir };
    }
    catch (e) {
        const msg = e instanceof Error ? `${e.message} (${e.code ?? "unknown"})` : String(e);
        return { ok: false, detail: msg };
    }
}
function checkCommand(cmd) {
    const r = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
    return { name: `${cmd}_available`, ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found" };
}
function checkRuntimeCommand(cmd) {
    if (cmd.includes("/"))
        return { name: "claude_available", ok: existsSync(cmd), detail: cmd };
    const r = spawnSync("bash", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" });
    return { name: "claude_available", ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found" };
}
// ── Config ──
async function runConfigCommand(args) {
    const sub = args[0] ?? "show";
    if (sub === "path") {
        process.stdout.write(`${userConfigPath()}\n`);
        return;
    }
    if (sub === "show") {
        const c = await loadOrCreateUserConfig();
        await ensureUserConfigDirectories(c);
        process.stdout.write(`${JSON.stringify(redactConfigForDisplay(c), null, 2)}\n`);
        return;
    }
    if (sub === "reset") {
        const c = await resetUserConfig();
        await ensureUserConfigDirectories(c);
        process.stdout.write(`${JSON.stringify(redactConfigForDisplay(c), null, 2)}\n`);
        return;
    }
    throw new Error("config requires one of: show, reset, path.");
}
function shellQuote(v) { return `'${v.replace(/'/g, "'\\''")}'`; }
function printHelp() {
    process.stdout.write(`codex_lead_cc — Codex Lead Supervisor Launcher

Usage:
  codex_lead_cc [--doctor] [codex args...]
  codex_lead_cc cc-send [--timeout-sec 120] "prompt"
  codex_lead_cc cc-input --key <1|2|3|enter|escape|ctrl-c>
  codex_lead_cc cc-status
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc config show | reset | path

Supervisor behavior is loaded from CLAUDE.md in supervisor_home.
cc-send, cc-input, and cc-status require an active CODEX_LEAD_CC_BRIDGE_SOCKET environment.
`);
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=codex_lead_cc.js.map