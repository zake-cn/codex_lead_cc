#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareClaudeRuntimeEnvFile,
  redactConfigForDisplay,
} from "../claude/claude_runtime_env.js";
import {
  ensureUserConfigDirectories,
  loadOrCreateUserConfig,
  resetUserConfig,
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

const DEFAULT_AGENTS_MD = `# codex_lead_cc Supervisor Rules

You are Codex Lead in codex_lead_cc.

You run inside supervisor_home. The real project path is only reachable through session files stored in CODEX_LEAD_CC_SESSION_FILE.

You must not read, inspect, modify, or run commands inside the real project directory.

You must not call claude directly.

You must not call codex_lead_cc delegate directly in the main thread.

When work needs project contact:

1. Create a TaskFile under CODEX_LEAD_CC_TASK_DIR with a unique task ID.
2. Write it as \`<task_id>.md\` following the TaskFile format.
3. Spawn a Codex subagent.

The subagent is only a cc_delegate shell. Give the subagent this exact instruction:

---

You are cc_delegate, a thin Codex subagent shell.

Do not inspect project files.
Do not analyze the repository yourself.
Do not modify files yourself.
Do not run project commands yourself.
Do not call claude directly.

Your only job is to invoke codex_lead_cc delegate for the provided TaskFile and return its compact result.

Run:

  export CODEX_CLAUDE_CHILD_THREAD=1
  codex_lead_cc delegate --task-file "<TASK_FILE>" --session-file "$CODEX_LEAD_CC_SESSION_FILE"

After the command completes, return:
- delegate status
- summary
- changed files
- verification result
- artifact path
- any error message

Do not add unrelated analysis.

---

TaskFile format:

\`\`\`markdown
# codex_lead_cc Task

TaskId: task_001
WorkerType: readonly

## Goal
...

## Allowed Scope
...

## Forbidden Actions
...

## Acceptance Criteria
...

## Verification
...

## Report Requirements
Status
Summary
Changed Files
Verification
Findings
Final Result
Risks Or Follow-ups
\`\`\`

WorkerType must be "readonly" or "write".
- readonly = Claude may inspect and analyze but not modify files.
- write = Claude may modify files within Allowed Scope.
`;

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
    // delegate is handled by src/index.ts; if reached here, forward
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

  // Ensure AGENTS.md exists in supervisor_home
  ensureAgentsMd(userConfig.supervisor_home);

  // Generate session
  const session = createSession(userConfig);

  // Prepare Claude runtime env file
  const claudeEnv = prepareClaudeRuntimeEnvFile({
    runtimeHome: userConfig.runtime_home,
    sessionId: session.sessionId,
    config: userConfig.claude_runtime,
  });

  // Write session file with claude_env_file path
  writeFileSync(
    session.filePath,
    JSON.stringify(
      {
        ...session.data,
        claude_env_file: claudeEnv.env_file,
      },
      null, 2,
    ) + "\n",
    "utf8",
  );

  // Build Codex env — pass session info, NOT project_path directly
  const codexEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    PWD: userConfig.supervisor_home,
    CODEX_LEAD_CC_SESSION_ID: session.sessionId,
    CODEX_LEAD_CC_SESSION_FILE: session.filePath,
    CODEX_LEAD_CC_TASK_DIR: session.data.task_dir,
    CODEX_LEAD_CC_ARTIFACT_ROOT: session.data.artifact_root,
    CODEX_LEAD_CC_SUPERVISOR_HOME: userConfig.supervisor_home,
  };

  assertReadyToLaunch(userConfig);

  // User prompt IS the first Codex message (no prepended supervisor text)
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

// ── Session file generation ──

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

