import { ProcessManager } from "./process_manager.js";
import { StateStore } from "./state_store.js";
import { TaskManager } from "./task_manager.js";
import { WorkerManager } from "./worker_manager.js";
import { EventLog } from "./event_log.js";
import { PermissionEngine } from "./permission_engine.js";
import { Scheduler } from "./scheduler.js";
import { WorktreeManager } from "./worktree_manager.js";
import { DiffManager } from "./diff_manager.js";
import { PlanManager } from "./plan_manager.js";
import { DagScheduler } from "./dag_scheduler.js";
import { SessionManager } from "./session_manager.js";
import { MetricsCollector } from "./metrics_collector.js";
import { SupervisorStateManager } from "./supervisor_state.js";
import { SupervisorInbox } from "./supervisor_inbox.js";
import { WaitController } from "./wait_controller.js";

export interface OrchestratorRuntime {
  store: StateStore;
  supervisorSessionId?: string;
  workers: WorkerManager;
  tasks: TaskManager;
  events: EventLog;
  permissions: PermissionEngine;
  scheduler: Scheduler;
  dag: DagScheduler;
  worktrees: WorktreeManager;
  diffs: DiffManager;
  plans: PlanManager;
  sessions: SessionManager;
  metrics: MetricsCollector;
  supervisorState: SupervisorStateManager;
  inbox: SupervisorInbox;
  wait: WaitController;
}

export function createRuntime(stateDir?: string, options: { supervisorSessionId?: string } = {}): OrchestratorRuntime {
  const store = new StateStore(stateDir);
  const processManager = new ProcessManager();
  const permissions = new PermissionEngine(store);
  const dag = new DagScheduler();
  const scheduler = new Scheduler(store, processManager, dag, permissions);
  return {
    store,
    supervisorSessionId: options.supervisorSessionId,
    workers: new WorkerManager(store),
    tasks: new TaskManager(store, processManager, scheduler),
    events: new EventLog(store),
    permissions,
    scheduler,
    dag,
    worktrees: new WorktreeManager(store),
    diffs: new DiffManager(store),
    plans: new PlanManager(store),
    sessions: new SessionManager(store),
    metrics: new MetricsCollector(store),
    supervisorState: new SupervisorStateManager(store),
    inbox: new SupervisorInbox(store),
    wait: new WaitController(store),
  };
}
