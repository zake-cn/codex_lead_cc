export function syncLinkedPlanTask(state, task) {
    if (!task.plan_id || !task.plan_task_id) {
        return;
    }
    const planTask = state.plans[task.plan_id]?.tasks.find((candidate) => candidate.plan_task_id === task.plan_task_id);
    if (!planTask) {
        return;
    }
    planTask.status = task.status;
    planTask.task_id = task.id;
    planTask.worker_id = task.worker_id;
}
//# sourceMappingURL=plan_state.js.map