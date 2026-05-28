export const WORKER_ROLES = ["scout", "implementer", "tester", "reviewer"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export const WORKER_RUNTIMES = ["claude_cli", "claude_sdk"] as const;
export type WorkerRuntime = (typeof WORKER_RUNTIMES)[number];

export const WORKER_STATUSES = ["idle", "pending", "running", "busy", "stopped", "crashed"] as const;
export type WorkerStatus = (typeof WORKER_STATUSES)[number];

export const WORKER_HEALTH_STATUSES = ["healthy", "idle", "busy", "idle_timeout", "stopped", "crashed"] as const;
export type WorkerHealthStatus = (typeof WORKER_HEALTH_STATUSES)[number];

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
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const FINAL_TASK_STATUSES = ["completed", "failed", "timeout", "stopped"] as const;
export type FinalTaskStatus = (typeof FINAL_TASK_STATUSES)[number];

export const SUPERVISOR_STATES = [
  "active",
  "planning",
  "dispatching",
  "waiting",
  "sleeping",
  "reviewing",
  "blocked",
  "completed",
] as const;
export type SupervisorStateValue = (typeof SUPERVISOR_STATES)[number];

export const WAKE_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type WakePriority = (typeof WAKE_PRIORITIES)[number];

export const REPORT_LEVELS = ["summary", "full", "raw"] as const;
export type ReportLevel = (typeof REPORT_LEVELS)[number];

export interface CcRunTaskInput {
  project_path: string;
  task: string;
  timeout_sec?: number;
}

export interface CcRunTaskReport {
  status: TaskStatus;
  task: string;
  project_path: string;
  summary: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string;
}

export interface ClaudeCliRunOptions {
  projectPath: string;
  task: string;
  timeoutSec: number;
}

export interface ClaudeCliRunResult {
  status: FinalTaskStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  pid: number | undefined;
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  error?: string;
}

export interface RunningClaudeCli {
  pid: number | undefined;
  finished: Promise<ClaudeCliRunResult>;
  stop: (reason?: string) => void;
}

export interface WorkerRecord {
  id: string;
  role: WorkerRole;
  status: WorkerStatus;
  runtime?: WorkerRuntime;
  session_id?: string;
  project_id: string;
  project_path: string;
  worktree_mode?: "readonly" | "isolated" | "direct";
  worktree_path?: string;
  current_task_id?: string;
  last_active_at?: string;
  idle_timeout_sec?: number;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  worker_id: string;
  role: WorkerRole;
  project_id: string;
  project_path: string;
  execution_path: string;
  target_task_id?: string;
  task: string;
  status: TaskStatus;
  depends_on?: string[];
  blocked_by?: string[];
  plan_id?: string;
  plan_version?: number;
  plan_task_id?: string;
  runtime?: WorkerRuntime;
  timeout_sec: number;
  runner_pid?: number;
  claude_pid?: number;
  exit_code: number | null;
  error?: string;
  stop_reason?: string;
  summary?: string;
  log_path: string;
  report_path: string;
  stdout_path: string;
  stderr_path: string;
  worktree_path?: string;
  worktree_mode?: "readonly" | "isolated" | "direct";
  base_branch?: string;
  patch_path?: string;
  diff_summary_path?: string;
  files_modified?: string[];
  report_type?: ReportType;
  permission_request_id?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  updated_at: string;
  duration_ms?: number;
}

export interface AgentForemanState {
  version: number;
  counters: {
    worker: number;
    task: number;
    event: number;
    notification: number;
    permission: number;
    rule: number;
    artifact: number;
    plan: number;
    plan_change: number;
    session: number;
  };
  workers: Record<string, WorkerRecord>;
  tasks: Record<string, TaskRecord>;
  events: EventRecord[];
  supervisor_states: Record<string, SupervisorStateRecord>;
  notifications: Record<string, SupervisorNotificationRecord>;
  permission_requests: Record<string, PermissionRequestRecord>;
  permission_rules: Record<string, PermissionRuleRecord>;
  artifacts: Record<string, ArtifactRecord>;
  plans: Record<string, PlanRecord>;
  plan_changes: Record<string, PlanChangeRecord>;
  sessions: Record<string, WorkerSessionRecord>;
}

export interface CreateWorkerInput {
  project_path: string;
  role: WorkerRole;
  project_id?: string;
  worktree_mode?: "readonly" | "isolated" | "direct";
  runtime?: WorkerRuntime;
  idle_timeout_sec?: number;
}

export interface AssignTaskInput {
  worker_id: string;
  task: string;
  timeout_sec?: number;
  target_task_id?: string;
  depends_on?: string[];
  plan_id?: string;
  plan_task_id?: string;
}

export interface StopTaskInput {
  task_id: string;
  reason?: string;
}

export interface StopWorkerInput {
  worker_id: string;
  reason?: string;
}

export interface DeleteWorkerInput {
  worker_id: string;
}

export interface GetStatusInput {
  task_id?: string;
  worker_id?: string;
  all?: boolean;
}

export interface GetReportInput {
  task_id?: string;
  report_id?: string;
  level?: ReportLevel;
}

export interface TaskReport {
  report_type: ReportType;
  task_id: string;
  worker_id: string;
  role: WorkerRole;
  status: TaskStatus;
  task: string;
  summary: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  log_path: string;
  report_path: string;
  worktree_path?: string;
  patch_path?: string;
  files_modified?: string[];
  diff_summary?: DiffSummary;
  commands_run?: CommandRunSummary[];
  test_result?: "passed" | "failed" | "unknown";
  failures?: string[];
  review_target?: string;
  decision?: "approve" | "request_changes" | "reject" | "unknown";
  findings?: ReviewFinding[];
}

export type ReportType = "scout" | "implementation" | "test" | "review" | "task";

export interface AgentForemanConfig {
  max_concurrent_workers: number;
  permission_rules: Array<Omit<PermissionRuleRecord, "id" | "created_at">>;
  runtime: {
    default_adapter: WorkerRuntime;
    enable_sdk_adapter: boolean;
    fallback_to_cli: boolean;
  };
  worker_idle_timeout_sec: number;
}

export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionStatus = "pending" | "approved" | "rejected";
export type PermissionDecision =
  | "allow_once"
  | "allow_for_task"
  | "allow_for_project"
  | "deny";
export type RiskLevel = "read" | "safe_write" | "test" | "environment" | "danger";

export interface PermissionRequestRecord {
  id: string;
  project_id: string;
  task_id: string;
  worker_id: string;
  tool: string;
  action: string;
  risk_level: RiskLevel;
  reason: string;
  affected_paths: string[];
  status: PermissionStatus;
  suggested_decision: PermissionDecision;
  choices: PermissionDecision[];
  created_at: string;
  resolved_at?: string;
  decision?: PermissionDecision;
  resolution_reason?: string;
}

export interface PermissionRuleRecord {
  id: string;
  project_id: string;
  effect: PermissionEffect;
  tool: string;
  pattern: string;
  scope: "task" | "project" | "global";
  task_id?: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
}

export interface EventRecord {
  event_id: number;
  time: string;
  type: EventType;
  project_id?: string;
  task_id?: string;
  worker_id?: string;
  summary: string;
  payload: Record<string, unknown>;
}

export type EventType =
  | "worker_created"
  | "worker_deleted"
  | "worker_stopped"
  | "worker_restarted"
  | "worker_stalled"
  | "worker_crashed"
  | "worker_health_checked"
  | "idle_workers_cleaned"
  | "task_created"
  | "task_queued"
  | "task_ready"
  | "task_blocked"
  | "task_skipped"
  | "dag_unblocked"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_timeout"
  | "task_stopped"
  | "permission_requested"
  | "permission_approved"
  | "permission_rejected"
  | "partial_report_ready"
  | "report_created"
  | "patch_created"
  | "patch_generated"
  | "test_completed"
  | "review_completed"
  | "all_tasks_completed"
  | "worktree_created"
  | "worktree_cleanup"
  | "worktree_fallback"
  | "plan_created"
  | "plan_updated"
  | "plan_completed"
  | "plan_task_linked"
  | "session_created"
  | "session_cleaned"
  | "metrics_collected"
  | "metrics_updated"
  | "worker_stdout_chunk"
  | "heartbeat"
  | "file_read"
  | "stage_changed"
  | "minor_progress"
  | "log_updated";

export type WakeEventType =
  | EventType
  | "permission_requested"
  | "patch_generated"
  | "test_completed"
  | "review_completed"
  | "dag_unblocked";

export interface SupervisorStateRecord {
  key: string;
  project_id: string;
  plan_id?: string;
  state: SupervisorStateValue;
  reason?: string;
  updated_at: string;
}

export interface SupervisorNotificationRecord {
  notification_id: string;
  project_id?: string;
  plan_id?: string;
  event_id: number;
  type: WakeEventType;
  priority: WakePriority;
  requires_action: boolean;
  read: boolean;
  task_id?: string;
  worker_id?: string;
  role?: WorkerRole;
  summary: string;
  report_id?: string;
  patch_id?: string;
  permission_request_id?: string;
  recommended_next_actions: string[];
  created_at: string;
  read_at?: string;
}

export interface SetSupervisorStateInput {
  project_id: string;
  plan_id?: string;
  state: SupervisorStateValue;
  reason?: string;
}

export interface GetSupervisorStateInput {
  project_id: string;
  plan_id?: string;
}

export interface GetInboxInput {
  project_id?: string;
  plan_id?: string;
  only_unread?: boolean;
  min_priority?: WakePriority;
  max_notifications?: number;
}

export interface MarkNotificationsReadInput {
  notification_ids: string[];
}

export interface WaitForEventsInput {
  project_id?: string;
  plan_id?: string;
  since_event_id?: number;
  wake_on?: WakeEventType[];
  timeout_sec?: number;
  max_events?: number;
}

export interface CompactWakeContext {
  active_tasks: number;
  completed_tasks: number;
  pending_permissions: number;
  failed_tasks: number;
  unread_reports: number;
}

export interface WakePacket {
  woke: boolean;
  wake_reason: WakeEventType | "timeout";
  priority: WakePriority;
  project_id?: string;
  plan_id?: string;
  latest_event_id: number;
  notifications: SupervisorNotificationRecord[];
  suggested_decision?: {
    type: string;
    reason: string;
  };
  compact_context: CompactWakeContext;
  message?: string;
}

export interface ArtifactRecord {
  id: string;
  project_id: string;
  task_id: string;
  type: "report" | "patch" | "diff_summary" | "log" | "worktree";
  path: string;
  created_at: string;
}

export interface GetUpdatesInput {
  since_event_id?: number;
  project_id?: string;
}

export interface GetPendingPermissionsInput {
  project_id?: string;
}

export interface ApprovePermissionInput {
  request_id: string;
  decision: Exclude<PermissionDecision, "deny">;
}

export interface RejectPermissionInput {
  request_id: string;
  reason?: string;
}

export interface GetDiffSummaryInput {
  task_id: string;
}

export interface GetDiffDetailInput {
  task_id: string;
  file: string;
}

export interface ListWorkersInput {
  project_id?: string;
  status?: WorkerStatus;
}

export interface ListTasksInput {
  project_id?: string;
  status?: TaskStatus;
  worker_id?: string;
}

export interface CleanupWorktreeInput {
  task_id?: string;
  worker_id?: string;
}

export type PlanStatus = "active" | "completed" | "archived";
export type PlanTaskStatus = TaskStatus | "planned";

export interface PlanTaskSpec {
  role: WorkerRole;
  goal: string;
  depends_on?: string[];
  worker_id?: string;
  task_id?: string;
}

export interface PlanTaskNode extends PlanTaskSpec {
  plan_task_id: string;
  status: PlanTaskStatus;
}

export interface PlanSnapshot {
  version: number;
  status: PlanStatus;
  goal: string;
  tasks: PlanTaskNode[];
  reason?: string;
  created_at: string;
}

export interface PlanRecord {
  plan_id: string;
  project_id: string;
  version: number;
  goal: string;
  status: PlanStatus;
  tasks: PlanTaskNode[];
  history: PlanSnapshot[];
  created_at: string;
  updated_at: string;
}

export interface PlanChangeRecord {
  change_id: string;
  plan_id: string;
  project_id: string;
  from_version: number;
  to_version: number;
  reason: string;
  added_tasks: string[];
  removed_tasks: string[];
  updated_tasks: string[];
  created_at: string;
}

export interface CreatePlanInput {
  project_id: string;
  goal: string;
  tasks?: PlanTaskSpec[];
}

export interface GetPlanInput {
  plan_id: string;
  version?: number;
}

export interface UpdatePlanTaskInput {
  plan_task_id: string;
  goal?: string;
  status?: PlanTaskStatus;
  depends_on?: string[];
  worker_id?: string;
  task_id?: string;
}

export interface UpdatePlanInput {
  plan_id: string;
  reason: string;
  add_tasks?: PlanTaskSpec[];
  update_tasks?: UpdatePlanTaskInput[];
  remove_tasks?: string[];
  status?: PlanStatus;
  goal?: string;
}

export interface ListPlansInput {
  project_id?: string;
  status?: PlanStatus;
}

export interface WorkerSessionRecord {
  session_id: string;
  worker_id: string;
  runtime: WorkerRuntime;
  project_id: string;
  role: WorkerRole;
  status: "idle" | "busy" | "stopped" | "crashed";
  created_at: string;
  last_active_at: string;
  idle_timeout_sec: number;
  metadata: Record<string, unknown>;
}

export interface RestartWorkerInput {
  worker_id: string;
  reason?: string;
}

export interface GetWorkerHealthInput {
  worker_id?: string;
  project_id?: string;
}

export interface CleanupIdleWorkersInput {
  project_id?: string;
  idle_timeout_sec?: number;
  dry_run?: boolean;
}

export interface WorkerHealthReport {
  worker_id: string;
  status: WorkerStatus;
  health_status: WorkerHealthStatus;
  runtime: WorkerRuntime;
  session_id: string | null;
  current_task_id: string | null;
  last_active_at: string | null;
  idle_for_ms: number | null;
  idle_timeout_sec: number;
}

export interface MetricsInput {
  project_id?: string;
  plan_id?: string;
}

export interface MetricsReport {
  project_id?: string;
  plan_id?: string;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  tasks_running: number;
  success_rate: number;
  total_runtime_ms: number;
  raw_log_bytes: number;
  structured_report_bytes: number;
  compression_ratio: number;
  workers_total: number;
  worker_runtime: Record<WorkerRuntime, number>;
  permission_requests: number;
  patches_generated: number;
  estimated_supervisor_context_saved: "low" | "medium" | "high";
}

export interface StartTaskInput {
  task: TaskRecord;
  prompt: string;
  execution_path: string;
}

export interface StartTaskResult {
  task_id: string;
  runtime: WorkerRuntime;
  pid?: number;
}

export interface StopTaskResult {
  task_id: string;
  stopped: boolean;
  message: string;
}

export interface TaskRuntimeStatus {
  task_id: string;
  runtime: WorkerRuntime;
  status: TaskStatus;
  pid?: number;
}

export interface WorkerRuntimeEvent {
  task_id: string;
  type: string;
  time: string;
  payload: Record<string, unknown>;
}

export interface ClaudeCodeAdapter {
  readonly runtime: WorkerRuntime;
  startTask(input: StartTaskInput): Promise<StartTaskResult>;
  stopTask(taskId: string): Promise<StopTaskResult>;
  getStatus(taskId: string): Promise<TaskRuntimeStatus>;
  streamEvents?(taskId: string): AsyncIterable<WorkerRuntimeEvent>;
  cleanup?(workerId: string): Promise<void>;
}

export interface DiffSummary {
  task_id: string;
  files_changed: number;
  insertions: number;
  deletions: number;
  files: DiffFileSummary[];
  patch_path?: string;
}

export interface DiffFileSummary {
  path: string;
  change_summary: string;
  risk: "low" | "medium" | "high";
  insertions: number;
  deletions: number;
}

export interface CommandRunSummary {
  command: string;
  exit_code: number | null;
  summary: string;
}

export interface ReviewFinding {
  severity: "low" | "medium" | "high";
  category: string;
  description: string;
  suggested_fix?: string;
}
