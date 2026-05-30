import { loadConfig } from "../config/load_config.js";
export class ClaudeSdkAdapter {
    store;
    fallback;
    runtime = "claude_sdk";
    constructor(store, fallback) {
        this.store = store;
        this.fallback = fallback;
    }
    async startTask(input) {
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
        throw new Error("Claude Code SDK adapter scaffold is present, but no local Claude Code SDK implementation is configured. Set fallback_to_cli or use claude_cli.");
    }
    async stopTask(taskId) {
        return this.fallback.stopTask(taskId);
    }
    async getStatus(taskId) {
        const fallbackStatus = await this.fallback.getStatus(taskId);
        const state = await this.store.readState();
        return {
            ...fallbackStatus,
            runtime: state.tasks[taskId]?.runtime ?? fallbackStatus.runtime,
        };
    }
    async cleanup(workerId) {
        await this.fallback.cleanup?.(workerId);
    }
}
//# sourceMappingURL=claude_sdk_adapter.js.map