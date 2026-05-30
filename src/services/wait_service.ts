import type { WaitForEventsInput } from "../types.js";
import { CodexLeadService } from "./codex_lead_service.js";
import { gatewayCall, type GatewayResult } from "./gateway_result.js";

export class WaitService {
  constructor(private readonly service: CodexLeadService) {}

  async wait(input: Record<string, unknown>): Promise<GatewayResult> {
    return gatewayCall("wait", async () => {
      const projectId = stringValue(input.project_id);
      if (stringValue(input.state) !== "active") {
        await this.service.setSupervisorState({
          ...(projectId ? { project_id: projectId } : {}),
          plan_id: stringValue(input.plan_id),
          state: stringValue(input.state) === "waiting" ? "waiting" : "sleeping",
          reason: stringValue(input.reason) ?? "Supervisor is waiting for wake-worthy worker events.",
        } as never);
      }
      return this.service.waitForEvents(input as unknown as WaitForEventsInput);
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
