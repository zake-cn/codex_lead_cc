import { ProcessManager } from "./process_manager.js";
import { StateStore } from "./state_store.js";
import { TaskManager } from "./task_manager.js";
import { WorkerManager } from "./worker_manager.js";
import { EventLog } from "./event_log.js";
import { PermissionEngine } from "./permission_engine.js";
import { Scheduler } from "./scheduler.js";
import { WorktreeManager } from "./worktree_manager.js";
import { DiffManager } from "./diff_manager.js";

export interface OrchestratorRuntime {
  store: StateStore;
  workers: WorkerManager;
  tasks: TaskManager;
  events: EventLog;
  permissions: PermissionEngine;
  scheduler: Scheduler;
  worktrees: WorktreeManager;
  diffs: DiffManager;
}

export function createRuntime(stateDir?: string): OrchestratorRuntime {
  const store = new StateStore(stateDir);
  const processManager = new ProcessManager();
  const permissions = new PermissionEngine(store);
  const scheduler = new Scheduler(store, processManager);
  return {
    store,
    workers: new WorkerManager(store),
    tasks: new TaskManager(store, processManager, permissions, scheduler),
    events: new EventLog(store),
    permissions,
    scheduler,
    worktrees: new WorktreeManager(store),
    diffs: new DiffManager(store),
  };
}
