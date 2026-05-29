import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runClaudeTaskOnce } from "../claude/claude_runtime_adapter.js";
import { buildReport } from "../report/build_report.js";
import type {
  ApprovePermissionInput,
  AssignTaskInput,
  CcRunTaskInput,
  CcRunTaskReport,
  CleanupIdleWorkersInput,
  CleanupWorktreeInput,
  CreatePlanInput,
  CreateWorkerInput,
  DeleteWorkerInput,
  GetDiffDetailInput,
  GetDiffSummaryInput,
  GetPendingPermissionsInput,
  GetPlanInput,
  GetReportInput,
  GetInboxInput,
  GetStatusInput,
  GetSupervisorStateInput,
  GetUpdatesInput,
  GetWorkerHealthInput,
  ListPlansInput,
  ListTasksInput,
  ListWorkersInput,
  MarkNotificationsReadInput,
  MetricsInput,
  RejectPermissionInput,
  RestartWorkerInput,
  SetSupervisorStateInput,
  StopTaskInput,
  StopWorkerInput,
  UpdatePlanInput,
  WaitForEventsInput,
} from "../types.js";
import { createRuntime, type OrchestratorRuntime } from "../orchestrator/runtime.js";
import { AdminService } from "./admin_service.js";
import { DecisionService } from "./decision_service.js";
import { DispatchService } from "./dispatch_service.js";
import { InspectService } from "./inspect_service.js";
import { WaitService } from "./wait_service.js";

const DEFAULT_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 3_600;

export class CodexLeadService {
  constructor(readonly runtime: OrchestratorRuntime = createRuntime()) {}

  async runTask(input: CcRunTaskInput): Promise<CcRunTaskReport> {
    const normalized = await normalizeRunTaskInput(input);
    const result = await runClaudeTaskOnce({
      projectPath: normalized.projectPath,
      task: normalized.task,
      timeoutSec: normalized.timeoutSec,
    });
    const report = buildReport({
      task: normalized.task,
      projectPath: normalized.projectPath,
      result,
    });
    await writePhase0TaskLog(report);
    return report;
  }

  async createWorker(input: CreateWorkerInput) {
    return this.runtime.workers.createWorker(input);
  }

  async assignTask(input: AssignTaskInput) {
    return this.runtime.tasks.assignTask(input);
  }

  async getStatus(input: GetStatusInput) {
    return this.runtime.tasks.getStatus(input);
  }

  async getReport(input: GetReportInput) {
    return this.runtime.tasks.getReport(input);
  }

  async setSupervisorState(input: SetSupervisorStateInput) {
    return this.runtime.supervisorState.setState(input);
  }

  async getSupervisorState(input: GetSupervisorStateInput) {
    return this.runtime.supervisorState.getState(input);
  }

  async waitForEvents(input: WaitForEventsInput) {
    return this.runtime.wait.waitForEvents(input);
  }

  async getInbox(input: GetInboxInput) {
    return this.runtime.inbox.getInbox(input);
  }

  async markNotificationsRead(input: MarkNotificationsReadInput) {
    return this.runtime.inbox.markRead(input);
  }

  async stopTask(input: StopTaskInput) {
    return this.runtime.tasks.stopTask(input);
  }

  async stopWorker(input: StopWorkerInput) {
    return this.runtime.tasks.stopWorker(input);
  }

  async deleteWorker(input: DeleteWorkerInput) {
    return this.runtime.workers.deleteWorker(input);
  }

  async getUpdates(input: GetUpdatesInput) {
    return this.runtime.events.getUpdates(input);
  }

  async getPendingPermissions(input: GetPendingPermissionsInput) {
    return this.runtime.permissions.getPendingPermissions(input);
  }

  async approvePermission(input: ApprovePermissionInput) {
    const result = await this.runtime.permissions.approve(input);
    await this.runtime.scheduler.schedule();
    return result;
  }

  async rejectPermission(input: RejectPermissionInput) {
    const result = await this.runtime.permissions.reject(input);
    await this.runtime.scheduler.schedule();
    return result;
  }

