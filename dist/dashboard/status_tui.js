import { createRuntime } from "../orchestrator/runtime.js";
export async function renderStatusDashboard(projectId) {
    const runtime = createRuntime();
    const state = await runtime.store.readState();
    const plans = Object.values(state.plans)
        .filter((plan) => !projectId || plan.project_id === projectId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const activePlan = plans.find((plan) => plan.status === "active") ?? plans[0];
    const workers = Object.values(state.workers)
        .filter((worker) => !projectId || worker.project_id === projectId)
        .sort((a, b) => a.id.localeCompare(b.id));
    const tasks = Object.values(state.tasks)
        .filter((task) => !projectId || task.project_id === projectId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const permissions = Object.values(state.permission_requests)
        .filter((permission) => permission.status === "pending")
        .filter((permission) => !projectId || permission.project_id === projectId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const events = state.events
        .filter((event) => !projectId || event.project_id === projectId)
        .slice(-8)
        .reverse();
    const supervisorState = activePlan
        ? state.supervisor_states[`${activePlan.project_id}::${activePlan.plan_id}`] ??
            state.supervisor_states[`${activePlan.project_id}::*`]
        : projectId
            ? state.supervisor_states[`${projectId}::*`]
            : undefined;
    const inbox = Object.values(state.notifications)
        .filter((notification) => !projectId || notification.project_id === projectId)
        .filter((notification) => !notification.read)
        .sort((a, b) => b.event_id - a.event_id)
        .slice(0, 8);
    const wakeEvents = inbox
        .filter((notification) => notification.requires_action)
        .slice(0, 5);
    const lines = [
        `Project: ${projectId ?? activePlan?.project_id ?? "all"}`,
        `Plan: ${activePlan ? `${activePlan.plan_id} v${activePlan.version} - ${activePlan.goal}` : "none"}`,
        `Supervisor: ${supervisorState ? `${supervisorState.state}${supervisorState.reason ? ` - ${supervisorState.reason}` : ""}` : "active"}`,
        "",
        "Inbox:",
        ...renderRows(inbox.map((notification) => [
            `[${notification.priority}]`,
            notification.type,
            notification.task_id ?? "-",
            notification.summary,
        ]), "  none"),
        "",
        "Recent Wake Events:",
        ...renderRows(wakeEvents.map((notification) => [
            String(notification.event_id),
            notification.type,
            notification.summary,
        ]), "  none"),
        "",
        "Workers:",
        ...renderRows(workers.map((worker) => [
            worker.id,
            worker.role,
            worker.status,
            worker.current_task_id ?? "-",
            worker.runtime ?? "claude_cli",
            worker.last_active_at ?? worker.updated_at,
        ]), "  none"),
        "",
        "Tasks:",
        ...renderRows(tasks.map((task) => [
            task.id,
            task.role,
            task.status,
            task.depends_on?.length ? `deps:${task.depends_on.join(",")}` : "-",
            task.patch_path && task.role === "implementer" ? `patch:${task.patch_path}` : "-",
        ]), "  none"),
        "",
        "Permissions:",
        ...renderRows(permissions.map((permission) => [
            permission.id,
            permission.worker_id,
            permission.task_id,
            permission.risk_level,
            permission.action,
        ]), "  none"),
        "",
        "Recent Events:",
        ...renderRows(events.map((event) => [
            String(event.event_id),
            event.type,
            event.summary,
        ]), "  none"),
    ];
    return `${lines.join("\n")}\n`;
}
export async function watchStatusDashboard(projectId, intervalMs = 2000) {
    for (;;) {
        process.stdout.write("\x1b[2J\x1b[H");
        process.stdout.write(await renderStatusDashboard(projectId));
        await delay(intervalMs);
    }
}
function renderRows(rows, emptyText) {
    if (rows.length === 0) {
        return [emptyText];
    }
    return rows.map((row) => `  ${row.join("  ")}`);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=status_tui.js.map