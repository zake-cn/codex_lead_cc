#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareClaudeRuntimeEnvFile, redactConfigForDisplay, } from "../claude/claude_runtime_env.js";
import { ensureUserConfigDirectories, loadOrCreateUserConfig, resetUserConfig, userConfigPath, } from "../config/user_config.js";
import { detectInstallSource, parseUpdateArgs, runUpdate, } from "./update.js";
const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(wrapperDir, "..", "..");
// ── Default CLAUDE.md (written to supervisor_home on first launch) ──
const DEFAULT_CLAUDE_MD = [
    "# codex_lead_cc Supervisor Rules",
    "",
    "You are Codex Lead. Your cwd is supervisor_home.",
    "You must NOT read, write, or run commands inside the real project directory.",
    "Only Claude Code (launched via codex_lead_cc delegate) may touch the project.",
    "",
    "## Environment",
    "",
    "- CODEX_LEAD_CC_TASK_DIR — absolute path where TaskFiles are written",
    "- CODEX_LEAD_CC_SESSION_FILE — absolute path to session.json",
    "- CODEX_LEAD_CC_BIN — absolute path to codex_lead_cc binary",
    "- CODEX_LEAD_CC_ARTIFACT_ROOT — artifact output root",
    "",
    "## How to delegate work",
    "",
    "### Step 1 — Write a TaskFile",
    "",
    'Use Bash to write the TaskFile to $CODEX_LEAD_CC_TASK_DIR/task_NNN.md.',
    "Choose a unique task_NNN (e.g. task_001, task_002).",
    "",
    "```bash",
    "cat > \"$CODEX_LEAD_CC_TASK_DIR/task_NNN.md\" << 'TASKEOF'",
    "# codex_lead_cc Task",
    "",
    "TaskId: task_NNN",
    "WorkerType: readonly",
    "",
    "## Goal",
    "(describe what to do)",
    "",
    "## Allowed Scope",
    "- README*",
    "- package.json",
    "- src/**",
    "",
    "## Forbidden Actions",
    "- Do not modify files",
    "- Do not delete files",
    "- Do not run destructive commands",
    "",
    "## Acceptance Criteria",
    "- (how to judge success)",
    "",
    "## Verification",
    "- (how to verify the result)",
    "",
    "## Report Requirements",
    "Status",
    "Summary",
    "Changed Files",
    "Verification",
    "Findings",
    "Final Result",
    "Risks Or Follow-ups",
    "TASKEOF",
    "```",
    "",
    'WorkerType must be "readonly" (inspect only) or "write" (may modify within Allowed Scope).',
    "",
    "### Step 2 — Execute the delegate",
    "",
    "Use Bash to run exactly ONE command-line. Replace $TASK_FILE with the ACTUAL absolute path.",
    "Do NOT use the literal string <TASK_FILE>.",
    "Do NOT export CODEX_CLAUDE_CHILD_THREAD on a separate line.",
    "The env var must be an inline prefix on the same command.",
    "",
    "```bash",
    'CODEX_CLAUDE_CHILD_THREAD=1 "$CODEX_LEAD_CC_BIN" delegate --task-file "$TASK_FILE" --session-file "$CODEX_LEAD_CC_SESSION_FILE" --timeout-sec 120',
    "```",
    "",
    "The delegate writes progress to stderr and a single JSON result to stdout.",
    "Read the JSON from stdout to decide the next step.",
    "Do NOT analyze, inspect, or read the project yourself.",
    "",
    "### Step 3 — Decide next action",
    "",
    'Read the "status" field from the JSON result:',
    '- "completed" — review the summary, create next task if needed',
    '- "failed" — check artifact dir for claude_stderr.log, decide retry or report',
    '- "timeout" — may retry with a longer --timeout-sec value',
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
    if (rawArgs[0] === "delegate") {
        const { delegateMain } = await import("../delegate/delegate_runner.js");
        await delegateMain(rawArgs.slice(1));
        return;
    }
    const options = parseArgs(rawArgs);
    const userConfig = await loadOrCreateUserConfig();
    await ensureUserConfigDirectories(userConfig);
    if (options.doctor) {
        printDoctor(userConfig);
        return;
    }
    // Ensure CLAUDE.md exists in supervisor_home (Codex auto-loads this)
    ensureClaudeMd(userConfig.supervisor_home);
    // Generate session
    const session = createSession(userConfig);
    // Prepare Claude runtime env file
    const claudeEnv = prepareClaudeRuntimeEnvFile({
        runtimeHome: userConfig.runtime_home,
        sessionId: session.sessionId,
        config: userConfig.claude_runtime,
    });
    // Write session file
    writeFileSync(session.filePath, JSON.stringify({ ...session.data, claude_env_file: claudeEnv.env_file }, null, 2) + "\n", "utf8");
    // Build Codex env
    const codexLeadBin = process.argv[1] || path.join(wrapperDir, "codex_lead_cc.js");
    const codexEnv = {
        ...process.env,
        PWD: userConfig.supervisor_home,
        CODEX_LEAD_CC_SESSION_ID: session.sessionId,
        CODEX_LEAD_CC_SESSION_FILE: session.filePath,
        CODEX_LEAD_CC_TASK_DIR: session.data.task_dir,
        CODEX_LEAD_CC_ARTIFACT_ROOT: session.data.artifact_root,
        CODEX_LEAD_CC_SUPERVISOR_HOME: userConfig.supervisor_home,
        CODEX_LEAD_CC_BIN: codexLeadBin,
    };
    assertReadyToLaunch(userConfig);
    const child = spawn("codex", options.codexArgs, {
        cwd: userConfig.supervisor_home,
        env: codexEnv,
        stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
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
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(artifactRoot, { recursive: true });
    return {
        sessionId,
        filePath: path.join(sessionDir, "session.json"),
        data: {
            version: 1,
            session_id: sessionId,
            project_path: projectPath,
            supervisor_home: userConfig.supervisor_home,
            task_dir: taskDir,
            artifact_root: artifactRoot,
        },
    };
}
// ── CLI parsing ──
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
// ── CLAUDE.md ──
function ensureClaudeMd(supervisorHome) {
    const claudeMdPath = path.join(supervisorHome, "CLAUDE.md");
    if (!existsSync(claudeMdPath)) {
        mkdirSync(supervisorHome, { recursive: true });
        writeFileSync(claudeMdPath, DEFAULT_CLAUDE_MD, "utf8");
    }
}
// ── Readiness ──
function assertReadyToLaunch(userConfig) {
    if (!checkCommand("codex").ok)
        throw new Error("codex command is not available on PATH.");
    if (!checkRuntimeCommand(userConfig.claude_runtime.command).ok) {
        process.stderr.write(`Warning: Claude runtime "${userConfig.claude_runtime.command}" is not available.\n`);
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
    const checks = [
        { name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
        checkCommand("npm"), checkCommand("codex"), checkCommand("git"),
        checkRuntimeCommand(userConfig.claude_runtime.command),
        { name: "supervisor_home", ok: existsSync(userConfig.supervisor_home), detail: userConfig.supervisor_home },
        { name: "runtime_home", ok: existsSync(userConfig.runtime_home), detail: userConfig.runtime_home },
        { name: "codex_lead_cc_config", ok: existsSync(userConfig.config_path), detail: userConfig.config_path },
        { name: "claude_md", ok: existsSync(path.join(userConfig.supervisor_home, "CLAUDE.md")), detail: path.join(userConfig.supervisor_home, "CLAUDE.md") },
        { name: "install_source", ok: true, detail: installSource.detail, value: installSource },
        { name: "claude_runtime_command", ok: true, detail: userConfig.claude_runtime.command, value: { command: userConfig.claude_runtime.command, args_prefix: userConfig.claude_runtime.args_prefix } },
        { name: "env_bridge", ok: envBridgeOk, detail: envBridgeOk ? "claude_env.json generated" : "env bridge failed" },
    ];
    process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
}
function checkCommand(cmd) {
    const r = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
    return { name: `${cmd}_available`, ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found on PATH" };
}
function checkRuntimeCommand(cmd) {
    if (cmd.includes("/"))
        return { name: "claude_available", ok: existsSync(cmd), detail: cmd };
    const r = spawnSync("bash", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" });
    return { name: "claude_available", ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found on PATH" };
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
  codex_lead_cc delegate --task-file <path> --session-file <path>
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc config show | reset | path

The wrapper starts Codex from supervisor_home.
Supervisor behavior is loaded from CLAUDE.md in supervisor_home.
`);
}
main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=codex_lead_cc.js.map