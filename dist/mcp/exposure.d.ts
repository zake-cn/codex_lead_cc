export declare const MCP_EXPOSURES: readonly ["compact", "full"];
export type McpExposure = (typeof MCP_EXPOSURES)[number];
export declare const COMPACT_MCP_TOOLS: readonly ["cc_dispatch", "cc_wait", "cc_inspect", "cc_decide"];
export declare const DEV_ADMIN_MCP_TOOLS: readonly ["cc_admin"];
export declare function fullMcpToolNames(): string[];
export declare function mcpToolNamesForExposure(exposure: McpExposure): string[];
export declare function normalizeMcpExposure(value: string | undefined): McpExposure;
