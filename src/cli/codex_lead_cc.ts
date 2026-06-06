#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  ensureSupervisorFiles,
  formatSupervisorMigrationSummary,
  migrateSupervisorFiles,
} from "../supervisor.js";
import type { SessionFile } from "../types.js";

const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(wrapperDir, "..", "..");

// ── main ──

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const codexLeadBin = process.argv[1] || path.join(wrapperDir, "codex_lead_cc.js");

  if (rawArgs[0] === "update") {
    const updateOptions = parseUpdateArgs(rawArgs.slice(1));
    const updateCode = runUpdate(updateOptions, repoRoot);
    if (updateCode !== 0 || updateOptions.dryRun) {
      process.exitCode = updateCode;
      return;
    }
    const migration = spawnSync(process.execPath, [codexLeadBin, "migrate-supervisor"], {
      stdio: "inherit",
      env: process.env,
    });
    process.exitCode = migration.status ?? 1;
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
  if (rawArgs[0] === "migrate-supervisor") {
    const userConfig = await loadOrCreateUserConfig();
    await ensureUserConfigDirectories(userConfig);
    const summary = migrateSupervisorFiles(userConfig.supervisor_home);
    process.stdout.write(formatSupervisorMigrationSummary(summary));
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
  if (rtw) process.stderr.write(`Warning: ${rtw}\n`);

  const supervisor = ensureSupervisorFiles(userConfig.supervisor_home);
  if (supervisor.stale) {
    process.stderr.write("Supervisor rules are stale. Run: codex_lead_cc migrate-supervisor\n");
  }
  const session = createSession(userConfig);

  const claudeEnv = prepareClaudeRuntimeEnvFile({
    runtimeHome: userConfig.runtime_home,
    sessionId: session.sessionId,
    config: userConfig.claude_runtime,
  });

  const sessionData: SessionFile = {
    ...session.data,
    claude_env_file: claudeEnv.env_file,
  };
  writeSessionFile(session.filePath, sessionData);

  assertReadyToLaunch(userConfig);

  const bridge = startCcBridge({
    sessionFile: session.filePath,
    bridgeDir: session.data.bridge_dir,
    supervisorHome: userConfig.supervisor_home,
  });
  if (bridge.pid) {
    sessionData.bridge_pid = bridge.pid;
    writeSessionFile(session.filePath, sessionData);
  }
  const bridgeReady = await waitForBridgeReady(session.data.bridge_state_file, session.sessionId, 5_000);
  if (!bridgeReady) {
    process.stderr.write(`Warning: CC bridge was not ready within 5s. See ${bridge.logPath}\n`);
  }

  const codexEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    PWD: userConfig.supervisor_home,
    CODEX_LEAD_CC_SESSION_ID: session.sessionId,
    CODEX_LEAD_CC_SESSION_FILE: session.filePath,
    CODEX_LEAD_CC_BRIDGE_DIR: session.data.bridge_dir,
    CODEX_LEAD_CC_BRIDGE_STATE: session.data.bridge_state_file,
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
    if (signal) { process.kill(process.pid, signal); return; }
    process.exitCode = code ?? 1;
  });
}

// ── Session ──

interface SessionInfo {
  sessionId: string;
  sessionDir: string;
  filePath: string;
  data: Omit<SessionFile, "claude_env_file" | "bridge_pid" | "cc_pid">;
}

