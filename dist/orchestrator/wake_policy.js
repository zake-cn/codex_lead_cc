const NO_WAKE_EVENTS = new Set([
    "worker_stdout_chunk",
    "heartbeat",
    "file_read",
    "stage_changed",
    "minor_progress",
    "log_updated",
    "worker_created",
    "worker_deleted",
    "worker_stopped",
    "worker_health_checked",
    "idle_workers_cleaned",
    "task_created",
    "task_queued",
    "task_started",
    "permission_approved",
    "permission_rejected",
    "report_created",
    "worktree_created",
    "worktree_cleanup",
    "worktree_fallback",
    "plan_created",
    "plan_task_linked",
    "session_created",
    "session_cleaned",
]);
export function buildNotificationFromEvent(state, event) {
    const type = wakeTypeForEvent(state, event);
    if (!type || NO_WAKE_EVENTS.has(event.type)) {
        return undefined;
    }
    const task = event.task_id ? state.tasks[event.task_id] : undefined;
    const worker = event.worker_id ? state.workers[event.worker_id] : undefined;
    const role = task?.role ?? worker?.role;
    const permissionRequestId = permissionRequestIdForEvent(event);
    const patchId = patchIdForEvent(state, event);
    const reportId = reportIdForEvent(event);
    const priority = priorityForWake(type, role);
    return {
        project_id: event.project_id ?? task?.project_id ?? worker?.project_id,
        plan_id: task?.plan_id ?? planIdFromPayload(event),
        event_id: event.event_id,
        type,
        priority,
        requires_action: requiresAction(type),
        task_id: event.task_id,
        worker_id: event.worker_id,
        role,
        summary: summaryForWake(type, event.summary, role),
        report_id: reportId,
        patch_id: patchId,
        permission_request_id: permissionRequestId,
        recommended_next_actions: recommendedNextActions(type, role),
    };
}
export function defaultWakeTypes() {
    return [
        "permission_requested",
        "task_completed",
        "task_failed",
        "task_timeout",
        "worker_stalled",
        "worker_crashed",
        "review_completed",
        "patch_generated",
        "test_completed",
        "task_skipped",
        "dag_unblocked",
        "plan_completed",
    ];
}
export function comparePriority(a, b) {
    return priorityRank(b) - priorityRank(a);
}
export function highestPriority(notifications) {
    return notifications.reduce((highest, notification) => priorityRank(notification.priority) > priorityRank(highest) ? notification.priority : highest, "low");
}
export function priorityRank(priority) {
    if (priority === "critical") {
        return 4;
    }
    if (priority === "high") {
        return 3;
    }
    if (priority === "medium") {
        return 2;
    }
    return 1;
}
function wakeTypeForEvent(state, event) {
    if (NO_WAKE_EVENTS.has(event.type)) {
        return undefined;
    }
    if (event.type === "patch_created") {
        return "patch_generated";
    }
    if (event.type === "task_ready") {
        return "dag_unblocked";
    }
    if (event.type === "task_completed") {
        const role = event.task_id ? state.tasks[event.task_id]?.role : undefined;
        if (role === "tester") {
            return "test_completed";
        }
        if (role === "reviewer") {
            return "review_completed";
        }
        return "task_completed";
    }
    if (event.type === "plan_updated" && event.payload.status === "completed") {
        return "plan_completed";
    }
    if (event.type === "metrics_collected") {
        return "metrics_updated";
    }
    return event.type;
}
function priorityForWake(type, role) {
    if (type === "permission_requested" || type === "worker_crashed") {
        return "critical";
    }
    if (type === "task_failed" || type === "task_timeout" || type === "worker_stalled") {
        return "high";
    }
    if (type === "patch_generated" || type === "review_completed") {
        return "high";
    }
    if (type === "task_completed" && role === "implementer") {
        return "high";
    }
    if (type === "test_completed" || type === "plan_completed" || type === "all_tasks_completed") {
        return "high";
    }
    if (type === "task_completed" || type === "task_skipped" || type === "dag_unblocked") {
        return "medium";
    }
    return "low";
}
function requiresAction(type) {
    return [
        "permission_requested",
        "task_completed",
        "task_failed",
        "task_timeout",
        "worker_stalled",
        "worker_crashed",
        "review_completed",
        "patch_generated",
        "test_completed",
        "task_skipped",
        "dag_unblocked",
        "plan_completed",
    ].includes(type);
}
function recommendedNextActions(type, role) {
    if (type === "permission_requested") {
        return ["Inspect pending permission", "Approve or reject permission", "Continue scheduling after approval"];
    }
    if (type === "patch_generated") {
        return ["Read diff summary", "Create tester worker", "Read implementation summary report only if needed"];
    }
    if (type === "test_completed") {
        return ["Read summary test report", "Create reviewer if tests passed", "Request implementer changes if tests failed"];
    }
    if (type === "review_completed") {
        return ["Read review summary", "Accept patch or request changes", "Collect metrics"];
    }
    if (type === "task_failed" || type === "task_timeout") {
        return ["Read summary report", "Inspect raw log only if needed", "Stop, restart, replace worker, or ask user"];
    }
    if (type === "worker_stalled" || type === "worker_crashed") {
        return ["Check worker health", "Restart or replace worker", "Inspect affected task status"];
    }
    if (type === "dag_unblocked") {
        return ["Check ready tasks", "Assign or wait for scheduler", "Continue dispatching if worker slots are available"];
    }
    if (type === "task_completed" && role === "scout") {
        return ["Read summary report", "Update plan", "Create implementer task if implementation is needed"];
    }
    if (type === "task_completed" && role === "implementer") {
        return ["Read diff summary", "Create tester worker", "Read implementation summary report only if needed"];
    }
    if (type === "plan_completed") {
        return ["Read final metrics", "Summarize outcome for user"];
    }
    return ["Read summary report", "Decide next supervisor action"];
}
function summaryForWake(type, eventSummary, role) {
    if (type === "patch_generated") {
        return eventSummary.replace(/^Created patch/, "Patch generated");
    }
    if (type === "test_completed") {
        return "Tester completed: read the test summary report before deciding the next step.";
    }
    if (type === "review_completed") {
        return "Reviewer completed: read review findings and decision.";
    }
    if (type === "task_completed" && role === "implementer") {
        return "Implementer completed and may have produced patch artifacts.";
    }
    return eventSummary;
}
function permissionRequestIdForEvent(event) {
    if (event.type !== "permission_requested") {
        return undefined;
    }
    const id = event.payload.id ?? event.payload.request_id;
    return typeof id === "string" ? id : undefined;
}
function patchIdForEvent(state, event) {
    if (event.type !== "patch_created" || !event.task_id) {
        return undefined;
    }
    return Object.values(state.artifacts)
        .filter((artifact) => artifact.task_id === event.task_id && artifact.type === "patch")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id;
}
function reportIdForEvent(event) {
    if (!event.task_id) {
        return undefined;
    }
    const explicit = event.payload.report_id;
    if (typeof explicit === "string") {
        return explicit;
    }
    return `report_${event.task_id}`;
}
function planIdFromPayload(event) {
    const planId = event.payload.plan_id;
    return typeof planId === "string" ? planId : undefined;
}
//# sourceMappingURL=wake_policy.js.map