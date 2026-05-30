import type { CcRunTaskReport, ClaudeCliRunResult, DiffSummary, TaskRecord, TaskReport } from "../types.js";
export declare function buildReport(args: {
    task: string;
    projectPath: string;
    result: ClaudeCliRunResult;
}): CcRunTaskReport;
export declare function buildTaskReport(args: {
    task: TaskRecord;
    result?: ClaudeCliRunResult;
    stdout: string;
    stderr: string;
    status?: TaskRecord["status"];
    summary?: string;
    diffSummary?: DiffSummary;
}): TaskReport;
export declare function summarizeTaskReport(status: TaskRecord["status"], stdout: string, stderr: string): string;
