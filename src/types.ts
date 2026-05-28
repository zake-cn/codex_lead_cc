export type WorkerRole = "scout" | "implementer" | "tester" | "reviewer";

export type WorkerStatus = "idle" | "pending" | "running" | "stopped";

export type TaskStatus =
  | "pending"
  | "waiting_permission"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "stopped";

export type FinalTaskStatus = "completed" | "failed" | "timeout" | "stopped";

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
  project_id: string;
  project_path: string;
  worktree_mode?: "readonly" | "isolated" | "direct";
  worktree_path?: string;
  current_task_id?: string;
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
  version: 2;
  counters: {
    worker: number;
    task: number;
    event: number;
    permission: number;
    rule: number;
    artifact: number;
  };
  workers: Record<string, WorkerRecord>;
  tasks: Record<string, TaskRecord>;
  events: EventRecord[];
  permission_requests: Record<string, PermissionRequestRecord>;
  permission_rules: Record<string, PermissionRuleRecord>;
  artifacts: Record<string, ArtifactRecord>;
}

export interface CreateWorkerInput {
  project_path: string;
  role: WorkerRole;
  project_id?: string;
  worktree_mode?: "readonly" | "isolated" | "direct";
}

export interface AssignTaskInput {
  worker_id: string;
  task: string;
  timeout_sec?: number;
  target_task_id?: string;
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
  task_id: string;
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
  | "task_created"
  | "task_queued"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_timeout"
  | "task_stopped"
  | "permission_requested"
  | "permission_approved"
  | "permission_rejected"
  | "report_created"
  | "patch_created"
  | "worktree_created"
  | "worktree_cleanup"
  | "worktree_fallback";

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
