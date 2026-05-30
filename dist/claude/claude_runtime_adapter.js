import { loadConfig } from "../config/load_config.js";
import { startClaudeCliTask } from "./claude_cli_adapter.js";
import { runClaudeCli } from "./claude_cli_runner.js";
export async function startClaudeTask(store, input) {
    const requestedRuntime = input.task.runtime ?? "claude_cli";
    if (requestedRuntime === "claude_sdk") {
        const config = await loadConfig(input.task.project_path);
        if (!config.runtime.enable_sdk_adapter && !config.runtime.fallback_to_cli) {
            throw new Error("Task requested claude_sdk, but runtime.enable_sdk_adapter is false and fallback_to_cli is false.");
        }
        if (config.runtime.enable_sdk_adapter && !config.runtime.fallback_to_cli) {
            throw new Error("Claude Code SDK runtime is not configured yet. Use claude_cli or enable fallback_to_cli.");
        }
    }
    return {
        runtime: "claude_cli",
        running: startClaudeCliTask(store, input),
    };
}
export async function runClaudeTaskOnce(input) {
    return runClaudeCli(input);
}
//# sourceMappingURL=claude_runtime_adapter.js.map