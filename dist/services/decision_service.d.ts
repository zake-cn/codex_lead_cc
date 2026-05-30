import { CodexLeadService } from "./codex_lead_service.js";
import { type GatewayResult } from "./gateway_result.js";
export declare class DecisionService {
    private readonly service;
    constructor(service: CodexLeadService);
    decide(input: Record<string, unknown>): Promise<GatewayResult>;
}
