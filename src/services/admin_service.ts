import { TOOL_CATALOG } from "../tools/tool_catalog.js";
import { CodexLeadService } from "./codex_lead_service.js";
import { gatewayCall, type GatewayResult } from "./gateway_result.js";

export class AdminService {
  constructor(private readonly service: CodexLeadService) {}

  async admin(input: Record<string, unknown>): Promise<GatewayResult> {
    const action = typeof input.action === "string" && input.action.trim() ? input.action.trim() : "list_tools";
    return gatewayCall(action, async () => {
      if (action === "list_tools") {
        return {
          compact_tools: ["cc_dispatch", "cc_wait", "cc_inspect", "cc_decide"],
          full_tools: Object.keys(TOOL_CATALOG).sort(),
        };
      }
      if (action === "dump_state_summary") {
        const state = await this.service.runtime.store.readState();
        return {
          workers: Object.keys(state.workers).length,
          tasks: Object.keys(state.tasks).length,
          plans: Object.keys(state.plans).length,
          events: state.events.length,
          notifications: Object.keys(state.notifications).length,
          permission_requests: Object.keys(state.permission_requests).length,
        };
      }
      throw new Error(`Unknown cc_admin action: ${action}`);
    });
  }
}
