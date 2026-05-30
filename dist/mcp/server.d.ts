import { type McpExposure } from "./exposure.js";
export interface McpServerOptions {
    exposure?: McpExposure;
}
export declare function startMcpServer(options?: McpServerOptions): Promise<void>;
