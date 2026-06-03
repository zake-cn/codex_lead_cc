import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ── Types ──

export interface ClaudeRuntimeEnvProviderConfig {
  enabled: boolean;
  command: string;
  args: string[];
  strict?: boolean;
  timeout_ms?: number;
}

export interface ClaudeRuntimeConfig {
  command: string;
  args_prefix: string[];
  env_passthrough: string[];
  env_provider: ClaudeRuntimeEnvProviderConfig;
}

export interface PreparedClaudeRuntimeEnv {
  env_file: string;
  env_names: string[];
  redacted_env: Record<string, string>;
  provider_enabled: boolean;
  warnings: string[];
}

export interface LoadedClaudeRuntimeEnv {
  loaded: boolean;
  env_file?: string;
  env: Record<string, string>;
  env_names: string[];
  warnings: string[];
}

// ── Constants ──

export const CODEX_LEAD_CC_ENV_FILE = "CODEX_LEAD_CC_ENV_FILE";
const CLAUDE_COMMAND_ENV = "CODEX_LEAD_CC_CLAUDE_COMMAND";
const CLAUDE_ARGS_PREFIX_ENV = "CODEX_LEAD_CC_CLAUDE_ARGS_PREFIX_JSON";

export const DEFAULT_CLAUDE_ENV_PASSTHROUGH = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

export const CRITICAL_ENV_VARS = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
] as const;

// ── Defaults ──

export function defaultClaudeRuntimeConfig(): ClaudeRuntimeConfig {
  return {
    command: "claude",
    args_prefix: [],
    env_passthrough: [...DEFAULT_CLAUDE_ENV_PASSTHROUGH],
    env_provider: {
      enabled: false,
      command: "bash",
      args: ["-lc", "env"],
    },
  };
}

export function normalizeClaudeRuntimeConfig(raw: unknown): ClaudeRuntimeConfig {
  const defaults = defaultClaudeRuntimeConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const input = raw as Partial<ClaudeRuntimeConfig>;
  return {
    command: typeof input.command === "string" && input.command.trim()
      ? input.command.trim() : defaults.command,
    args_prefix: stringArray(input.args_prefix, defaults.args_prefix),
    env_passthrough: uniqueStrings(input.env_passthrough, defaults.env_passthrough),
    env_provider: normalizeEnvProvider(input.env_provider, defaults.env_provider),
  };
}

// ── Env file generation (used by wrapper) ──

export function prepareClaudeRuntimeEnvFile(args: {
  runtimeHome: string;
  sessionId: string;
  config: ClaudeRuntimeConfig;
  baseEnv?: NodeJS.ProcessEnv;
}): PreparedClaudeRuntimeEnv {
  const baseEnv = args.baseEnv ?? process.env;
  const warnings: string[] = [];
  const providerEnv = readProviderEnv(args.config, baseEnv, warnings);
  const mergedEnv: Record<string, string | undefined> = { ...baseEnv, ...providerEnv };
  const allowlist = new Set(args.config.env_passthrough);
  const filtered: Record<string, string> = {};

  for (const key of allowlist) {
    const value = mergedEnv[key];
    if (typeof value === "string") filtered[key] = value;
  }

  filtered[CLAUDE_COMMAND_ENV] = args.config.command;
  filtered[CLAUDE_ARGS_PREFIX_ENV] = JSON.stringify(args.config.args_prefix);

  const sessionDir = path.join(args.runtimeHome, "sessions", args.sessionId);
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const envFile = path.join(sessionDir, "claude_env.json");
  writeFileSync(envFile, `${JSON.stringify(filtered, null, 2)}\n`, {
    encoding: "utf8", mode: 0o600,
  });
  chmodSync(envFile, 0o600);

  return {
    env_file: envFile,
    env_names: Object.keys(filtered).filter((key) => !isInternalRuntimeKey(key)).sort(),
    redacted_env: redactEnvMap(filtered),
    provider_enabled: args.config.env_provider.enabled,
    warnings,
  };
}

// ── Env loading (PURE — does not mutate process.env) ──

export function loadClaudeRuntimeEnvFile(envFile: string): LoadedClaudeRuntimeEnv {
  const warnings: string[] = [];
  if (!envFile) {
    warnings.push("No env file path provided.");
    return { loaded: false, env_file: envFile, env: {}, env_names: [], warnings };
  }
  if (!existsSync(envFile)) {
    warnings.push(`Claude runtime env file does not exist: ${envFile}`);
    return { loaded: false, env_file: envFile, env: {}, env_names: [], warnings };
  }
  try {
    const parsed = JSON.parse(readFileSync(envFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`Claude runtime env file is not a JSON object: ${envFile}`);
      return { loaded: false, env_file: envFile, env: {}, env_names: [], warnings };
    }
    const env: Record<string, string> = {};
    const names: string[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (isValidEnvName(key) && typeof value === "string") {
        env[key] = value;
        if (!isInternalRuntimeKey(key)) names.push(key);
      }
    }
    return { loaded: true, env_file: envFile, env, env_names: names.sort(), warnings };
  } catch (error) {
    warnings.push(`Failed to load Claude runtime env file: ${messageFrom(error)}`);
    return { loaded: false, env_file: envFile, env: {}, env_names: [], warnings };
  }
}

