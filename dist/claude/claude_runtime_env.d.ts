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
export declare const CODEX_LEAD_CC_ENV_FILE = "CODEX_LEAD_CC_ENV_FILE";
export declare const DEFAULT_CLAUDE_ENV_PASSTHROUGH: readonly ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "OPENAI_API_KEY", "OPENAI_BASE_URL", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
export declare function defaultClaudeRuntimeConfig(): ClaudeRuntimeConfig;
export declare function normalizeClaudeRuntimeConfig(raw: unknown): ClaudeRuntimeConfig;
export declare function prepareClaudeRuntimeEnvFile(args: {
    runtimeHome: string;
    sessionId: string;
    config: ClaudeRuntimeConfig;
    baseEnv?: NodeJS.ProcessEnv;
}): PreparedClaudeRuntimeEnv;
export declare function loadClaudeRuntimeEnvFileIntoProcess(envFile?: string | undefined): {
    loaded: boolean;
    env_file?: string;
    env_names: string[];
    warnings: string[];
};
export declare function buildClaudeWorkerEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function getClaudeRuntimeCommand(baseEnv?: NodeJS.ProcessEnv): {
    command: string;
    argsPrefix: string[];
};
export declare function redactEnvMap(env: Record<string, string>): Record<string, string>;
export declare function redactConfigForDisplay<T>(value: T): T;
export declare function isSensitiveName(name: string): boolean;
