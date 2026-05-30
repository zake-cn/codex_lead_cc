export const REPORT_TYPES = ["scout", "implementation", "test", "review", "task"];
export const FINAL_TASK_STATUS_SET = new Set([
    "completed",
    "failed",
    "timeout",
    "stopped",
    "skipped",
]);
export function reportTypeForRole(role) {
    if (role === "implementer") {
        return "implementation";
    }
    if (role === "tester") {
        return "test";
    }
    if (role === "reviewer") {
        return "review";
    }
    if (role === "scout") {
        return "scout";
    }
    return "task";
}
//# sourceMappingURL=report_schema.js.map