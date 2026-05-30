import { gatewayCall } from "./gateway_result.js";
export class WaitService {
    service;
    constructor(service) {
        this.service = service;
    }
    async wait(input) {
        return gatewayCall("wait", async () => {
            const projectId = stringValue(input.project_id);
            if (stringValue(input.state) !== "active") {
                await this.service.setSupervisorState({
                    ...(projectId ? { project_id: projectId } : {}),
                    plan_id: stringValue(input.plan_id),
                    state: stringValue(input.state) === "waiting" ? "waiting" : "sleeping",
                    reason: stringValue(input.reason) ?? "Supervisor is waiting for wake-worthy worker events.",
                });
            }
            return this.service.waitForEvents(input);
        });
    }
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
//# sourceMappingURL=wait_service.js.map