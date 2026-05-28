import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  CreateWorkerInput,
  DeleteWorkerInput,
  ListWorkersInput,
  WorkerRecord,
  WorkerRole,
  WorkerStatus,
} from "../types.js";
import { appendEvent, nextId, nowIso, StateStore } from "./state_store.js";

const VALID_ROLES = new Set<WorkerRole>(["scout", "implementer", "tester", "reviewer"]);

export class WorkerManager {
  constructor(private readonly store: StateStore) {}

  async createWorker(input: CreateWorkerInput): Promise<WorkerRecord> {
    const projectPath = await normalizeProjectPath(input.project_path);
    const role = normalizeRole(input.role);
    const projectId = input.project_id ?? path.basename(projectPath);
    const timestamp = nowIso();

    return this.store.updateState((state) => {
      state.counters.worker += 1;
      const id = nextId("ccw", state.counters.worker);
      const worker: WorkerRecord = {
        id,
        role,
        status: "idle",
        project_id: projectId,
        project_path: projectPath,
        worktree_mode: input.worktree_mode ?? defaultWorktreeMode(role),
        created_at: timestamp,
        updated_at: timestamp,
      };
      state.workers[id] = worker;
      appendEvent(state, {
        type: "worker_created",
        project_id: worker.project_id,
        worker_id: worker.id,
        summary: `Created ${role} worker ${worker.id}.`,
        payload: { project_path: projectPath, worktree_mode: worker.worktree_mode },
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
      worker.status = args.status;
      worker.updated_at = timestamp;
      if (args.currentTaskId) {
        worker.current_task_id = args.currentTaskId;
      } else {
        delete worker.current_task_id;
      }
      return worker;
    });
  }

  async deleteWorker(input: DeleteWorkerInput): Promise<{ worker_id: string; deleted: true }> {
    return this.store.updateState((state) => {
      const worker = state.workers[input.worker_id];
      if (!worker) {
        throw new Error(`Worker not found: ${input.worker_id}`);
      }
      if (worker.status === "running" || worker.current_task_id) {
        throw new Error(`Worker ${input.worker_id} has a running task and cannot be deleted.`);
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
