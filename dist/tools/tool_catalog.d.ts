export interface ToolCatalogEntry {
    flags: Record<string, string>;
    handler: (input: Record<string, unknown>) => Promise<unknown>;
}
export declare const TOOL_CATALOG: Record<string, ToolCatalogEntry>;
