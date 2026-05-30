export const WORKER_ROLES = ["scout", "implementer", "tester", "reviewer"];
export const WORKER_RUNTIMES = ["claude_cli", "claude_sdk"];
export const WORKER_STATUSES = ["idle", "pending", "running", "busy", "stopped", "crashed"];
export const WORKER_HEALTH_STATUSES = ["healthy", "idle", "busy", "idle_timeout", "stopped", "crashed"];
export const TASK_STATUSES = [
    "pending",
    "blocked",
    "ready",
    "waiting_permission",
    "running",
    "completed",
    "failed",
    "timeout",
    "stopped",
    "skipped",
];
export const FINAL_TASK_STATUSES = ["completed", "failed", "timeout", "stopped"];
export const SUPERVISOR_STATES = [
    "active",
    "planning",
    "dispatching",
    "waiting",
    "sleeping",
    "reviewing",
    "blocked",
    "completed",
];
export const WAKE_PRIORITIES = ["low", "medium", "high", "critical"];
export const REPORT_LEVELS = ["summary", "full", "raw"];
//# sourceMappingURL=types.js.map