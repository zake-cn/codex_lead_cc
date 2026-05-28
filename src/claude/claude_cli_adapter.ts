import type {
  ClaudeCodeAdapter,
  RunningClaudeCli,
  StartTaskInput,
  StartTaskResult,
  StopTaskResult,
  TaskRuntimeStatus,
} from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";
import { startClaudeCli } from "./claude_cli_runner.js";

export class ClaudeCliAdapter implements ClaudeCodeAdapter {
  readonly runtime = "claude_cli" as const;
  private readonly running = new Map<string, RunningClaudeCli>();

  constructor(private readonly store: StateStore) {}

  async startTask(input: StartTaskInput): Promise<StartTaskResult> {
    const running = startClaudeCliTask(this.store, input);
    this.running.set(input.task.id, running);
    running.finished.finally(() => this.running.delete(input.task.id)).catch(() => undefined);
    return {
      task_id: input.task.id,
      runtime: this.runtime,
      pid: running.pid,
    };
  }

  async stopTask(taskId: string): Promise<StopTaskResult> {
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

  async getStatus(taskId: string): Promise<TaskRuntimeStatus> {
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

  async cleanup(): Promise<void> {
    for (const [taskId, running] of this.running) {
      running.stop("Adapter cleanup requested.");
      this.running.delete(taskId);
    }
  }
}

export function startClaudeCliTask(store: StateStore, input: StartTaskInput): RunningClaudeCli {
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
