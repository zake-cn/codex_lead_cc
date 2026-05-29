import { TOOL_CATALOG } from "../tools/tool_catalog.js";

export const MCP_EXPOSURES = ["compact", "full"] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];

export const COMPACT_MCP_TOOLS = [
  "cc_dispatch",
  "cc_wait",
  "cc_inspect",
  "cc_decide",
] as const;

export const DEV_ADMIN_MCP_TOOLS = ["cc_admin"] as const;

export function fullMcpToolNames(): string[] {
  return Object.keys(TOOL_CATALOG).sort();
}

export function mcpToolNamesForExposure(exposure: McpExposure): string[] {
  if (exposure === "compact") {
    return [...COMPACT_MCP_TOOLS];
  }
  return fullMcpToolNames();
}

export function normalizeMcpExposure(value: string | undefined): McpExposure {
  if (!value) {
    return "full";
  }
  if (value === "compact" || value === "full") {
    return value;
  }
  throw new Error("MCP exposure must be compact or full.");
}
