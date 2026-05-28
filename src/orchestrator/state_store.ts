import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentForemanState } from "../types.js";

const DEFAULT_STATE_DIR = ".agentforeman";

export class StateStore {
  readonly rootDir: string;
  readonly statePath: string;
  readonly logsDir: string;
  readonly reportsDir: string;
  readonly patchesDir: string;
  readonly worktreesDir: string;
  readonly metricsDir: string;
  readonly tmpDir: string;
  readonly lockPath: string;

  constructor(rootDir = process.env.AGENTFOREMAN_HOME ?? path.resolve(process.cwd(), DEFAULT_STATE_DIR)) {
    this.rootDir = path.resolve(rootDir);
    this.statePath = path.join(this.rootDir, "state.json");
    this.logsDir = path.join(this.rootDir, "logs");
    this.reportsDir = path.join(this.rootDir, "reports");
    this.patchesDir = path.join(this.rootDir, "patches");
    this.worktreesDir = path.join(this.rootDir, "worktrees");
    this.metricsDir = path.join(this.rootDir, "metrics");
    this.tmpDir = path.join(this.rootDir, "tmp");
    this.lockPath = path.join(this.tmpDir, "state.lock");
  }

  async init(): Promise<void> {
    await Promise.all([
      mkdir(this.logsDir, { recursive: true }),
      mkdir(this.reportsDir, { recursive: true }),
      mkdir(this.patchesDir, { recursive: true }),
      mkdir(this.worktreesDir, { recursive: true }),
      mkdir(this.metricsDir, { recursive: true }),
      mkdir(this.tmpDir, { recursive: true }),
    ]);

    const existing = await this.readStateFile();
    if (!existing) {
      await this.writeState(defaultState());
    }
  }

  async readState(): Promise<AgentForemanState> {
    await this.init();
    return normalizeState((await this.readStateFile()) ?? defaultState());
  }

  async updateState<T>(mutator: (state: AgentForemanState) => T): Promise<T> {
    await this.init();
    return this.withLock(async () => {
      const state = normalizeState((await this.readStateFile()) ?? defaultState());
      const result = mutator(state);
      await this.writeState(state);
      return result;
    });
  }

  taskPaths(taskId: string): {
    logPath: string;
    stdoutPath: string;
    stderrPath: string;
    reportPath: string;
    patchPath: string;
    diffSummaryPath: string;
    displayLogPath: string;
    displayStdoutPath: string;
    displayStderrPath: string;
    displayReportPath: string;
    displayPatchPath: string;
    displayDiffSummaryPath: string;
  } {
    const logPath = path.join(this.logsDir, `${taskId}.log`);
    const stdoutPath = path.join(this.logsDir, `${taskId}.stdout.log`);
    const stderrPath = path.join(this.logsDir, `${taskId}.stderr.log`);
    const reportPath = path.join(this.reportsDir, `${taskId}.json`);
    const patchPath = path.join(this.patchesDir, `${taskId}.patch`);
    const diffSummaryPath = path.join(this.patchesDir, `${taskId}.diff-summary.json`);

    return {
      logPath,
      stdoutPath,
      stderrPath,
      reportPath,
      patchPath,
      diffSummaryPath,
      displayLogPath: this.displayPath(logPath),
      displayStdoutPath: this.displayPath(stdoutPath),
      displayStderrPath: this.displayPath(stderrPath),
      displayReportPath: this.displayPath(reportPath),
      displayPatchPath: this.displayPath(patchPath),
      displayDiffSummaryPath: this.displayPath(diffSummaryPath),
    };
  }

  metricsPath(scope: string): { metricsPath: string; displayMetricsPath: string } {
    const metricsPath = path.join(this.metricsDir, `${scope}.json`);
    return {
      metricsPath,
      displayMetricsPath: this.displayPath(metricsPath),
    };
  }

  worktreePath(taskId: string, suffix = "impl"): string {
    return path.join(this.worktreesDir, `${taskId}_${suffix}`);
  }

  displayPath(filePath: string): string {
    const relative = path.relative(process.cwd(), filePath);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative;
    }
    return filePath;
  }

  private async readStateFile(): Promise<AgentForemanState | undefined> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as AgentForemanState;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async writeState(state: AgentForemanState): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true });
    const tmpPath = path.join(
      this.tmpDir,
      `state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.json`,
    );
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.statePath);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        handle = await open(this.lockPath, "wx");
        break;
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") {
          throw error;
        }

        await this.removeStaleLock();
        await delay(25);
      }
    }

    if (!handle) {
      throw new Error(`Timed out waiting for state lock: ${this.lockPath}`);
    }

    try {
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
      return await fn();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
    }
  }

  private async removeStaleLock(): Promise<void> {
    const lockStat = await stat(this.lockPath).catch(() => undefined);
    if (!lockStat) {
      return;
    }
    if (Date.now() - lockStat.mtimeMs > 30_000) {
      await unlink(this.lockPath).catch(() => undefined);
    }
  }
}

