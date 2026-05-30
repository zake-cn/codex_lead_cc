import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeMcpExposure, type McpExposure } from "../mcp/exposure.js";

export interface CodexLeadUserConfig {
  version: number;
  supervisor_home: string;
  runtime_home: string;
  default_mcp_exposure: McpExposure;
  worker_mode: "caller_directory";
  max_workers: number;
  idle_cleanup_minutes: number;
}

export interface EffectiveCodexLeadUserConfig extends CodexLeadUserConfig {
  config_path: string;
}

const CONFIG_VERSION = 1;

export function codexLeadHome(): string {
  return path.resolve(process.env.CODEX_LEAD_CC_HOME ?? path.join(os.homedir(), ".codex_lead_cc"));
}

export function userConfigPath(): string {
  return path.join(codexLeadHome(), "config.json");
}

export function defaultUserConfig(): CodexLeadUserConfig {
  const homeOverride = process.env.CODEX_LEAD_CC_HOME;
  return {
    version: CONFIG_VERSION,
    supervisor_home: homeOverride ? path.join(homeOverride, "supervisor") : "~/.codex_lead_cc/supervisor",
    runtime_home: homeOverride ? path.join(homeOverride, "runtime") : "~/.codex_lead_cc/runtime",
    default_mcp_exposure: "compact",
    worker_mode: "caller_directory",
    max_workers: 8,
    idle_cleanup_minutes: 30,
  };
}

export async function loadOrCreateUserConfig(): Promise<EffectiveCodexLeadUserConfig> {
  await mkdir(codexLeadHome(), { recursive: true });
  const configPath = userConfigPath();
  const raw = await readFile(configPath, "utf8").catch(() => undefined);

  if (!raw) {
    const defaults = defaultUserConfig();
    await writeUserConfig(defaults);
    return materializeConfig(defaults);
  }

  try {
    return materializeConfig(mergeUserConfig(JSON.parse(raw) as Partial<CodexLeadUserConfig>));
  } catch {
    return materializeConfig(defaultUserConfig());
  }
}

export async function resetUserConfig(): Promise<EffectiveCodexLeadUserConfig> {
  const defaults = defaultUserConfig();
  await mkdir(codexLeadHome(), { recursive: true });
  await writeUserConfig(defaults);
  return materializeConfig(defaults);
}

export async function ensureUserConfigDirectories(config: EffectiveCodexLeadUserConfig): Promise<void> {
  await Promise.all([
    mkdir(config.supervisor_home, { recursive: true }),
    mkdir(config.runtime_home, { recursive: true }),
  ]);
}

function mergeUserConfig(raw: Partial<CodexLeadUserConfig>): CodexLeadUserConfig {
  const defaults = defaultUserConfig();
  return {
    version: CONFIG_VERSION,
    supervisor_home: normalizePathSetting(raw.supervisor_home, defaults.supervisor_home),
    runtime_home: normalizePathSetting(raw.runtime_home, defaults.runtime_home),
    default_mcp_exposure: normalizeMcpExposure(raw.default_mcp_exposure ?? defaults.default_mcp_exposure),
    worker_mode: raw.worker_mode === "caller_directory" ? raw.worker_mode : defaults.worker_mode,
    max_workers: positiveInteger(raw.max_workers, defaults.max_workers),
    idle_cleanup_minutes: positiveInteger(raw.idle_cleanup_minutes, defaults.idle_cleanup_minutes),
  };
}

function materializeConfig(config: CodexLeadUserConfig): EffectiveCodexLeadUserConfig {
  return {
    ...config,
    supervisor_home: expandHome(config.supervisor_home),
    runtime_home: expandHome(config.runtime_home),
    config_path: userConfigPath(),
  };
}

async function writeUserConfig(config: CodexLeadUserConfig): Promise<void> {
  await writeFile(userConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function normalizePathSetting(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}
