import type {
  GetDiffDetailInput,
  GetDiffSummaryInput,
  GetInboxInput,
  GetPlanInput,
  GetReportInput,
  GetStatusInput,
  GetSupervisorStateInput,
  GetUpdatesInput,
  GetWorkerHealthInput,
  ListPlansInput,
  ListTasksInput,
  ListWorkersInput,
  MetricsInput,
} from "../types.js";
import { CodexLeadService } from "./codex_lead_service.js";
import { gatewayCall, type GatewayResult } from "./gateway_result.js";

export class InspectService {
  constructor(private readonly service: CodexLeadService) {}

  async inspect(input: Record<string, unknown>): Promise<GatewayResult> {
    const action = requireAction(input);
    return gatewayCall(action, async () => {
      if (action === "get_status") {
        return this.getStatus(input);
      }
      if (action === "list_workers") {
        return this.service.listWorkers(input as unknown as ListWorkersInput);
      }
      if (action === "list_tasks") {
        return this.service.listTasks(input as unknown as ListTasksInput);
      }
      if (action === "get_plan") {
        return this.service.getPlan(input as unknown as GetPlanInput);
      }
      if (action === "list_plans") {
        return this.service.listPlans(input as unknown as ListPlansInput);
      }
      if (action === "get_updates") {
        return this.service.getUpdates(input as unknown as GetUpdatesInput);
      }
      if (action === "get_inbox") {
        return this.service.getInbox(input as unknown as GetInboxInput);
      }
      if (action === "get_report") {
        return this.service.getReport({ level: "summary", ...input } as unknown as GetReportInput);
      }
      if (action === "get_diff_summary") {
        return this.service.getDiffSummary(input as unknown as GetDiffSummaryInput);
      }
      if (action === "get_diff_detail") {
        return this.service.getDiffDetail(input as unknown as GetDiffDetailInput);
      }
      if (action === "get_metrics") {
        return this.service.getMetrics(input as unknown as MetricsInput);
      }
      if (action === "get_pending_permissions") {
        return this.service.getPendingPermissions(input);
      }
      if (action === "get_supervisor_state") {
        return this.service.getSupervisorState(input as unknown as GetSupervisorStateInput);
      }
      if (action === "get_worker_health") {
        return this.service.getWorkerHealth(input as unknown as GetWorkerHealthInput);
      }
      if (action === "get_benchmark_result") {
        return {
          message: "Benchmark sample results are available through npm run benchmark.",
        };
      }
      throw new Error(`Unknown cc_inspect action: ${action}`);
    });
  }

  private async getStatus(input: Record<string, unknown>) {
    if (input.task_id || input.worker_id || input.all) {
      return this.service.getStatus(input as unknown as GetStatusInput);
    }
    const [workers, tasks, pending_permissions, inbox] = await Promise.all([
      this.service.listWorkers({ project_id: stringValue(input.project_id) }),
      this.service.listTasks({ project_id: stringValue(input.project_id) }),
      this.service.getPendingPermissions({ project_id: stringValue(input.project_id) }),
      this.service.getInbox({
        project_id: stringValue(input.project_id),
        plan_id: stringValue(input.plan_id),
        only_unread: true,
        max_notifications: 20,
      }),
    ]);
    return {
      workers: workers.workers,
      tasks: tasks.tasks,
      pending_permissions: pending_permissions.pending_permissions,
      unread_notifications: inbox.notifications,
    };
  }
}

function requireAction(input: Record<string, unknown>): string {
  const action = stringValue(input.action);
  if (!action) {
    throw new Error("action is required.");
  }
  return action;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