export function defaultState(): AgentForemanState {
  return {
    version: 3,
    counters: {
      worker: 0,
      task: 0,
      event: 0,
      permission: 0,
      rule: 0,
      artifact: 0,
      plan: 0,
      plan_change: 0,
      session: 0,
    },
    workers: {},
    tasks: {},
    events: [],
    permission_requests: {},
    permission_rules: {},
    artifacts: {},
    plans: {},
    plan_changes: {},
    sessions: {},
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function nextId(
  prefix: "ccw" | "task" | "perm" | "rule" | "art" | "plan" | "change" | "session",
  counter: number,
): string {
  return `${prefix}_${counter.toString().padStart(3, "0")}`;
}

export function appendEvent(
  state: AgentForemanState,
  event: Omit<AgentForemanState["events"][number], "event_id" | "time">,
): AgentForemanState["events"][number] {
  state.counters.event += 1;
  const record = {
    event_id: state.counters.event,
    time: nowIso(),
    ...event,
  };
  state.events.push(record);
  return record;
}

function normalizeState(raw: AgentForemanState): AgentForemanState {
  const base = defaultState();
  const normalized: AgentForemanState = {
    ...base,
    ...raw,
    version: 3,
    counters: {
      ...base.counters,
      ...(raw.counters ?? {}),
    },
    workers: raw.workers ?? {},
    tasks: raw.tasks ?? {},
    events: raw.events ?? [],
    permission_requests: raw.permission_requests ?? {},
    permission_rules: raw.permission_rules ?? {},
    artifacts: raw.artifacts ?? {},
    plans: raw.plans ?? {},
    plan_changes: raw.plan_changes ?? {},
    sessions: raw.sessions ?? {},
  };

  for (const worker of Object.values(normalized.workers)) {
    worker.project_id = worker.project_id ?? path.basename(worker.project_path);
    worker.runtime = worker.runtime ?? "claude_cli";
    worker.last_active_at = worker.last_active_at ?? worker.updated_at ?? worker.created_at;
    worker.idle_timeout_sec = worker.idle_timeout_sec ?? 900;
    worker.worktree_mode =
      worker.worktree_mode ??
      (worker.role === "implementer" ? "isolated" : worker.role === "scout" || worker.role === "reviewer" ? "readonly" : "direct");
    if (!worker.session_id) {
      normalized.counters.session += 1;
      worker.session_id = nextId("session", normalized.counters.session);
    }
    if (!normalized.sessions[worker.session_id]) {
      normalized.sessions[worker.session_id] = {
        session_id: worker.session_id,
        worker_id: worker.id,
        runtime: worker.runtime,
        project_id: worker.project_id,
        role: worker.role,
        status: worker.status === "running" || worker.status === "pending" || worker.status === "busy" ? "busy" : worker.status === "crashed" ? "crashed" : worker.status === "stopped" ? "stopped" : "idle",
        created_at: worker.created_at,
        last_active_at: worker.last_active_at,
        idle_timeout_sec: worker.idle_timeout_sec,
        metadata: {},
      };
    }
  }

  for (const task of Object.values(normalized.tasks)) {
    const worker = normalized.workers[task.worker_id];
    task.project_id = task.project_id ?? worker?.project_id ?? path.basename(task.project_path);
    task.execution_path = task.execution_path ?? task.project_path;
    task.runtime = task.runtime ?? worker?.runtime ?? "claude_cli";
    task.depends_on = task.depends_on ?? [];
    task.blocked_by = task.blocked_by ?? [];
    task.worktree_mode =
      task.worktree_mode ??
      (task.role === "implementer" ? "isolated" : task.role === "scout" || task.role === "reviewer" ? "readonly" : "direct");
    task.report_type =
      task.report_type ??
      (task.role === "implementer"
        ? "implementation"
        : task.role === "tester"
          ? "test"
          : task.role === "reviewer"
            ? "review"
            : task.role === "scout"
              ? "scout"
              : "task");
    const paths = new StateStore().taskPaths(task.id);
    task.patch_path = task.patch_path ?? paths.displayPatchPath;
    task.diff_summary_path = task.diff_summary_path ?? paths.displayDiffSummaryPath;
  }

  for (const plan of Object.values(normalized.plans)) {
    plan.history = plan.history ?? [];
    for (const planTask of plan.tasks) {
      planTask.depends_on = planTask.depends_on ?? [];
    }
  }

  return normalized;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
