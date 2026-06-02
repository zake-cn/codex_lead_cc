#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareClaudeRuntimeEnvFile,
  redactConfigForDisplay,
} from "../claude/claude_runtime_env.js";
import {
  assertPathInside,
  ensureUserConfigDirectories,
  isPathInside,
  loadOrCreateUserConfig,
  resetUserConfig,
  runtimeHomeWarning,
  userConfigPath,
  type EffectiveCodexLeadUserConfig,
} from "../config/user_config.js";
import {
  detectInstallSource,
  parseUpdateArgs,
  runUpdate,
} from "./update.js";
import type { SessionFile } from "../types.js";

const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(wrapperDir, "..", "..");

// ── Default CLAUDE.md ──

const DEFAULT_CLAUDE_MD = [
  "# codex_lead_cc Supervisor Rules",
  "",
  "You are Codex Lead. Your cwd is supervisor_home.",
  "You must NOT read, write, or run commands inside the real project directory.",
  "Only Claude Code (launched via codex_lead_cc delegate) may touch the project.",
  "",
  "ALL runtime directories (tasks, artifacts, sessions) are INSIDE supervisor_home.",
  "Do NOT create files under ~/.codex_lead_cc/runtime — that path is no longer used.",
  "",
  "## Environment",
  "",
  "- CODEX_LEAD_CC_TASK_DIR — absolute path inside supervisor_home for TaskFiles",
  "- CODEX_LEAD_CC_SESSION_FILE — absolute path to session.json inside supervisor_home",
  "- CODEX_LEAD_CC_BIN — absolute path to the codex_lead_cc binary",
  "- CODEX_LEAD_CC_ARTIFACT_ROOT — artifact output root inside supervisor_home",
  "",
  "## How to delegate work",
  "",
  "### Step 1 — Write a TaskFile",
  "",
  "Use Bash. Write the TaskFile to $CODEX_LEAD_CC_TASK_DIR/task_NNN.md",
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
  "Run exactly ONE command-line. $TASK_FILE and $SESSION_FILE must be ABSOLUTE paths.",
  "Do NOT use literal placeholder strings. Do NOT export on a separate line.",
  "",
  "```bash",
  'CODEX_CLAUDE_CHILD_THREAD=1 "$CODEX_LEAD_CC_BIN" delegate --task-file "$TASK_FILE" --session-file "$CODEX_LEAD_CC_SESSION_FILE" --timeout-sec 120',
  "```",
  "",
  "The delegate loads claude_env.json internally and passes it to Claude Code.",
  "You must NOT read, export, or source claude_env.json yourself.",
  "You must NOT print API keys, tokens, or proxy credentials.",
  "The delegate writes progress to stderr and a JSON result to stdout.",
  "Read only stdout JSON to decide next steps. Do NOT analyze the project yourself.",
  "",
  "### Step 3 — Decide next action",
  "",
  'Check the "status" field in the JSON:',
  '- "completed" — review summary, create next task if needed',
  '- "failed" — check artifact dir for claude_stderr.log',
  '- "timeout" — retry with longer --timeout-sec',
].join("\n");

// ── main ──

async function main(): Promise<void> {
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

  // Warn if runtime_home is outside supervisor_home
  const rtw = runtimeHomeWarning(userConfig);
  if (rtw) process.stderr.write(`Warning: ${rtw}\n`);

  ensureClaudeMd(userConfig.supervisor_home);
  const session = createSession(userConfig);

  const claudeEnv = prepareClaudeRuntimeEnvFile({
    runtimeHome: userConfig.runtime_home,
    sessionId: session.sessionId,
    config: userConfig.claude_runtime,
  });

  writeFileSync(
    session.filePath,
    JSON.stringify(
      { ...session.data, claude_env_file: claudeEnv.env_file },
      null, 2,
    ) + "\n",
    "utf8",
  );

  const codexLeadBin = process.argv[1] || path.join(wrapperDir, "codex_lead_cc.js");
  const codexEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
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
    if (signal) { process.kill(process.pid, signal); return; }
    process.exitCode = code ?? 1;
  });
}

// ── Session ──

interface SessionInfo {
  sessionId: string;
  filePath: string;
  data: Omit<SessionFile, "claude_env_file" | "created_at">;
}