// ── Env loading (LEGACY — mutates process.env, delegated to pure function) ──

export function loadClaudeRuntimeEnvFileIntoProcess(
  envFile = process.env[CODEX_LEAD_CC_ENV_FILE],
): { loaded: boolean; env_file?: string; env_names: string[]; warnings: string[] } {
  const loaded = loadClaudeRuntimeEnvFile(envFile ?? "");
  if (loaded.loaded) {
    for (const [key, value] of Object.entries(loaded.env)) {
      process.env[key] = value;
    }
  }
  return {
    loaded: loaded.loaded,
    env_file: loaded.env_file,
    env_names: loaded.env_names,
    warnings: loaded.warnings,
  };
}

// ── Build final Claude env ──

export function buildFinalClaudeEnv(args: {
  baseEnv: NodeJS.ProcessEnv;
  loadedEnv: Record<string, string>;
}): NodeJS.ProcessEnv {
  return { ...args.baseEnv, ...args.loadedEnv };
}

// ── Claude PTY env (strips internal runtime keys) ──

export function buildClaudePtyEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  delete env[CLAUDE_COMMAND_ENV];
  delete env[CLAUDE_ARGS_PREFIX_ENV];
  return env;
}

// ── Get Claude runtime command from env ──

export function getClaudeRuntimeCommand(baseEnv: NodeJS.ProcessEnv = process.env): {
  command: string;
  argsPrefix: string[];
} {
  return {
    command: baseEnv[CLAUDE_COMMAND_ENV] || "claude",
    argsPrefix: parseArgsPrefix(baseEnv[CLAUDE_ARGS_PREFIX_ENV]),
  };
}

// ── Redaction ──

export function redactEnvMap(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const key of Object.keys(env).sort()) {
    if (isInternalRuntimeKey(key)) continue;
    redacted[key] = "***";
  }
  return redacted;
}

export function redactConfigForDisplay<T>(value: T): T {
  return redactUnknown(value) as T;
}

export function isSensitiveName(name: string): boolean {
  return /TOKEN|KEY|SECRET|PASSWORD|AUTH/i.test(name);
}

// ── Critical env check ──

export function criticalEnvPresent(env: Record<string, string>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of CRITICAL_ENV_VARS) {
    result[key] = typeof env[key] === "string" && env[key].length > 0;
  }
  return result;
}

// ── Internal helpers ──

function normalizeEnvProvider(
  raw: unknown,
  defaults: ClaudeRuntimeEnvProviderConfig,
): ClaudeRuntimeEnvProviderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const input = raw as Partial<ClaudeRuntimeEnvProviderConfig>;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    command: typeof input.command === "string" && input.command.trim() ? input.command.trim() : defaults.command,
    args: stringArray(input.args, defaults.args),
    strict: typeof input.strict === "boolean" ? input.strict : undefined,
    timeout_ms: Number.isInteger(input.timeout_ms) && Number(input.timeout_ms) > 0 ? Number(input.timeout_ms) : undefined,
  };
}

function readProviderEnv(
  config: ClaudeRuntimeConfig,
  baseEnv: NodeJS.ProcessEnv,
  warnings: string[],
): Record<string, string> {
  const provider = config.env_provider;
  if (!provider.enabled) return {};
  const result = spawnSync(provider.command, provider.args, {
    encoding: "utf8", env: baseEnv, timeout: provider.timeout_ms ?? 5_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
    const message = `Claude runtime env provider failed: ${detail}`;
    if (provider.strict) throw new Error(message);
    warnings.push(message);
    return {};
  }
  return parseEnvOutput(result.stdout);
}

function parseEnvOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (!isValidEnvName(key)) continue;
    parsed[key] = line.slice(index + 1);
  }
  return parsed;
}

function parseArgsPrefix(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function uniqueStrings(value: unknown, fallback: string[]): string[] {
  const values = stringArray(value, fallback);
  return [...new Set(values)];
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values.map((item) => item.trim()) : [...fallback];
}

function redactUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (!value || typeof value !== "object") return typeof value === "string" ? redactSecretString(value) : value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveName(key)) { output[key] = "***"; continue; }
    output[key] = redactUnknown(child);
  }
  return output;
}

function redactSecretString(value: string): string {
  return value.replace(/([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|AUTH)[A-Z0-9_]*=)([^\s;"']+)/gi, "$1***");
}

function isValidEnvName(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function isInternalRuntimeKey(key: string): boolean {
  return key === CLAUDE_COMMAND_ENV || key === CLAUDE_ARGS_PREFIX_ENV;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
