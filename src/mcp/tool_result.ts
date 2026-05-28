export interface McpJsonToolResult extends Record<string, unknown> {
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent: Record<string, unknown>;
}

export function mcpJsonResult(result: unknown): McpJsonToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: toStructuredContent(result),
  };
}

function toStructuredContent(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
}