function parseArgs(args: string[]): { doctor: boolean; codexArgs: string[] } {
  let doctor = false;
  const codexArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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

// ── AGENTS.md ──

function ensureAgentsMd(supervisorHome: string): void {
  const agentsPath = path.join(supervisorHome, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    mkdirSync(supervisorHome, { recursive: true });
    writeFileSync(agentsPath, DEFAULT_AGENTS_MD, "utf8");
  }
}

// ── Readiness ──

function assertReadyToLaunch(userConfig: EffectiveCodexLeadUserConfig): void {
  const codex = checkCommand("codex");
  if (!codex.ok) {
    throw new Error("codex command is not available on PATH.");
  }
  const claude = checkRuntimeCommand(userConfig.claude_runtime.command);
  if (!claude.ok) {
    process.stderr.write(
      `Warning: Claude runtime "${userConfig.claude_runtime.command}" is not available.\n`,
    );
  }
}

// ── Doctor ──

function printDoctor(userConfig: EffectiveCodexLeadUserConfig): void {
  const installSource = detectInstallSource(repoRoot);

  // Test env bridge
  let envBridgeOk = false;
  try {
    const sessionId = `doctor_${randomUUID().slice(0, 8)}`;
    const result = prepareClaudeRuntimeEnvFile({
      runtimeHome: userConfig.runtime_home,
      sessionId,
      config: userConfig.claude_runtime,
    });
    envBridgeOk = Boolean(result.env_file && existsSync(result.env_file));
  } catch {
    // env bridge generation failed
  }

  const checks = [
    { name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
    checkCommand("npm"),
    checkCommand("codex"),
    checkCommand("git"),
    checkRuntimeCommand(userConfig.claude_runtime.command),
    { name: "supervisor_home", ok: existsSync(userConfig.supervisor_home), detail: userConfig.supervisor_home },
    { name: "runtime_home", ok: existsSync(userConfig.runtime_home), detail: userConfig.runtime_home },
    { name: "codex_lead_cc_config", ok: existsSync(userConfig.config_path), detail: userConfig.config_path },
    { name: "agents_md", ok: existsSync(path.join(userConfig.supervisor_home, "AGENTS.md")), detail: path.join(userConfig.supervisor_home, "AGENTS.md") },
    { name: "install_source", ok: true, detail: installSource.detail, value: installSource },
    { name: "claude_runtime_command", ok: true, detail: userConfig.claude_runtime.command, value: { command: userConfig.claude_runtime.command, args_prefix: userConfig.claude_runtime.args_prefix } },
    { name: "env_bridge", ok: envBridgeOk, detail: envBridgeOk ? "claude_env.json generated successfully" : "env bridge generation failed" },
  ];

  process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);
}

function checkCommand(command: string): { name: string; ok: boolean; detail: string } {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return { name: `${command}_available`, ok: result.status === 0, detail: result.stdout.trim() || result.stderr.trim() || "not found on PATH" };
}

function checkRuntimeCommand(command: string): { name: string; ok: boolean; detail: string } {
  if (command.includes("/")) return { name: "claude_available", ok: existsSync(command), detail: command };
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], { encoding: "utf8" });
  return { name: "claude_available", ok: result.status === 0, detail: result.stdout.trim() || result.stderr.trim() || "not found on PATH" };
}

// ── Config command ──

async function runConfigCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "show";
  if (subcommand === "path") { process.stdout.write(`${userConfigPath()}\n`); return; }
  if (subcommand === "show") {
    const config = await loadOrCreateUserConfig();
    await ensureUserConfigDirectories(config);
    process.stdout.write(`${JSON.stringify(redactConfigForDisplay(config), null, 2)}\n`);
    return;
  }
  if (subcommand === "reset") {
    const config = await resetUserConfig();
    await ensureUserConfigDirectories(config);
    process.stdout.write(`${JSON.stringify(redactConfigForDisplay(config), null, 2)}\n`);
    return;
  }
  throw new Error("config requires one of: show, reset, path.");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function printHelp(): void {
  process.stdout.write(`codex_lead_cc — Codex Lead Supervisor Launcher

Usage:
  codex_lead_cc [--doctor] [codex args...]
  codex_lead_cc delegate --task-file <path> --session-file <path>
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc config show | reset | path

The wrapper starts Codex from supervisor_home.
Supervisor behavior is loaded from AGENTS.md in supervisor_home.
Session info is passed via CODEX_LEAD_CC_SESSION_FILE env var.
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
