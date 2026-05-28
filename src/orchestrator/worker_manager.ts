import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  CreateWorkerInput,
  DeleteWorkerInput,
  ListWorkersInput,
  WorkerRuntime,
  WorkerRecord,
  WorkerRole,
  WorkerStatus,
} from "../types.js";
import { WORKER_ROLES, WORKER_RUNTIMES } from "../types.js";
import { loadConfig } from "../config/load_config.js";
import { appendEvent, nextId, nowIso, StateStore } from "./state_store.js";
import { setWorkerTaskState } from "./worker_state.js";

const VALID_ROLES = new Set<WorkerRole>(WORKER_ROLES);
const VALID_RUNTIMES = new Set<WorkerRuntime>(WORKER_RUNTIMES);

export class WorkerManager {
  constructor(private readonly store: StateStore) {}

  async createWorker(input: CreateWorkerInput): Promise<WorkerRecord> {
    const projectPath = await normalizeProjectPath(input.project_path);
    const config = await loadConfig(projectPath);
    const role = normalizeRole(input.role);
    const runtime = normalizeRuntime(input.runtime ?? config.runtime.default_adapter);
    const projectId = input.project_id ?? path.basename(projectPath);
    const timestamp = nowIso();

    return this.store.updateState((state) => {
      state.counters.worker += 1;
      const id = nextId("ccw", state.counters.worker);
      state.counters.session += 1;
      const sessionId = nextId("session", state.counters.session);
      const worker: WorkerRecord = {
        id,
        role,
        status: "idle",
        runtime,
        session_id: sessionId,
        project_id: projectId,
        project_path: projectPath,
        worktree_mode: input.worktree_mode ?? defaultWorktreeMode(role),
        last_active_at: timestamp,
        idle_timeout_sec: input.idle_timeout_sec ?? config.worker_idle_timeout_sec,
        created_at: timestamp,
        updated_at: timestamp,
      };
      state.workers[id] = worker;
      state.sessions[sessionId] = {
        session_id: sessionId,
        worker_id: id,
        runtime,
        project_id: projectId,
        role,
        status: "idle",
        created_at: timestamp,
        last_active_at: timestamp,
        idle_timeout_sec: worker.idle_timeout_sec ?? config.worker_idle_timeout_sec,
        metadata: {
          adapter_note:
            runtime === "claude_sdk"
              ? "SDK session metadata is reserved; Phase 3 falls back to CLI when SDK is unavailable."
              : "CLI adapter uses per-task processes with reusable worker metadata.",
        },
      };
      appendEvent(state, {
        type: "worker_created",
        project_id: worker.project_id,
        worker_id: worker.id,
        summary: `Created ${role} worker ${worker.id}.`,
        payload: {
          project_path: projectPath,
          worktree_mode: worker.worktree_mode,
          runtime,
          session_id: sessionId,
        },
      });
      appendEvent(state, {
        type: "session_created",
        project_id: worker.project_id,
        worker_id: worker.id,
        summary: `Created session ${sessionId} for worker ${worker.id}.`,
        payload: { session_id: sessionId, runtime },
      });
      return worker;
    });
  }

  async getWorker(workerId: string): Promise<WorkerRecord> {
    const state = await this.store.readState();
    const worker = state.workers[workerId];
    if (!worker) {
      throw new Error(`Worker not found: ${workerId}`);
    }
    return worker;
  }

  async setWorkerStatus(args: {
    workerId: string;
    status: WorkerStatus;
    currentTaskId?: string;
  }): Promise<WorkerRecord> {
    const timestamp = nowIso();
    return this.store.updateState((state) => {
      const worker = state.workers[args.workerId];
      if (!worker) {
        throw new Error(`Worker not found: ${args.workerId}`);
      }
      setWorkerTaskState({
        state,
        worker,
        status: args.status,
        timestamp,
        currentTaskId: args.currentTaskId,
      });
      return worker;
    });
  }

  async deleteWorker(input: DeleteWorkerInput): Promise<{ worker_id: string; deleted: true }> {
    return this.store.updateState((state) => {
      const worker = state.workers[input.worker_id];
      if (!worker) {
        throw new Error(`Worker not found: ${input.worker_id}`);
      }
      if (worker.status === "running" || worker.status === "pending" || worker.status === "busy" || worker.current_task_id) {
        throw new Error(`Worker ${input.worker_id} has a running task and cannot be deleted.`);
      }
      if (worker.session_id) {
        delete state.sessions[worker.session_id];
      }
      delete state.workers[input.worker_id];
      appendEvent(state, {
        type: "worker_deleted",
        project_id: worker.project_id,
        worker_id: worker.id,
        summary: `Deleted worker ${worker.id}.`,
        payload: {},
      });
      return {
        worker_id: input.worker_id,
        deleted: true,
      };
    });
  }

  async listWorkers(input: ListWorkersInput): Promise<{ workers: WorkerRecord[] }> {
    const state = await this.store.readState();
    return {
      workers: Object.values(state.workers).filter((worker) => {
        if (input.project_id && worker.project_id !== input.project_id) {
          return false;
        }
        if (input.status && worker.status !== input.status) {
          return false;
        }
        return true;
      }),
    };
  }
}

export function normalizeRole(role: string): WorkerRole {
  if (!VALID_ROLES.has(role as WorkerRole)) {
    throw new Error("role must be one of: scout, implementer, tester, reviewer.");
  }
  return role as WorkerRole;
}

export function normalizeRuntime(runtime: string): WorkerRuntime {
  if (!VALID_RUNTIMES.has(runtime as WorkerRuntime)) {
    throw new Error("runtime must be one of: claude_cli, claude_sdk.");
  }
  return runtime as WorkerRuntime;
}

function defaultWorktreeMode(role: WorkerRole): WorkerRecord["worktree_mode"] {
  if (role === "implementer") {
    return "isolated";
  }
  if (role === "scout" || role === "reviewer") {
    return "readonly";
  }
  return "direct";
}

async function normalizeProjectPath(projectPath: string): Promise<string> {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("project_path is required and must be a non-empty string.");
  }

  const resolved = path.resolve(projectPath);
  const projectStat = await stat(resolved).catch(() => undefined);
  if (!projectStat?.isDirectory()) {
    throw new Error(`project_path does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}
