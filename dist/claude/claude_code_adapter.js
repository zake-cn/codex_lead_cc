import { ClaudeCliAdapter } from "./claude_cli_adapter.js";
import { ClaudeSdkAdapter } from "./claude_sdk_adapter.js";
export function createClaudeCodeAdapter(runtime, store) {
    if (runtime === "claude_sdk") {
        return new ClaudeSdkAdapter(store, new ClaudeCliAdapter(store));
    }
    return new ClaudeCliAdapter(store);
}
//# sourceMappingURL=claude_code_adapter.js.map