import type { ApprovePermissionInput, AssignTaskInput, CcRunTaskInput, CcRunTaskReport, CleanupIdleWorkersInput, CleanupWorktreeInput, CreatePlanInput, CreateWorkerInput, DeleteWorkerInput, GetDiffDetailInput, GetDiffSummaryInput, GetPendingPermissionsInput, GetPlanInput, GetReportInput, GetInboxInput, GetStatusInput, GetSupervisorStateInput, GetUpdatesInput, GetWorkerHealthInput, ListPlansInput, ListTasksInput, ListWorkersInput, MarkNotificationsReadInput, MetricsInput, RejectPermissionInput, RestartWorkerInput, SetSupervisorStateInput, StopTaskInput, StopWorkerInput, UpdatePlanInput, WaitForEventsInput } from "../types.js";
import { type OrchestratorRuntime } from "../orchestrator/runtime.js";
export declare class CodexLeadService {
    readonly runtime: OrchestratorRuntime;
    constructor(runtime?: OrchestratorRuntime);
    runTask(input: CcRunTaskInput): Promise<CcRunTaskReport>;
    createWorker(input: CreateWorkerInput): Promise<import("../types.js").WorkerRecord>;
    assignTask(input: AssignTaskInput): Promise<{
        task_id: string;
        worker_id: string;
        status: import("../types.js").TaskStatus;
    }>;
    getStatus(input: GetStatusInput): Promise<Record<string, unknown>>;
    getReport(input: GetReportInput): Promise<import("../types.js").TaskReport>;
    setSupervisorState(input: SetSupervisorStateInput): Promise<{
        ok: true;
        state: import("../types.js").SupervisorStateValue;
        updated_at: string;
    }>;
    getSupervisorState(input: GetSupervisorStateInput): Promise<import("../types.js").SupervisorStateRecord>;
    waitForEvents(input: WaitForEventsInput): Promise<import("../types.js").WakePacket>;
    getInbox(input: GetInboxInput): Promise<{
        notifications: import("../types.js").SupervisorNotificationRecord[];
    }>;
    markNotificationsRead(input: MarkNotificationsReadInput): Promise<{
        marked_read: string[];
    }>;
    stopTask(input: StopTaskInput): Promise<{
        task_id: string;
        status: import("../types.js").TaskStatus;
        message: string;
    }>;
    stopWorker(input: StopWorkerInput): Promise<Record<string, unknown>>;
    deleteWorker(input: DeleteWorkerInput): Promise<{
        worker_id: string;
        deleted: true;
    }>;
    getUpdates(input: GetUpdatesInput): Promise<{
        events: import("../types.js").EventRecord[];
    }>;
    getPendingPermissions(input: GetPendingPermissionsInput): Promise<{
        pending_permissions: import("../types.js").PermissionRequestRecord[];
    }>;
    approvePermission(input: ApprovePermissionInput): Promise<{
        request_id: string;
        status: "approved";
        decision: import("../types.js").PermissionDecision;
        task_id: string;
    }>;
    rejectPermission(input: RejectPermissionInput): Promise<{
        request_id: string;
        status: "rejected";
        reason: string;
        task_id: string;
    }>;
    getDiffSummary(input: GetDiffSummaryInput): Promise<import("../types.js").DiffSummary>;
    getDiffDetail(input: GetDiffDetailInput): Promise<{
        task_id: string;
        file: string;
        diff: string;
    }>;
    listWorkers(input: ListWorkersInput): Promise<{
        workers: import("../types.js").WorkerRecord[];
    }>;
    listTasks(input: ListTasksInput): Promise<{
        tasks: import("../types.js").TaskRecord[];
    }>;
    cleanupWorktree(input: CleanupWorktreeInput): Promise<{
        cleaned: string[];
    }>;
    createPlan(input: CreatePlanInput): Promise<{
        plan_id: string;
        version: number;
        status: import("../types.js").PlanRecord["status"];
    }>;
    getPlan(input: GetPlanInput): Promise<Record<string, unknown>>;
    updatePlan(input: UpdatePlanInput): Promise<{
        plan_id: string;
        version: number;
        status: import("../types.js").PlanRecord["status"];
        change_id: string;
    }>;
    listPlans(input: ListPlansInput): Promise<{
        plans: import("../types.js").PlanRecord[];
    }>;
    getMetrics(input: MetricsInput): Promise<import("../types.js").MetricsReport & {
        metrics_path: string;
    }>;
    restartWorker(input: RestartWorkerInput): Promise<{
        worker_id: string;
        status: import("../types.js").WorkerRecord["status"];
        session_id: string;
        message: string;
    }>;
    getWorkerHealth(input: GetWorkerHealthInput): Promise<{
        workers: import("../types.js").WorkerHealthReport[];
    }>;
    cleanupIdleWorkers(input: CleanupIdleWorkersInput): Promise<{
        dry_run: boolean;
        cleaned_worker_ids: string[];
    }>;
    dispatch(input: Record<string, unknown>): Promise<import("./gateway_result.js").GatewayResult>;
    wait(input: Record<string, unknown>): Promise<import("./gateway_result.js").GatewayResult>;
    inspect(input: Record<string, unknown>): Promise<import("./gateway_result.js").GatewayResult>;
    decide(input: Record<string, unknown>): Promise<import("./gateway_result.js").GatewayResult>;
    admin(input: Record<string, unknown>): Promise<import("./gateway_result.js").GatewayResult>;
    projectDefaults(input?: Record<string, unknown>): Promise<{
        project_id?: string;
        project_path?: string;
    }>;
    private applyProjectDefaults;
    private applyProjectIdDefault;
    private applyOptionalProjectIdDefault;
}
export declare function createCodexLeadService(stateDir?: string): CodexLeadService;
