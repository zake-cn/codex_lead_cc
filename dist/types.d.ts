export declare const FINAL_TASK_STATUSES: readonly ["completed", "failed", "timeout", "stopped"];
export type FinalTaskStatus = (typeof FINAL_TASK_STATUSES)[number];
export interface ClaudeCliRunOptions {
    projectPath: string;
    task: string;
    timeoutSec: number;
}
export interface ClaudeCliRunResult {
    status: FinalTaskStatus;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    pid: number | undefined;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    error?: string;
}
export interface RunningClaudeCli {
    pid: number | undefined;
    finished: Promise<ClaudeCliRunResult>;
    stop: (reason?: string) => void;
}
export interface SessionFile {
    version: 1;
    session_id: string;
    project_path: string;
    supervisor_home: string;
    task_dir: string;
    artifact_root: string;
    claude_env_file: string;
    created_at: string;
}
export declare const WORKER_TYPES: readonly ["readonly", "write"];
export type WorkerType = (typeof WORKER_TYPES)[number];
export interface ParsedTaskFile {
    task_id: string;
    worker_type: WorkerType;
    goal: string;
    allowed_scope: string;
    forbidden_actions: string;
    acceptance_criteria: string;
    verification: string;
    report_requirements: string;
}
export interface DelegateResult {
    task_id: string;
    worker_type: WorkerType;
    status: FinalTaskStatus;
    exit_code: number | null;
    duration_ms: number;
    artifact_dir: string;
    changed_files: string[];
    summary: string;
    error?: string;
}
