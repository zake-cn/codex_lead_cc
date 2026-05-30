import type { AgentForemanState } from "../types.js";
export declare class StateStore {
    readonly rootDir: string;
    readonly statePath: string;
    readonly logsDir: string;
    readonly reportsDir: string;
    readonly patchesDir: string;
    readonly worktreesDir: string;
    readonly metricsDir: string;
    readonly tmpDir: string;
    readonly lockPath: string;
    constructor(rootDir?: string);
    init(): Promise<void>;
    readState(): Promise<AgentForemanState>;
    updateState<T>(mutator: (state: AgentForemanState) => T): Promise<T>;
    taskPaths(taskId: string): {
        logPath: string;
        stdoutPath: string;
        stderrPath: string;
        reportPath: string;
        patchPath: string;
        diffSummaryPath: string;
        displayLogPath: string;
        displayStdoutPath: string;
        displayStderrPath: string;
        displayReportPath: string;
        displayPatchPath: string;
        displayDiffSummaryPath: string;
    };
    metricsPath(scope: string): {
        metricsPath: string;
        displayMetricsPath: string;
    };
    worktreePath(taskId: string, suffix?: string): string;
    displayPath(filePath: string): string;
    private readStateFile;
    private writeState;
    private withLock;
    private removeStaleLock;
}
export declare function defaultState(): AgentForemanState;
export declare function nowIso(): string;
export declare function nextId(prefix: "proj" | "sup_session" | "ccw" | "task" | "perm" | "rule" | "art" | "plan" | "change" | "session" | "note", counter: number): string;
export declare function appendEvent(state: AgentForemanState, event: Omit<AgentForemanState["events"][number], "event_id" | "time">): AgentForemanState["events"][number];
