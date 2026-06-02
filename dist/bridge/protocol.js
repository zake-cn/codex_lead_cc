export function encodeFrame(frame) {
    return `${JSON.stringify(frame)}\n`;
}
export function parseFrame(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Bridge frame must be a JSON object.");
    }
    return parsed;
}
//# sourceMappingURL=protocol.js.map