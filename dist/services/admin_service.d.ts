import { CodexLeadService } from "./codex_lead_service.js";
import { type GatewayResult } from "./gateway_result.js";
export declare class AdminService {
    private readonly service;
    constructor(service: CodexLeadService);
    admin(input: Record<string, unknown>): Promise<GatewayResult>;
}
