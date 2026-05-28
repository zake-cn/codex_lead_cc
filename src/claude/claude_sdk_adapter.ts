import { loadConfig } from "../config/load_config.js";
import type {
  ClaudeCodeAdapter,
  StartTaskInput,
  StartTaskResult,
  StopTaskResult,
  TaskRuntimeStatus,
} from "../types.js";
import { StateStore } from "../orchestrator/state_store.js";

export class ClaudeSdkAdapter implements ClaudeCodeAdapter {
  readonly runtime = "claude_sdk" as const;

  constructor(
    private readonly store: StateStore,
    private readonly fallback: ClaudeCodeAdapter,
  ) {}

  async startTask(input: StartTaskInput): Promise<StartTaskResult> {
    const config = await loadConfig(input.task.project_path);
    if (!config.runtime.enable_sdk_adapter) {
      if (config.runtime.fallback_to_cli) {
        const result = await this.fallback.startTask(input);
        return {
          ...result,
          runtime: "claude_cli",
        };
      }
      throw new Error("Claude Code SDK adapter is disabled. Enable runtime.enable_sdk_adapter or use claude_cli.");
    }

    throw new Error(
      "Claude Code SDK adapter scaffold is present, but no local Claude Code SDK implementation is configured. Set fallback_to_cli or use claude_cli.",
    );
  }

  async stopTask(taskId: string): Promise<StopTaskResult> {
    return this.fallback.stopTask(taskId);
  }

  async getStatus(taskId: string): Promise<TaskRuntimeStatus> {
    const fallbackStatus = await this.fallback.getStatus(taskId);
    const state = await this.store.readState();
    return {
      ...fallbackStatus,
      runtime: state.tasks[taskId]?.runtime ?? fallbackStatus.runtime,
    };
  }

  async cleanup(workerId: string): Promise<void> {
    await this.fallback.cleanup?.(workerId);
  }
}
