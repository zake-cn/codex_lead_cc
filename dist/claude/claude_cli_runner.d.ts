import type { ClaudeCliRunOptions, ClaudeCliRunResult, RunningClaudeCli } from "../types.js";
export declare function runClaudeCli(options: ClaudeCliRunOptions): Promise<ClaudeCliRunResult>;
export declare function startClaudeCli(options: ClaudeCliRunOptions & {
    logPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
}): RunningClaudeCli;