  async getDiffSummary(input: GetDiffSummaryInput) {
    return this.runtime.diffs.getSummary(input);
  }

  async getDiffDetail(input: GetDiffDetailInput) {
    return this.runtime.diffs.getDetail(input);
  }

  async listWorkers(input: ListWorkersInput) {
    return this.runtime.workers.listWorkers(input);
  }

  async listTasks(input: ListTasksInput) {
    return this.runtime.tasks.listTasks(input);
  }

  async cleanupWorktree(input: CleanupWorktreeInput) {
    return this.runtime.worktrees.cleanup(input);
  }

  async createPlan(input: CreatePlanInput) {
    return this.runtime.plans.createPlan(input);
  }

  async getPlan(input: GetPlanInput) {
    return this.runtime.plans.getPlan(input);
  }

  async updatePlan(input: UpdatePlanInput) {
    return this.runtime.plans.updatePlan(input);
  }

  async listPlans(input: ListPlansInput) {
    return this.runtime.plans.listPlans(input);
  }

  async getMetrics(input: MetricsInput) {
    return this.runtime.metrics.getMetrics(input);
  }

  async restartWorker(input: RestartWorkerInput) {
    return this.runtime.sessions.restartWorker(input);
  }

  async getWorkerHealth(input: GetWorkerHealthInput) {
    return this.runtime.sessions.getWorkerHealth(input);
  }

  async cleanupIdleWorkers(input: CleanupIdleWorkersInput) {
    return this.runtime.sessions.cleanupIdleWorkers(input);
  }

  async dispatch(input: Record<string, unknown>) {
    return new DispatchService(this).dispatch(input);
  }

  async wait(input: Record<string, unknown>) {
    return new WaitService(this).wait(input);
  }

  async inspect(input: Record<string, unknown>) {
    return new InspectService(this).inspect(input);
  }

  async decide(input: Record<string, unknown>) {
    return new DecisionService(this).decide(input);
  }

  async admin(input: Record<string, unknown>) {
    return new AdminService(this).admin(input);
  }
}

export function createCodexLeadService(stateDir?: string): CodexLeadService {
  return new CodexLeadService(createRuntime(stateDir));
}

async function normalizeRunTaskInput(input: CcRunTaskInput): Promise<{
  projectPath: string;
  task: string;
  timeoutSec: number;
}> {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be a JSON object.");
  }
  if (!input.task || typeof input.task !== "string") {
    throw new Error("`task` is required and must be a non-empty string.");
  }
  if (!input.project_path || typeof input.project_path !== "string") {
    throw new Error("`project_path` is required and must be a non-empty string.");
  }

  const projectPath = path.resolve(input.project_path);
  const projectStat = await stat(projectPath).catch(() => undefined);
  if (!projectStat?.isDirectory()) {
    throw new Error(`project_path does not exist or is not a directory: ${projectPath}`);
  }

  const timeoutSec = input.timeout_sec ?? DEFAULT_TIMEOUT_SEC;
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT_SEC) {
    throw new Error(`timeout_sec must be an integer between 1 and ${MAX_TIMEOUT_SEC}.`);
  }

  return {
    projectPath,
    task: input.task,
    timeoutSec,
  };
}

async function writePhase0TaskLog(report: CcRunTaskReport): Promise<void> {
  const logRoot = process.env.CODEX_LEAD_CC_LOG_DIR
    ? path.resolve(process.env.CODEX_LEAD_CC_LOG_DIR)
    : path.resolve(process.cwd(), ".codex_lead_cc", "logs");
  const logPath = path.join(logRoot, "tasks.jsonl");

  try {
    await mkdir(logRoot, { recursive: true });
    await writeFile(logPath, `${JSON.stringify(report)}\n`, { flag: "a" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.stderr = appendLine(report.stderr, `Failed to write task log: ${message}`);
  }
}

function appendLine(existing: string, line: string): string {
  if (!existing.trim()) {
    return line;
  }
  return `${existing.replace(/\s+$/, "")}\n${line}`;
}
