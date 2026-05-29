#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeMcpExposure, type McpExposure } from "../mcp/exposure.js";

type WrapperMode = "supervisor" | "dev" | "off";

interface WrapperOptions {
  mode: WrapperMode;
  exposure: McpExposure;
  dryRun: boolean;
  printConfig: boolean;
  doctor: boolean;
  codexArgs: string[];
}

const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(wrapperDir, "..");
const repoRoot = path.resolve(distRoot, "..");
const mcpEntry = path.join(distRoot, "index.js");
const skillPath = path.join(repoRoot, "codex-plugin", "skills", "codex-lead-cc-supervisor", "SKILL.md");

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const supervisorInstruction = readSupervisorInstruction();
  const launch = buildCodexLaunch(options, supervisorInstruction);

  if (options.doctor) {
    printDoctor(launch);
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

  assertReadyToLaunch();

  const child = spawn("codex", launch.args, {
    cwd: process.cwd(),
    env: process.env,
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
    codexArgs.push(arg);
  }

  return {
    mode,
    exposure: explicitExposure ?? (mode === "dev" ? "full" : "compact"),
    dryRun,
    printConfig,
    doctor,
    codexArgs,
  };
}

function buildCodexLaunch(options: WrapperOptions, supervisorInstruction: string): {
  command: string;
  args: string[];
  mode: WrapperMode;
  exposure: McpExposure;
  mcp_entry: string;
  skill_path: string;
  configToml: string;
  notes: string[];
} {
  const notes = [
    "Uses transient `codex -c` overrides and does not edit the default Codex config.",
  ];
  const args: string[] = [];

  if (options.mode !== "off") {
    args.push(
      "-c",
      `mcp_servers.codex_lead_cc.command=${tomlString(process.execPath)}`,
      "-c",
      `mcp_servers.codex_lead_cc.args=${tomlArray([mcpEntry, "mcp", "--exposure", options.exposure])}`,
      "-c",
      `mcp_servers.codex_lead_cc.env.AGENTFOREMAN_HOME=${tomlString(process.env.AGENTFOREMAN_HOME ?? path.resolve(process.cwd(), ".agentforeman"))}`,
    );
  }

  args.push(...injectSupervisorInstruction(options, supervisorInstruction));

  return {
    command: "codex",
    args,
    mode: options.mode,
    exposure: options.exposure,
    mcp_entry: mcpEntry,
    skill_path: skillPath,
    configToml: buildConfigToml(options),
    notes,
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

function buildConfigToml(options: WrapperOptions): string {
  if (options.mode === "off") {
    return "# mode=off: no codex_lead_cc MCP configuration is generated.";
  }
  return [
    "[mcp_servers.codex_lead_cc]",
    `command = ${tomlString(process.execPath)}`,
    `args = ${tomlArray([mcpEntry, "mcp", "--exposure", options.exposure])}`,
    "",
    "[mcp_servers.codex_lead_cc.env]",
    `AGENTFOREMAN_HOME = ${tomlString(process.env.AGENTFOREMAN_HOME ?? path.resolve(process.cwd(), ".agentforeman"))}`,
  ].join("\n");
}

function printDoctor(launch: ReturnType<typeof buildCodexLaunch>): void {
  const checks = readinessChecks();
  process.stdout.write(`${JSON.stringify({ ...launch, checks }, null, 2)}\n`);
}

function assertReadyToLaunch(): void {
  const checks = readinessChecks();
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
    process.stderr.write("Warning: claude command is not available on PATH. Worker tasks will fail until Claude Code is installed and logged in.\n");
  }
}

function readinessChecks(): Array<{ name: string; ok: boolean; detail: string }> {
  return [
    checkCommand("codex"),
    checkCommand("claude"),
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
      detail: "wrapper uses transient codex -c overrides; default Codex config is not edited",
    },
  ];
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

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function printHelp(): void {
  process.stdout.write(`codex_lead_cc Supervisor Mode wrapper

Usage:
  codex_lead_cc [--mode supervisor|dev|off] [--mcp-exposure compact|full] [--dry-run]
  codex_lead_cc --doctor
  codex_lead_cc --print-config
  codex_lead_cc -- <codex args>

Default mode is supervisor with compact MCP exposure. The wrapper starts the real
codex command with transient config overrides and does not edit the default
Codex config.
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
