export interface SessionFile {
    version: 2;
    session_id: string;
    project_path: string;
    supervisor_home: string;
    session_dir: string;
    artifact_root: string;
    bridge_dir: string;
    bridge_state_file: string;
    claude_env_file: string;
    bridge_pid?: number;
    cc_pid?: number;
    created_at: string;
}
export declare const BRIDGE_STATUSES: readonly ["idle", "running", "needs_permission", "timeout", "interrupted", "exited"];
export type BridgeStatus = (typeof BRIDGE_STATUSES)[number];
export declare const BRIDGE_RESULT_STATUSES: readonly ["completed", "needs_permission", "timeout", "interrupted", "exited", "busy"];
export type BridgeResultStatus = (typeof BRIDGE_RESULT_STATUSES)[number];
export declare const BRIDGE_INPUT_KEYS: readonly ["1", "2", "3", "enter", "escape", "ctrl-c"];
export type BridgeInputKey = (typeof BRIDGE_INPUT_KEYS)[number];
export interface BridgeStatusPayload {
    status: BridgeStatus;
    bridge_pid: number;
    cc_pid?: number;
    session_id: string;
    project_label: string;
    last_output: string;
    bottom_lines: string[];
    spinner_detected: boolean;
    permission_prompt_detected: boolean;
    suggested_keys: string[];
}
export interface BridgeCommandResult {
    status: BridgeResultStatus;
    suggested_keys?: string[];
    error?: string;
}
