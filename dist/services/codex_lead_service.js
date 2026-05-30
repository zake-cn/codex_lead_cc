import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { runClaudeTaskOnce } from "../claude/claude_runtime_adapter.js";
import { buildReport } from "../report/build_report.js";
import { createRuntime } from "../orchestrator/runtime.js";
import { resolveProjectContext, resolveProjectPathById } from "../orchestrator/project_registry.js";
import { AdminService } from "./admin_service.js";
import { DecisionService } from "./decision_service.js";
import { DispatchService } from "./dispatch_service.js";
import { InspectService } from "./inspect_service.js";
import { WaitService } from "./wait_service.js";
const DEFAULT_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 3_600;
export class CodexLeadService {
    runtime;
    constructor(runtime = createRuntime()) {
        this.runtime = runtime;
    }
    async runTask(input) {
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
    async createWorker(input) {
        return sanitizeSupervisorOutput(await this.runtime.workers.createWorker(await this.applyProjectDefaults(input)));
    }
    async assignTask(input) {
        return this.runtime.tasks.assignTask(input);
    }
    async getStatus(input) {
        return sanitizeSupervisorOutput(await this.runtime.tasks.getStatus(input));
    }
    async getReport(input) {
        return this.runtime.tasks.getReport(input);
    }
    async setSupervisorState(input) {
        return this.runtime.supervisorState.setState(await this.applyProjectIdDefault(input));
    }
    async getSupervisorState(input) {
        return this.runtime.supervisorState.getState(await this.applyProjectIdDefault(input));
    }
    async waitForEvents(input) {
        return this.runtime.wait.waitForEvents(await this.applyOptionalProjectIdDefault(input));
    }
    async getInbox(input) {
        return this.runtime.inbox.getInbox(await this.applyOptionalProjectIdDefault(input));
    }
    async markNotificationsRead(input) {
        return this.runtime.inbox.markRead(input);
    }
    async stopTask(input) {
        return this.runtime.tasks.stopTask(input);
    }
    async stopWorker(input) {
        return this.runtime.tasks.stopWorker(input);
    }
    async deleteWorker(input) {
        return this.runtime.workers.deleteWorker(input);
    }
    async getUpdates(input) {
        return sanitizeSupervisorOutput(await this.runtime.events.getUpdates(await this.applyOptionalProjectIdDefault(input)));
    }
    async getPendingPermissions(input) {
        return this.runtime.permissions.getPendingPermissions(await this.applyOptionalProjectIdDefault(input));
    }
    async approvePermission(input) {
        const result = await this.runtime.permissions.approve(input);
        await this.runtime.scheduler.schedule();
        return result;
    }
    async rejectPermission(input) {
        const result = await this.runtime.permissions.reject(input);
        await this.runtime.scheduler.schedule();
        return result;
    }
    async getDiffSummary(input) {
        return this.runtime.diffs.getSummary(input);
    }
    async getDiffDetail(input) {
        return this.runtime.diffs.getDetail(input);
    }
    async listWorkers(input) {
        return sanitizeSupervisorOutput(await this.runtime.workers.listWorkers(await this.applyOptionalProjectIdDefault(input)));
    }
    async listTasks(input) {
        return sanitizeSupervisorOutput(await this.runtime.tasks.listTasks(await this.applyOptionalProjectIdDefault(input)));
    }
    async cleanupWorktree(input) {
        return this.runtime.worktrees.cleanup(input);
    }
    async createPlan(input) {
        return this.runtime.plans.createPlan(await this.applyProjectIdDefault(input));
    }
    async getPlan(input) {
        return this.runtime.plans.getPlan(input);
    }
    async updatePlan(input) {
        return this.runtime.plans.updatePlan(input);
    }
    async listPlans(input) {
        return this.runtime.plans.listPlans(await this.applyOptionalProjectIdDefault(input));
    }
    async getMetrics(input) {
        return this.runtime.metrics.getMetrics(await this.applyOptionalProjectIdDefault(input));
    }
    async restartWorker(input) {
        return this.runtime.sessions.restartWorker(input);
    }
    async getWorkerHealth(input) {
        return this.runtime.sessions.getWorkerHealth(await this.applyOptionalProjectIdDefault(input));
    }
    async cleanupIdleWorkers(input) {
        return this.runtime.sessions.cleanupIdleWorkers(await this.applyOptionalProjectIdDefault(input));
    }
    async dispatch(input) {
        return new DispatchService(this).dispatch(input);
    }
    async wait(input) {
        return new WaitService(this).wait(input);
    }
    async inspect(input) {
        return new InspectService(this).inspect(input);
    }
    async decide(input) {
        return new DecisionService(this).decide(input);
    }
    async admin(input) {
        return new AdminService(this).admin(input);
    }
    async projectDefaults(input = {}) {
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
    async applyProjectDefaults(input) {
        const defaults = await this.projectDefaults(input);
        return {
            ...input,
            project_id: input.project_id ?? defaults.project_id,
            project_path: input.project_path ?? defaults.project_path,
        };
    }
    async applyProjectIdDefault(input) {
        const defaults = await this.projectDefaults(input);
        const projectId = input.project_id ?? defaults.project_id;
        if (!projectId) {
            throw new Error("project_id is required when no codex_lead_cc project session is active.");
        }
        return {
            ...input,
            project_id: projectId,
        };
    }
    async applyOptionalProjectIdDefault(input) {
        const defaults = await this.projectDefaults(input);
        return {
            ...input,
            project_id: input.project_id ?? defaults.project_id,
        };
    }
}
export function createCodexLeadService(stateDir) {
    return new CodexLeadService(createRuntime(stateDir, {
        supervisorSessionId: process.env.CODEX_LEAD_CC_SESSION_ID,
    }));
}
async function normalizeRunTaskInput(input) {
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
async function writePhase0TaskLog(report) {
    const logRoot = process.env.CODEX_LEAD_CC_LOG_DIR
        ? path.resolve(process.env.CODEX_LEAD_CC_LOG_DIR)
        : path.resolve(process.cwd(), ".codex_lead_cc", "logs");
    const logPath = path.join(logRoot, "tasks.jsonl");
    try {
        await mkdir(logRoot, { recursive: true });
        await writeFile(logPath, `${JSON.stringify(report)}\n`, { flag: "a" });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.stderr = appendLine(report.stderr, `Failed to write task log: ${message}`);
    }
}
function appendLine(existing, line) {
    if (!existing.trim()) {
        return line;
    }
    return `${existing.replace(/\s+$/, "")}\n${line}`;
}
function sanitizeSupervisorOutput(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeSupervisorOutput(item));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const sanitized = {};
    for (const [key, item] of Object.entries(value)) {
        if (key === "project_path" || key === "execution_path") {
            continue;
        }
        sanitized[key] = sanitizeSupervisorOutput(item);
    }
    return sanitized;
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
//# sourceMappingURL=codex_lead_service.js.map