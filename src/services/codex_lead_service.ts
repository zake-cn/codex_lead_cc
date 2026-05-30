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
import { resolveProjectContext, resolveProjectPathById } from "../orchestrator/project_registry.js";
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
    return sanitizeSupervisorOutput(
      await this.runtime.workers.createWorker(await this.applyProjectDefaults(input)),
    );
  }

  async assignTask(input: AssignTaskInput) {
    return this.runtime.tasks.assignTask(input);
  }

  async getStatus(input: GetStatusInput) {
    return sanitizeSupervisorOutput(await this.runtime.tasks.getStatus(input));
  }

  async getReport(input: GetReportInput) {
    return this.runtime.tasks.getReport(input);
  }

  async setSupervisorState(input: SetSupervisorStateInput) {
    return this.runtime.supervisorState.setState(await this.applyProjectIdDefault(input));
  }

  async getSupervisorState(input: GetSupervisorStateInput) {
    return this.runtime.supervisorState.getState(await this.applyProjectIdDefault(input));
  }

  async waitForEvents(input: WaitForEventsInput) {
    return this.runtime.wait.waitForEvents(await this.applyOptionalProjectIdDefault(input));
  }

  async getInbox(input: GetInboxInput) {
    return this.runtime.inbox.getInbox(await this.applyOptionalProjectIdDefault(input));
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
    return sanitizeSupervisorOutput(await this.runtime.events.getUpdates(await this.applyOptionalProjectIdDefault(input)));
  }

  async getPendingPermissions(input: GetPendingPermissionsInput) {
    return this.runtime.permissions.getPendingPermissions(await this.applyOptionalProjectIdDefault(input));
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
    return sanitizeSupervisorOutput(
      await this.runtime.workers.listWorkers(await this.applyOptionalProjectIdDefault(input)),
    );
  }

  async listTasks(input: ListTasksInput) {
    return sanitizeSupervisorOutput(
      await this.runtime.tasks.listTasks(await this.applyOptionalProjectIdDefault(input)),
    );
  }

  async cleanupWorktree(input: CleanupWorktreeInput) {
    return this.runtime.worktrees.cleanup(input);
  }

  async createPlan(input: CreatePlanInput) {
    return this.runtime.plans.createPlan(await this.applyProjectIdDefault(input));
  }

  async getPlan(input: GetPlanInput) {
    return this.runtime.plans.getPlan(input);
  }

  async updatePlan(input: UpdatePlanInput) {
    return this.runtime.plans.updatePlan(input);
  }

  async listPlans(input: ListPlansInput) {
    return this.runtime.plans.listPlans(await this.applyOptionalProjectIdDefault(input));
  }

  async getMetrics(input: MetricsInput) {
    return this.runtime.metrics.getMetrics(await this.applyOptionalProjectIdDefault(input));
  }

  async restartWorker(input: RestartWorkerInput) {
    return this.runtime.sessions.restartWorker(input);
  }

  async getWorkerHealth(input: GetWorkerHealthInput) {
    return this.runtime.sessions.getWorkerHealth(await this.applyOptionalProjectIdDefault(input));
  }

  async cleanupIdleWorkers(input: CleanupIdleWorkersInput) {
    return this.runtime.sessions.cleanupIdleWorkers(await this.applyOptionalProjectIdDefault(input));
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

  async projectDefaults(input: Record<string, unknown> = {}): Promise<{
    project_id?: string;
    project_path?: string;
  }> {
    const explicitProjectId = stringValue(input.project_id);
    const explicitProjectPath = stringValue(input.project_path);
    const sessionContext = await resolveProjectContext(this.runtime.store, this.runtime.supervisorSessionId);
    const mappedProjectPath = await resolveProjectPathById(this.runtime.store, explicitProjectId);
    const canUseSessionPath = !explicitProjectId || explicitProjectId === sessionContext?.project_id;

    return {
      project_id: explicitProjectId ?? sessionContext?.project_id,
      project_path: explicitProjectPath ?? mappedProjectPath ?? (canUseSessionPath ? sessionContext?.project_path : undefined),
    };
  }

  private async applyProjectDefaults<T extends { project_id?: string; project_path?: string }>(input: T): Promise<T> {
    const defaults = await this.projectDefaults(input as Record<string, unknown>);
    return {
      ...input,
      project_id: input.project_id ?? defaults.project_id,
      project_path: input.project_path ?? defaults.project_path,
    };
  }

  private async applyProjectIdDefault<T extends { project_id?: string }>(input: T): Promise<T & { project_id: string }> {
    const defaults = await this.projectDefaults(input as Record<string, unknown>);
    const projectId = input.project_id ?? defaults.project_id;
    if (!projectId) {
      throw new Error("project_id is required when no codex_lead_cc project session is active.");
    }
    return {
      ...input,
      project_id: projectId,
    };
  }

  private async applyOptionalProjectIdDefault<T extends { project_id?: string }>(input: T): Promise<T> {
    const defaults = await this.projectDefaults(input as Record<string, unknown>);
    return {
      ...input,
      project_id: input.project_id ?? defaults.project_id,
    };
  }
}

export function createCodexLeadService(stateDir?: string): CodexLeadService {
  return new CodexLeadService(createRuntime(stateDir, {
    supervisorSessionId: process.env.CODEX_LEAD_CC_SESSION_ID,
  }));
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

function sanitizeSupervisorOutput<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSupervisorOutput(item)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "project_path" || key === "execution_path") {
      continue;
    }
    sanitized[key] = sanitizeSupervisorOutput(item);
  }
  return sanitized as T;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
