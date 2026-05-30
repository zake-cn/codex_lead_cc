export interface McpJsonToolResult extends Record<string, unknown> {
    content: Array<{
        type: "text";
        text: string;
    }>;
    structuredContent: Record<string, unknown>;
}
export declare function mcpJsonResult(result: unknown): McpJsonToolResult;
