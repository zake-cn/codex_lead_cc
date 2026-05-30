import { TOOL_CATALOG } from "../tools/tool_catalog.js";
export const MCP_EXPOSURES = ["compact", "full"];
export const COMPACT_MCP_TOOLS = [
    "cc_dispatch",
    "cc_wait",
    "cc_inspect",
    "cc_decide",
];
export const DEV_ADMIN_MCP_TOOLS = ["cc_admin"];
export function fullMcpToolNames() {
    return Object.keys(TOOL_CATALOG).sort();
}
export function mcpToolNamesForExposure(exposure) {
    if (exposure === "compact") {
        return [...COMPACT_MCP_TOOLS];
    }
    return fullMcpToolNames();
}
export function normalizeMcpExposure(value) {
    if (!value) {
        return "full";
    }
    if (value === "compact" || value === "full") {
        return value;
    }
    throw new Error("MCP exposure must be compact or full.");
}
//# sourceMappingURL=exposure.js.map