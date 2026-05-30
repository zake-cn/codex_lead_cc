import { startClaudeCli } from "./claude_cli_runner.js";
export class ClaudeCliAdapter {
    store;
    runtime = "claude_cli";
    running = new Map();
    constructor(store) {
        this.store = store;
    }
    async startTask(input) {
        const running = startClaudeCliTask(this.store, input);
        this.running.set(input.task.id, running);
        running.finished.finally(() => this.running.delete(input.task.id)).catch(() => undefined);
        return {
            task_id: input.task.id,
            runtime: this.runtime,
            pid: running.pid,
        };
    }
    async stopTask(taskId) {
        const running = this.running.get(taskId);
        if (!running) {
            return {
                task_id: taskId,
                stopped: false,
                message: "No active CLI process is tracked in this adapter instance.",
            };
        }
        running.stop("Stopped through ClaudeCliAdapter.");
        return {
            task_id: taskId,
            stopped: true,
            message: "CLI process stop requested.",
        };
    }
    async getStatus(taskId) {
        const state = await this.store.readState();
        const task = state.tasks[taskId];
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        return {
            task_id: taskId,
            runtime: this.runtime,
            status: task.status,
            pid: this.running.get(taskId)?.pid ?? task.claude_pid,
        };
    }
    async cleanup() {
        for (const [taskId, running] of this.running) {
            running.stop("Adapter cleanup requested.");
            this.running.delete(taskId);
        }
    }
}
export function startClaudeCliTask(store, input) {
    const paths = store.taskPaths(input.task.id);
    return startClaudeCli({
        projectPath: input.execution_path,
        task: input.prompt,
        timeoutSec: input.task.timeout_sec,
        logPath: paths.logPath,
        stdoutPath: paths.stdoutPath,
        stderrPath: paths.stderrPath,
    });
}
//# sourceMappingURL=claude_cli_adapter.js.map