function createSession(userConfig: EffectiveCodexLeadUserConfig): SessionInfo {
  const sessionId = `session_${randomUUID().slice(0, 8)}`;
  const projectPath = process.cwd();
  const sessionDir = path.join(userConfig.runtime_home, "sessions", sessionId);
  const artifactRoot = path.join(sessionDir, "artifacts");
  const bridgeDir = path.join(sessionDir, "bridge");
  const bridgeInbox = path.join(bridgeDir, "inbox");
  const bridgeStreams = path.join(bridgeDir, "streams");
  const bridgeResults = path.join(bridgeDir, "results");
  const bridgeStateFile = path.join(bridgeDir, "state.json");

  // ALL runtime paths MUST be inside supervisor_home
  assertPathInside(sessionDir, userConfig.supervisor_home, "sessionDir");
  assertPathInside(artifactRoot, userConfig.supervisor_home, "artifactRoot");
  assertPathInside(bridgeDir, userConfig.supervisor_home, "bridgeDir");
  assertPathInside(bridgeStateFile, userConfig.supervisor_home, "bridgeStateFile");

  mkdirSync(artifactRoot, { recursive: true });
  mkdirSync(bridgeInbox, { recursive: true });
  mkdirSync(bridgeStreams, { recursive: true });
  mkdirSync(bridgeResults, { recursive: true });

  return {
    sessionId,
    sessionDir,
    filePath: path.join(sessionDir, "session.json"),
    data: {
      version: 2,
      session_id: sessionId,
      project_path: projectPath,
      supervisor_home: userConfig.supervisor_home,
      session_dir: sessionDir,
      artifact_root: artifactRoot,
      bridge_dir: bridgeDir,
      bridge_state_file: bridgeStateFile,
      created_at: new Date().toISOString(),
    },
  };
}

// ── CC Bridge ──

interface StartedBridge {
  pid: number | undefined;
  logPath: string;
  process: ChildProcess;
}

function startCcBridge(args: {
  sessionFile: string;
  bridgeDir: string;
  supervisorHome: string;
}): StartedBridge {
  const logPath = path.join(args.bridgeDir, "bridge.log");
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

async function waitForBridgeReady(stateFile: string, sessionId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isBridgeStateReady(stateFile, sessionId)) return true;
    await sleep(100);
  }
  return isBridgeStateReady(stateFile, sessionId);
}

function stopCcBridge(bridge: StartedBridge): void {
  if (!bridge.pid || !isProcessAlive(bridge.pid)) return;
  try {
    bridge.process.kill("SIGTERM");
  } catch {
    // The bridge also monitors the wrapper pid and will self-exit.
  }
}

function isBridgeStateReady(stateFile: string, sessionId: string): boolean {
  if (!existsSync(stateFile)) return false;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { session_id?: unknown; bridge_pid?: unknown };
    return state.session_id === sessionId && typeof state.bridge_pid === "number";
  } catch {
    return false;
  }
}

function writeSessionFile(sessionFile: string, session: SessionFile): void {
  writeFileSync(sessionFile, JSON.stringify(session, null, 2) + "\n", "utf8");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const sessionProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
  const artifactProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));
  const bridgeProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe", "bridge"));
  const envProbe = writeProbe(path.join(userConfig.runtime_home, "sessions", ".doctor_probe"));

  const checks = [
    { name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
    checkCommand("npm"), checkCommand("codex"), checkCommand("git"),
    checkCommand("script"),
    checkRuntimeCommand(userConfig.claude_runtime.command),
    { name: "supervisor_home", ok: existsSync(userConfig.supervisor_home), detail: userConfig.supervisor_home },
    { name: "runtime_home", ok: existsSync(userConfig.runtime_home), detail: userConfig.runtime_home },
    { name: "runtime_home_inside_supervisor_home", ok: rtInside, detail: rtInside ? "ok" : `WARNING: runtime_home is outside supervisor_home — bridge writes may fail. Run: codex_lead_cc config reset` },
    { name: "session_dir_writable", ok: sessionProbe.ok, detail: sessionProbe.detail },
    { name: "artifact_root_writable", ok: artifactProbe.ok, detail: artifactProbe.detail },
    { name: "bridge_dir_writable", ok: bridgeProbe.ok, detail: bridgeProbe.detail },
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
  process.stdout.write(`codex_lead_cc — Codex-to-Claude-Code Interactive Bridge

Usage:
  codex_lead_cc [--doctor] [codex args...]
  codex_lead_cc cc-send [--timeout-sec 120] [--stream] "prompt"
  codex_lead_cc cc-input --key <1|2|3|enter|escape|ctrl-c> [--stream]
  codex_lead_cc cc-status
  codex_lead_cc migrate-supervisor
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc config show | reset | path

Supervisor behavior is loaded from CLAUDE.md in supervisor_home.
cc-send, cc-input, and cc-status require an active codex_lead_cc Codex session environment.
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
