import type { AgentForemanState, WorkerRecord, WorkerStatus } from "../types.js";

export function setWorkerTaskState(args: {
  state: AgentForemanState;
  worker: WorkerRecord;
  status: WorkerStatus;
  timestamp: string;
  currentTaskId?: string;
}): void {
  args.worker.status = args.status;
  args.worker.updated_at = args.timestamp;
  args.worker.last_active_at = args.timestamp;
  if (args.currentTaskId) {
    args.worker.current_task_id = args.currentTaskId;
  } else {
    delete args.worker.current_task_id;
  }

  const session = args.worker.session_id ? args.state.sessions[args.worker.session_id] : undefined;
  if (session) {
    session.status = sessionStatusForWorker(args.status);
    session.last_active_at = args.timestamp;
  }
}

export function sessionStatusForWorker(status: WorkerStatus): "idle" | "busy" | "stopped" | "crashed" {
  if (status === "running" || status === "pending" || status === "busy") {
    return "busy";
  }
  if (status === "stopped") {
    return "stopped";
  }
  if (status === "crashed") {
    return "crashed";
  }
  return "idle";
}
