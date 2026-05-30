#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODEX_LEAD_CC_ENV_FILE,
  prepareClaudeRuntimeEnvFile,
  redactConfigForDisplay,
  type PreparedClaudeRuntimeEnv,
} from "../claude/claude_runtime_env.js";
import {
  ensureUserConfigDirectories,
  loadOrCreateUserConfig,
  resetUserConfig,
  userConfigPath,
  type EffectiveCodexLeadUserConfig,
} from "../config/user_config.js";
import { normalizeMcpExposure, type McpExposure } from "../mcp/exposure.js";
import { registerProjectSession, type ProjectContext } from "../orchestrator/project_registry.js";
import { StateStore } from "../orchestrator/state_store.js";
import { detectInstallSource, parseUpdateArgs, runUpdate } from "./update.js";

type WrapperMode = "supervisor" | "dev" | "off";

interface WrapperOptions {
  mode: WrapperMode;
  exposure?: McpExposure;
  dryRun: boolean;
  printConfig: boolean;
  doctor: boolean;
  verbose: boolean;
  codexArgs: string[];
}

interface CodexLaunch {
  command: string;
  args: string[];
  cwd: string;
  mode: WrapperMode;
  exposure: McpExposure;
  mcp_entry: string;
  skill_path: string;
  supervisor_home: string;
  runtime_home: string;
  project_id?: string;
  session_id?: string;
  claude_env_file?: string;
  claude_runtime_command: string;
  claude_env_names: string[];
  configToml: string;
  notes: string[];
  warnings: string[];
}

