import { type McpExposure } from "../mcp/exposure.js";
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
export declare function codexLeadHome(): string;
export declare function userConfigPath(): string;
export declare function defaultUserConfig(): CodexLeadUserConfig;
export declare function loadOrCreateUserConfig(): Promise<EffectiveCodexLeadUserConfig>;
export declare function resetUserConfig(): Promise<EffectiveCodexLeadUserConfig>;
export declare function ensureUserConfigDirectories(config: EffectiveCodexLeadUserConfig): Promise<void>;
