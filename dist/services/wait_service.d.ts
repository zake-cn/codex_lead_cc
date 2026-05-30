import { CodexLeadService } from "./codex_lead_service.js";
import { type GatewayResult } from "./gateway_result.js";
export declare class WaitService {
    private readonly service;
    constructor(service: CodexLeadService);
    wait(input: Record<string, unknown>): Promise<GatewayResult>;
}
