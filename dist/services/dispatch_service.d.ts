import { CodexLeadService } from "./codex_lead_service.js";
import { type GatewayResult } from "./gateway_result.js";
export declare class DispatchService {
    private readonly service;
    constructor(service: CodexLeadService);
    dispatch(input: Record<string, unknown>): Promise<GatewayResult>;
    private assignTask;
    private assignRoleTask;
    private findOrCreateWorker;
}
