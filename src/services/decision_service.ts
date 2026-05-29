import type {
  ApprovePermissionInput,
  CleanupWorktreeInput,
  DeleteWorkerInput,
  MarkNotificationsReadInput,
  RejectPermissionInput,
  RestartWorkerInput,
  SetSupervisorStateInput,
  StopTaskInput,
  StopWorkerInput,
} from "../types.js";
import { CodexLeadService } from "./codex_lead_service.js";
import { gatewayCall, type GatewayResult } from "./gateway_result.js";

export class DecisionService {
  constructor(private readonly service: CodexLeadService) {}

  async decide(input: Record<string, unknown>): Promise<GatewayResult> {
    const action = requireAction(input);
    return gatewayCall(action, async () => {
      if (action === "approve_permission") {
        return this.service.approvePermission(input as unknown as ApprovePermissionInput);
      }
      if (action === "reject_permission") {
        return this.service.rejectPermission(input as unknown as RejectPermissionInput);
      }
      if (action === "stop_task") {
        return this.service.stopTask(input as unknown as StopTaskInput);
      }
      if (action === "stop_worker") {
        return this.service.stopWorker(input as unknown as StopWorkerInput);
      }
      if (action === "delete_worker") {
        return this.service.deleteWorker(input as unknown as DeleteWorkerInput);
      }
      if (action === "restart_worker") {
        return this.service.restartWorker(input as unknown as RestartWorkerInput);
      }
      if (action === "mark_notifications_read") {
        return this.service.markNotificationsRead(input as unknown as MarkNotificationsReadInput);
      }
      if (action === "set_supervisor_state") {
        return this.service.setSupervisorState(input as unknown as SetSupervisorStateInput);
      }
      if (action === "cleanup_worktree") {
        return this.service.cleanupWorktree(input as unknown as CleanupWorktreeInput);
      }
      if (action === "accept_patch" || action === "reject_patch" || action === "request_changes") {
        return {
          decision: action,
          message: "Patch merge is not automated in this local runtime; decision recorded for supervisor flow.",
        };
      }
      if (action === "skip_task" || action === "override_task_status") {
        throw new Error(`${action} is not implemented in compact gateway mode.`);
      }
      throw new Error(`Unknown cc_decide action: ${action}`);
    });
  }
}

function requireAction(input: Record<string, unknown>): string {
  const action = typeof input.action === "string" ? input.action.trim() : "";
  if (!action) {
    throw new Error("action is required.");
  }
  return action;
}