const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(wrapperDir, "..");
const repoRoot = path.resolve(distRoot, "..");
const mcpEntry = path.join(distRoot, "index.js");
const skillPath = path.join(repoRoot, "codex-plugin", "skills", "codex_lead_cc_supervisor", "SKILL.md");

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

  const options = parseArgs(rawArgs);
  const userConfig = await loadOrCreateUserConfig();
  await ensureUserConfigDirectories(userConfig);
  const supervisorInstruction = readSupervisorInstruction();
  const launchSession = options.dryRun || options.doctor || options.printConfig
    ? previewProjectContext()
    : await createLaunchSession(userConfig);
  const claudeRuntimeEnv = options.mode === "off"
    ? undefined
    : prepareClaudeRuntimeEnvFile({
      runtimeHome: userConfig.runtime_home,
      sessionId: launchSession.session_id,
      config: userConfig.claude_runtime,
    });
  const launch = buildCodexLaunch(options, supervisorInstruction, userConfig, launchSession, claudeRuntimeEnv);

  if (options.doctor) {
    printDoctor(launch, userConfig, claudeRuntimeEnv);
    return;
  }
  if (options.printConfig) {
    process.stdout.write(`${launch.configToml}\n`);
    return;
  }
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(launch, null, 2)}\n`);
    return;
  }

  assertReadyToLaunch(userConfig);

  const child = spawn("codex", launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      PWD: launch.cwd,
    },
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

function parseArgs(args: string[]): WrapperOptions {
  let mode: WrapperMode = "supervisor";
  let explicitExposure: McpExposure | undefined;
  let dryRun = false;
  let printConfig = false;
  let doctor = false;
  let verbose = false;
  const codexArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--") {
      codexArgs.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--mode") {
      if (!next || !["supervisor", "dev", "off"].includes(next)) {
        throw new Error("--mode requires supervisor, dev, or off.");
      }
      mode = next as WrapperMode;
      index += 1;
      continue;
    }
    if (arg === "--mcp-exposure" || arg === "--exposure") {
      if (!next) {
        throw new Error(`${arg} requires compact or full.`);
      }
      explicitExposure = normalizeMcpExposure(next);
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--print-config") {
      printConfig = true;
      continue;
    }
    if (arg === "--doctor") {
      doctor = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    codexArgs.push(arg);
  }

  return {
    mode,
    exposure: explicitExposure,
    dryRun,
    printConfig,
    doctor,
    verbose,
    codexArgs,
  };
}

function buildCodexLaunch(
  options: WrapperOptions,
  supervisorInstruction: string,
  userConfig: EffectiveCodexLeadUserConfig,
  projectContext?: ProjectContext,
  claudeRuntimeEnv?: PreparedClaudeRuntimeEnv,
): CodexLaunch {
  const notes = [
    "Uses transient `codex -c` overrides and does not edit the default Codex config.",
    "Codex runs from supervisor_home; Claude Code workers inherit the project through session mapping.",
  ];
  const args: string[] = [];
  const exposure = options.exposure ?? (options.mode === "dev" ? "full" : userConfig.default_mcp_exposure);

  if (options.mode !== "off") {
    const mcpEnv: Record<string, string> = {
      AGENTFOREMAN_HOME: userConfig.runtime_home,
    };
    if (projectContext) {
      mcpEnv.CODEX_LEAD_CC_SESSION_ID = projectContext.session_id;
      mcpEnv.CODEX_LEAD_CC_PROJECT_ID = projectContext.project_id;
    }
    if (claudeRuntimeEnv) {
      mcpEnv[CODEX_LEAD_CC_ENV_FILE] = claudeRuntimeEnv.env_file;
    }

    args.push(
      "-c",
      `mcp_servers.codex_lead_cc.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.codex_lead_cc.args=${tomlArray([mcpEntry, "mcp", "--exposure", exposure])}`,
    );
    for (const [key, value] of Object.entries(mcpEnv)) {
      args.push("-c", `mcp_servers.codex_lead_cc.env.${key}=${tomlString(value)}`);
    }
  }

  args.push(...injectSupervisorInstruction(options, supervisorInstruction));

  return {
    command: "codex",
    args,
    cwd: userConfig.supervisor_home,
    mode: options.mode,
    exposure,
    mcp_entry: mcpEntry,
    skill_path: skillPath,
    supervisor_home: userConfig.supervisor_home,
    runtime_home: userConfig.runtime_home,
    project_id: projectContext?.project_id,
    session_id: projectContext?.session_id,
    claude_env_file: claudeRuntimeEnv?.env_file,
    claude_runtime_command: userConfig.claude_runtime.command,
    claude_env_names: claudeRuntimeEnv?.env_names ?? [],
    configToml: buildConfigToml(options, userConfig, projectContext, exposure, claudeRuntimeEnv),
    notes,
    warnings: claudeRuntimeEnv?.warnings ?? [],
  };
}

function injectSupervisorInstruction(options: WrapperOptions, supervisorInstruction: string): string[] {
  if (options.mode === "off") {
    return options.codexArgs;
  }

  if (options.codexArgs.length === 0) {
    return [supervisorInstruction];
  }

  const first = options.codexArgs[0];
  if (!first.startsWith("-") && !["exec", "e", "review"].includes(first)) {
    return [`${supervisorInstruction}\n\nUser request:\n${options.codexArgs.join(" ")}`];
  }

  return [
    ...options.codexArgs,
    supervisorInstruction,
  ];
}

function buildConfigToml(
  options: WrapperOptions,
  userConfig: EffectiveCodexLeadUserConfig,
  projectContext: ProjectContext | undefined,
  exposure: McpExposure,
  claudeRuntimeEnv?: PreparedClaudeRuntimeEnv,
): string {
  if (options.mode === "off") {
    return "# mode=off: no codex_lead_cc MCP configuration is generated.";
  }
  const lines = [
    "[mcp_servers.codex_lead_cc]",
    `command = ${tomlString(process.execPath)}`,
    `args = ${tomlArray([mcpEntry, "mcp", "--exposure", exposure])}`,
    "",
    "[mcp_servers.codex_lead_cc.env]",
    `AGENTFOREMAN_HOME = ${tomlString(userConfig.runtime_home)}`,
  ];
  if (projectContext) {
    lines.push(
      `CODEX_LEAD_CC_SESSION_ID = ${tomlString(projectContext.session_id)}`,
      `CODEX_LEAD_CC_PROJECT_ID = ${tomlString(projectContext.project_id)}`,
    );
  }
  if (claudeRuntimeEnv) {
    lines.push(`${CODEX_LEAD_CC_ENV_FILE} = ${tomlString(claudeRuntimeEnv.env_file)}`);
  }
  return lines.join("\n");
}

function printDoctor(
  launch: ReturnType<typeof buildCodexLaunch>,
  userConfig: EffectiveCodexLeadUserConfig,
  claudeRuntimeEnv?: PreparedClaudeRuntimeEnv,
): void {
  const checks = readinessChecks(userConfig, claudeRuntimeEnv);
  process.stdout.write(`${JSON.stringify({ ...launch, checks }, null, 2)}\n`);
}

function assertReadyToLaunch(userConfig: EffectiveCodexLeadUserConfig): void {
  const checks = readinessChecks(userConfig);
  const codex = checks.find((check) => check.name === "codex_available");
  const mcpEntryBuilt = checks.find((check) => check.name === "mcp_entry_built");
  if (!codex?.ok) {
    throw new Error("codex command is not available on PATH.");
  }
  if (!mcpEntryBuilt?.ok) {
    throw new Error(`codex_lead_cc is not built. Run npm run build first. Missing: ${mcpEntry}`);
  }
  const claude = checks.find((check) => check.name === "claude_available");
  if (!claude?.ok) {
    process.stderr.write("Warning: claude command is not available on PATH. Install or configure Claude Code CLI before assigning real worker tasks.\n");
  }
}

function readinessChecks(
  userConfig?: EffectiveCodexLeadUserConfig,
  claudeRuntimeEnv?: PreparedClaudeRuntimeEnv,
): Array<{ name: string; ok: boolean; detail: string; value?: unknown }> {
  const installSource = detectInstallSource(repoRoot);
  const claudeCommand = userConfig?.claude_runtime.command ?? "claude";
  const claudeArgsPrefix = userConfig?.claude_runtime.args_prefix ?? [];
  const checks: Array<{ name: string; ok: boolean; detail: string; value?: unknown }> = [
    {
      name: "node_version",
      ok: Number(process.versions.node.split(".")[0]) >= 20,
      detail: process.version,
    },
    checkCommand("npm"),
    checkCommand("codex"),
    checkRuntimeCommand(claudeCommand),
    checkLaunchable(claudeCommand, [...claudeArgsPrefix, "--help"]),
    {
      name: "mcp_entry_built",
      ok: existsSync(mcpEntry),
      detail: mcpEntry,
    },
    {
      name: "supervisor_skill",
      ok: existsSync(skillPath),
      detail: skillPath,
    },
    {
      name: "config_isolation",
      ok: true,
      detail: "wrapper uses transient codex -c overrides and supervisor_home cwd; default Codex config is not edited",
    },
    {
      name: "install_source",
      ok: true,
      detail: installSource.detail,
      value: installSource,
    },
  ];
  if (userConfig) {
    checks.push(
      {
        name: "codex_lead_cc_config",
        ok: existsSync(userConfig.config_path),
        detail: userConfig.config_path,
      },
      {
        name: "supervisor_home",
        ok: existsSync(userConfig.supervisor_home),
        detail: userConfig.supervisor_home,
      },
      {
        name: "runtime_home",
        ok: existsSync(userConfig.runtime_home),
        detail: userConfig.runtime_home,
      },
      {
        name: "claude_runtime_command",
        ok: true,
        detail: userConfig.claude_runtime.command,
        value: {
          command: userConfig.claude_runtime.command,
          args_prefix: userConfig.claude_runtime.args_prefix,
        },
      },
      {
        name: "claude_env_passthrough",
        ok: true,
        detail: `${userConfig.claude_runtime.env_passthrough.length} allowlisted variable names`,
        value: {
          allowlist: userConfig.claude_runtime.env_passthrough,
          captured_names: claudeRuntimeEnv?.env_names ?? [],
          captured_redacted: claudeRuntimeEnv?.redacted_env ?? {},
        },
      },
      {
        name: "claude_env_file",
        ok: Boolean(claudeRuntimeEnv?.env_file && existsSync(claudeRuntimeEnv.env_file)),
        detail: claudeRuntimeEnv?.env_file ?? "not generated",
      },
      {
        name: "claude_env_provider",
        ok: (claudeRuntimeEnv?.warnings.length ?? 0) === 0,
        detail: userConfig.claude_runtime.env_provider.enabled
          ? "enabled"
          : "disabled",
        value: {
          enabled: userConfig.claude_runtime.env_provider.enabled,
          command: userConfig.claude_runtime.env_provider.command,
          args: userConfig.claude_runtime.env_provider.args,
          warnings: claudeRuntimeEnv?.warnings ?? [],
        },
      },
    );
  }
  return checks;
}

function checkCommand(command: string): { name: string; ok: boolean; detail: string } {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  return {
    name: `${command}_available`,
    ok: result.status === 0,
    detail: result.stdout.trim() || result.stderr.trim() || "not found on PATH",
  };
}

function checkRuntimeCommand(command: string): { name: string; ok: boolean; detail: string } {
  if (command.includes("/")) {
    return {
      name: "claude_available",
      ok: existsSync(command),
      detail: command,
    };
  }
  const result = spawnSync("bash", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
  });
  return {
    name: "claude_available",
    ok: result.status === 0,
    detail: result.stdout.trim() || result.stderr.trim() || "not found on PATH",
  };
}

function checkLaunchable(command: string, args: string[]): { name: string; ok: boolean; detail: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5_000,
    stdio: "ignore",
  });
  if (result.status === 0) {
    return {
      name: "claude_launchable",
      ok: true,
      detail: `${command} command is callable`,
    };
  }
  if (result.error) {
    return {
      name: "claude_launchable",
      ok: false,
      detail: result.error.message,
    };
  }
  return {
    name: "claude_launchable",
    ok: false,
    detail: `${command} exited with code ${result.status ?? "unknown"}`,
  };
}

function readSupervisorInstruction(): string {
  if (existsSync(skillPath)) {
    return readFileSync(skillPath, "utf8").trim();
  }
  return [
    "You are in codex_lead_cc Supervisor Mode.",
    "Do not directly read source files, run shell commands, or edit project files.",
    "Use only cc_dispatch, cc_wait, cc_inspect, and cc_decide to manage Claude Code workers.",
  ].join("\n");
}

async function createLaunchSession(userConfig: EffectiveCodexLeadUserConfig): Promise<ProjectContext> {
  const session = await registerProjectSession({
    store: new StateStore(userConfig.runtime_home),
    projectPath: process.cwd(),
    supervisorHome: userConfig.supervisor_home,
  });
  return {
    session_id: session.session_id,
    project_id: session.project_id,
    project_path: session.project_path,
  };
}

function previewProjectContext(): ProjectContext {
  return {
    session_id: "sup_session_preview",
    project_id: "proj_preview",
    project_path: "",
  };
}

async function runConfigCommand(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "show";
  if (subcommand === "path") {
    process.stdout.write(`${userConfigPath()}\n`);
    return;
  }
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

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function printHelp(): void {
  process.stdout.write(`codex_lead_cc Supervisor Mode wrapper

Usage:
  codex_lead_cc [--mode supervisor|dev|off] [--mcp-exposure compact|full] [--dry-run]
  codex_lead_cc --doctor
  codex_lead_cc --print-config
  codex_lead_cc config show
  codex_lead_cc config reset
  codex_lead_cc config path
  codex_lead_cc update [--from <git-url>] [--dry-run]
  codex_lead_cc -- <codex args>

Default mode is supervisor with compact MCP exposure. The wrapper starts the real
codex command from supervisor_home with transient config overrides and does not
edit the default Codex config.
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
