import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  defaultClaudeRuntimeConfig,
  normalizeClaudeRuntimeConfig,
  type ClaudeRuntimeConfig,
} from "../claude/claude_runtime_env.js";

export interface CodexLeadUserConfig {
  version: number;
  supervisor_home: string;
  runtime_home: string;
  claude_runtime: ClaudeRuntimeConfig;
}

export interface EffectiveCodexLeadUserConfig extends CodexLeadUserConfig {
  config_path: string;
}

const CONFIG_VERSION = 3;

export function codexLeadHome(): string {
  return path.resolve(
    process.env.CODEX_LEAD_CC_HOME ?? path.join(os.homedir(), ".codex_lead_cc"),
  );
}

export function userConfigPath(): string {
  return path.join(codexLeadHome(), "config.json");
}

// Default runtime_home is now INSIDE supervisor_home so subagents can write.
function defaultRuntimeHome(supervisorHome: string): string {
  return path.join(supervisorHome, ".codex_lead_cc_runtime");
}

export function defaultUserConfig(): CodexLeadUserConfig {
  const homeOverride = process.env.CODEX_LEAD_CC_HOME;
  const supervisor = homeOverride
    ? path.join(homeOverride, "supervisor")
    : path.join(os.homedir(), ".codex_lead_cc", "supervisor");
  return {
    version: CONFIG_VERSION,
    supervisor_home: supervisor,
    runtime_home: defaultRuntimeHome(supervisor),
    claude_runtime: defaultClaudeRuntimeConfig(),
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
    const parsed = JSON.parse(raw) as Partial<CodexLeadUserConfig>;
    const merged = mergeUserConfig(parsed);
    if (needsMigration(parsed)) {
      await writeUserConfig(merged);
    }
    return materializeConfig(merged);
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

export async function ensureUserConfigDirectories(
  config: EffectiveCodexLeadUserConfig,
): Promise<void> {
  // supervisor_home must be created first (runtime_home is inside it)
  await mkdir(config.supervisor_home, { recursive: true });
  await mkdir(config.runtime_home, { recursive: true });
}

// ── internal ──

function mergeUserConfig(raw: Partial<CodexLeadUserConfig>): CodexLeadUserConfig {
  const defaults = defaultUserConfig();
  const expandedSupervisor = expandHome(
    normalizePathSetting(raw.supervisor_home, defaults.supervisor_home),
  );

  // If old config (version < 3), migrate runtime_home inside supervisor_home
  const oldDefaultRuntime = path.join(
    path.dirname(expandedSupervisor),  // ~/.codex_lead_cc
    "runtime",
  );
  const rawRuntime = normalizePathSetting(raw.runtime_home, "");
  const isOldDefault = rawRuntime === "~/.codex_lead_cc/runtime"
    || path.resolve(expandHome(rawRuntime || "")) === oldDefaultRuntime
    || (raw.version ?? 0) < 3
    || !rawRuntime;

  return {
    version: CONFIG_VERSION,
    supervisor_home: normalizePathSetting(raw.supervisor_home, defaults.supervisor_home),
    runtime_home: isOldDefault
      ? defaultRuntimeHome(expandedSupervisor)
      : normalizePathSetting(raw.runtime_home, defaultRuntimeHome(expandedSupervisor)),
    claude_runtime: normalizeClaudeRuntimeConfig(raw.claude_runtime),
  };
}

function needsMigration(raw: Partial<CodexLeadUserConfig>): boolean {
  return raw.version !== CONFIG_VERSION || !raw.claude_runtime;
}

function materializeConfig(
  config: CodexLeadUserConfig,
): EffectiveCodexLeadUserConfig {
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

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

// ── Path safety ──

export function isPathInside(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  return resolvedChild === resolvedParent
    || resolvedChild.startsWith(resolvedParent + path.sep);
}

export function assertPathInside(child: string, parent: string, label: string): void {
  if (!isPathInside(child, parent)) {
    throw new Error(
      `${label} must be inside supervisor_home.\n` +
      `  ${label}: ${child}\n` +
      `  supervisor_home: ${parent}`,
    );
  }
}

export function runtimeHomeWarning(config: EffectiveCodexLeadUserConfig): string | undefined {
  if (!isPathInside(config.runtime_home, config.supervisor_home)) {
    return (
      `runtime_home is outside supervisor_home and may not be writable from Codex subagents.\n` +
      `  runtime_home: ${config.runtime_home}\n` +
      `  supervisor_home: ${config.supervisor_home}\n` +
      `  Consider resetting config: codex_lead_cc config reset`
    );
  }
  return undefined;
}