function createSession(userConfig: EffectiveCodexLeadUserConfig): SessionInfo {
  const sessionId = `session_${randomUUID().slice(0, 8)}`;
  const projectPath = process.cwd();
  const sessionDir = path.join(userConfig.runtime_home, "sessions", sessionId);
  const taskDir = path.join(sessionDir, "tasks");
  const artifactRoot = path.join(sessionDir, "artifacts");

  // ALL runtime paths MUST be inside supervisor_home
  assertPathInside(sessionDir, userConfig.supervisor_home, "sessionDir");
  assertPathInside(taskDir, userConfig.supervisor_home, "taskDir");
  assertPathInside(artifactRoot, userConfig.supervisor_home, "artifactRoot");

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

// ── CLI ──

function parseArgs(args: string[]): { doctor: boolean; codexArgs: string[] } {
  let doctor = false;
  const codexArgs: string[] = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    if (arg === "--doctor") { doctor = true; continue; }
    codexArgs.push(arg);
  }
  return { doctor, codexArgs };
}

function ensureClaudeMd(supervisorHome: string): void {
  const p = path.join(supervisorHome, "CLAUDE.md");
  if (!existsSync(p)) {
    mkdirSync(supervisorHome, { recursive: true });
    writeFileSync(p, DEFAULT_CLAUDE_MD, "utf8");
  }
}

function assertReadyToLaunch(userConfig: EffectiveCodexLeadUserConfig): void {
  if (!checkCommand("codex").ok) throw new Error("codex command is not available on PATH.");
  if (!checkRuntimeCommand(userConfig.claude_runtime.command).ok) {
    process.stderr.write(`Warning: Claude "${userConfig.claude_runtime.command}" not available.\n`);
  }
}

// ── Doctor ──

function printDoctor(userConfig: EffectiveCodexLeadUserConfig): void {
  const installSource = detectInstallSource(repoRoot);

  let envBridgeOk = false;
  try {
    const sid = `doctor_${randomUUID().slice(0, 8)}`;
    const r = prepareClaudeRuntimeEnvFile({ runtimeHome: userConfig.runtime_home, sessionId: sid, config: userConfig.claude_runtime });
    envBridgeOk = Boolean(r.env_file && existsSync(r.env_file));
  } catch { /* ignore */ }

  const rtInside = isPathInside(userConfig.runtime_home, userConfig.supervisor_home);
  const taskProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
  const artifactProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
  const envProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));

  const checks = [
    { name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
    checkCommand("npm"), checkCommand("codex"), checkCommand("git"),
    checkRuntimeCommand(userConfig.claude_runtime.command),
    { name: "supervisor_home", ok: existsSync(userConfig.supervisor_home), detail: userConfig.supervisor_home },
    { name: "runtime_home", ok: existsSync(userConfig.runtime_home), detail: userConfig.runtime_home },
    { name: "runtime_home_inside_supervisor_home", ok: rtInside, detail: rtInside ? "ok" : `WARNING: runtime_home is outside supervisor_home — subagent writes may fail. Run: codex_lead_cc config reset` },
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

function writeProbe(dir: string): { ok: boolean; detail: string } {
  try {
    mkdirSync(dir, { recursive: true });
    return { ok: true, detail: dir };
  } catch (e) {
    const msg = e instanceof Error ? `${e.message} (${(e as NodeJS.ErrnoException).code ?? "unknown"})` : String(e);
    return { ok: false, detail: msg };
  }
}

function checkCommand(cmd: string): { name: string; ok: boolean; detail: string } {
  const r = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  return { name: `${cmd}_available`, ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found" };
}

function checkRuntimeCommand(cmd: string): { name: string; ok: boolean; detail: string } {
  if (cmd.includes("/")) return { name: "claude_available", ok: existsSync(cmd), detail: cmd };
  const r = spawnSync("bash", ["-lc", `command -v ${shellQuote(cmd)}`], { encoding: "utf8" });
  return { name: "claude_available", ok: r.status === 0, detail: r.stdout.trim() || r.stderr.trim() || "not found" };
}

// ── Config ──

async function runConfigCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "show";
  if (sub === "path") { process.stdout.write(`${userConfigPath()}\n`); return; }
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

function shellQuote(v: string): string { return `'${v.replace(/'/g, "'\\''")}'`; }

function printHelp(): void {
  process.stdout.write(`codex_lead_cc — Codex Lead Supervisor Launcher

Usage:
  codex_lead_cc [--doctor] [codex args...]
  codex_lead_cc delegate --task-file <path> --session-file <path>
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc config show | reset | path

Supervisor behavior is loaded from CLAUDE.md in supervisor_home.
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
