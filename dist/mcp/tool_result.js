export function mcpJsonResult(result) {
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
function toStructuredContent(result) {
    if (result && typeof result === "object" && !Array.isArray(result)) {
        return result;
    }
    return { result };
}
//# sourceMappingURL=tool_result.js.map