import { type ClaudeRuntimeConfig } from "../claude/claude_runtime_env.js";
export interface CodexLeadUserConfig {
    version: number;
    supervisor_home: string;
    runtime_home: string;
    claude_runtime: ClaudeRuntimeConfig;
}
export interface EffectiveCodexLeadUserConfig extends CodexLeadUserConfig {
    config_path: string;
}
export declare function codexLeadHome(): string;
export declare function userConfigPath(): string;
export declare function defaultUserConfig(): CodexLeadUserConfig;
export declare function loadOrCreateUserConfig(): Promise<EffectiveCodexLeadUserConfig>;
export declare function resetUserConfig(): Promise<EffectiveCodexLeadUserConfig>;
export declare function ensureUserConfigDirectories(config: EffectiveCodexLeadUserConfig): Promise<void>;
