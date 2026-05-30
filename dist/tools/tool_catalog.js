import { ccApprovePermission } from "./cc_approve_permission.js";
import { ccAssignTask } from "./cc_assign_task.js";
import { ccAdmin } from "./cc_admin.js";
import { ccCleanupIdleWorkers } from "./cc_cleanup_idle_workers.js";
import { ccCleanupWorktree } from "./cc_cleanup_worktree.js";
import { ccCreatePlan } from "./cc_create_plan.js";
import { ccCreateWorker } from "./cc_create_worker.js";
import { ccDecide } from "./cc_decide.js";
import { ccDeleteWorker } from "./cc_delete_worker.js";
import { ccDispatch } from "./cc_dispatch.js";
import { ccGetDiffDetail } from "./cc_get_diff_detail.js";
import { ccGetDiffSummary } from "./cc_get_diff_summary.js";
import { ccGetMetrics } from "./cc_get_metrics.js";
import { ccGetPendingPermissions } from "./cc_get_pending_permissions.js";
import { ccGetPlan } from "./cc_get_plan.js";
import { ccGetReport } from "./cc_get_report.js";
import { ccGetStatus } from "./cc_get_status.js";
import { ccGetSupervisorState } from "./cc_get_supervisor_state.js";
import { ccGetInbox } from "./cc_get_inbox.js";
import { ccGetUpdates } from "./cc_get_updates.js";
import { ccGetWorkerHealth } from "./cc_get_worker_health.js";
import { ccInspect } from "./cc_inspect.js";
import { ccListPlans } from "./cc_list_plans.js";
import { ccListTasks } from "./cc_list_tasks.js";
import { ccListWorkers } from "./cc_list_workers.js";
import { ccMarkNotificationsRead } from "./cc_mark_notifications_read.js";
import { ccRejectPermission } from "./cc_reject_permission.js";
import { ccRestartWorker } from "./cc_restart_worker.js";
import { ccRunTask } from "./cc_run_task.js";
import { ccSetSupervisorState } from "./cc_set_supervisor_state.js";
import { ccStopTask } from "./cc_stop_task.js";
import { ccStopWorker } from "./cc_stop_worker.js";
import { ccUpdatePlan } from "./cc_update_plan.js";
import { ccWait } from "./cc_wait.js";
import { ccWaitForEvents } from "./cc_wait_for_events.js";
export const TOOL_CATALOG = {
    cc_dispatch: {
        flags: {
            "--action": "action",
            "--project-id": "project_id",
            "--project-path": "project_path",
            "--plan-id": "plan_id",
            "--plan-task-id": "plan_task_id",
            "--goal": "goal",
            "--task": "task",
            "--worker-id": "worker_id",
            "--worker-role": "worker_role",
            "--role": "role",
            "--timeout-sec": "timeout_sec",
            "--depends-on": "depends_on",
            "--target-task-id": "target_task_id",
        },
        handler: (input) => ccDispatch(input),
    },
    cc_wait: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--since-event-id": "since_event_id",
            "--wake-on": "wake_on",
            "--timeout-sec": "timeout_sec",
            "--max-events": "max_events",
            "--state": "state",
            "--reason": "reason",
        },
        handler: (input) => ccWait(input),
    },
    cc_inspect: {
        flags: {
            "--action": "action",
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--task-id": "task_id",
            "--worker-id": "worker_id",
            "--report-id": "report_id",
            "--level": "level",
            "--file": "file",
            "--only-unread": "only_unread",
            "--min-priority": "min_priority",
            "--since-event-id": "since_event_id",
            "--status": "status",
            "--all": "all",
        },
        handler: (input) => ccInspect(input),
    },
    cc_decide: {
        flags: {
            "--action": "action",
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--task-id": "task_id",
            "--worker-id": "worker_id",
            "--request-id": "request_id",
            "--decision": "decision",
            "--reason": "reason",
            "--state": "state",
            "--notification-ids": "notification_ids",
        },
        handler: (input) => ccDecide(input),
    },
    cc_admin: {
        flags: {
            "--action": "action",
        },
        handler: (input) => ccAdmin(input),
    },
    cc_run_task: {
        flags: {
            "--project-path": "project_path",
            "--task": "task",
            "--timeout-sec": "timeout_sec",
        },
        handler: (input) => ccRunTask(input),
    },
    cc_create_worker: {
        flags: {
            "--project-path": "project_path",
            "--project-id": "project_id",
            "--role": "role",
            "--worktree-mode": "worktree_mode",
            "--runtime": "runtime",
            "--idle-timeout-sec": "idle_timeout_sec",
        },
        handler: (input) => ccCreateWorker(input),
    },
    cc_assign_task: {
        flags: {
            "--worker-id": "worker_id",
            "--task": "task",
            "--timeout-sec": "timeout_sec",
            "--target-task-id": "target_task_id",
            "--depends-on": "depends_on",
            "--plan-id": "plan_id",
            "--plan-task-id": "plan_task_id",
        },
        handler: (input) => ccAssignTask(input),
    },
    cc_get_status: {
        flags: {
            "--task-id": "task_id",
            "--worker-id": "worker_id",
            "--all": "all",
        },
        handler: (input) => ccGetStatus(input),
    },
    cc_get_report: {
        flags: {
            "--task-id": "task_id",
            "--report-id": "report_id",
            "--level": "level",
        },
        handler: (input) => ccGetReport(input),
    },
    cc_set_supervisor_state: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--state": "state",
            "--reason": "reason",
        },
        handler: (input) => ccSetSupervisorState(input),
    },
    cc_get_supervisor_state: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
        },
        handler: (input) => ccGetSupervisorState(input),
    },
    cc_wait_for_events: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--since-event-id": "since_event_id",
            "--wake-on": "wake_on",
            "--timeout-sec": "timeout_sec",
            "--max-events": "max_events",
        },
        handler: (input) => ccWaitForEvents(input),
    },
    cc_get_inbox: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
            "--only-unread": "only_unread",
            "--min-priority": "min_priority",
            "--max-notifications": "max_notifications",
        },
        handler: (input) => ccGetInbox(input),
    },
    cc_mark_notifications_read: {
        flags: {
            "--notification-ids": "notification_ids",
        },
        handler: (input) => ccMarkNotificationsRead(input),
    },
    cc_stop_task: {
        flags: {
            "--task-id": "task_id",
            "--reason": "reason",
        },
        handler: (input) => ccStopTask(input),
    },
    cc_stop_worker: {
        flags: {
            "--worker-id": "worker_id",
            "--reason": "reason",
        },
        handler: (input) => ccStopWorker(input),
    },
    cc_delete_worker: {
        flags: { "--worker-id": "worker_id" },
        handler: (input) => ccDeleteWorker(input),
    },
    cc_get_updates: {
        flags: {
            "--since-event-id": "since_event_id",
            "--project-id": "project_id",
        },
        handler: (input) => ccGetUpdates(input),
    },
    cc_get_pending_permissions: {
        flags: { "--project-id": "project_id" },
        handler: (input) => ccGetPendingPermissions(input),
    },
    cc_approve_permission: {
        flags: {
            "--request-id": "request_id",
            "--decision": "decision",
        },
        handler: (input) => ccApprovePermission(input),
    },
    cc_reject_permission: {
        flags: {
            "--request-id": "request_id",
            "--reason": "reason",
        },
        handler: (input) => ccRejectPermission(input),
    },
    cc_get_diff_summary: {
        flags: { "--task-id": "task_id" },
        handler: (input) => ccGetDiffSummary(input),
    },
    cc_get_diff_detail: {
        flags: {
            "--task-id": "task_id",
            "--file": "file",
        },
        handler: (input) => ccGetDiffDetail(input),
    },
    cc_list_workers: {
        flags: {
            "--project-id": "project_id",
            "--status": "status",
        },
        handler: (input) => ccListWorkers(input),
    },
    cc_list_tasks: {
        flags: {
            "--project-id": "project_id",
            "--status": "status",
            "--worker-id": "worker_id",
        },
        handler: (input) => ccListTasks(input),
    },
    cc_cleanup_worktree: {
        flags: {
            "--task-id": "task_id",
            "--worker-id": "worker_id",
        },
        handler: (input) => ccCleanupWorktree(input),
    },
    cc_create_plan: {
        flags: {
            "--project-id": "project_id",
            "--goal": "goal",
        },
        handler: (input) => ccCreatePlan(input),
    },
    cc_get_plan: {
        flags: {
            "--plan-id": "plan_id",
            "--version": "version",
        },
        handler: (input) => ccGetPlan(input),
    },
    cc_update_plan: {
        flags: {
            "--plan-id": "plan_id",
            "--reason": "reason",
            "--status": "status",
            "--goal": "goal",
        },
        handler: (input) => ccUpdatePlan(input),
    },
    cc_list_plans: {
        flags: {
            "--project-id": "project_id",
            "--status": "status",
        },
        handler: (input) => ccListPlans(input),
    },
    cc_get_metrics: {
        flags: {
            "--project-id": "project_id",
            "--plan-id": "plan_id",
        },
        handler: (input) => ccGetMetrics(input),
    },
    cc_restart_worker: {
        flags: {
            "--worker-id": "worker_id",
            "--reason": "reason",
        },
        handler: (input) => ccRestartWorker(input),
    },
    cc_get_worker_health: {
        flags: {
            "--worker-id": "worker_id",
            "--project-id": "project_id",
        },
        handler: (input) => ccGetWorkerHealth(input),
    },
    cc_cleanup_idle_workers: {
        flags: {
            "--project-id": "project_id",
            "--idle-timeout-sec": "idle_timeout_sec",
            "--dry-run": "dry_run",
        },
        handler: (input) => ccCleanupIdleWorkers(input),
    },
};
//# sourceMappingURL=tool_catalog.js.map