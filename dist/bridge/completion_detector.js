import { stripAnsi } from "./terminal_screen.js";
export const DONE_MARKER = "<<<CODEX_LEAD_CC_DONE>>>";
export const DEFAULT_COMPLETION_OPTIONS = {
    minRunMs: 1_500,
    quietMs: 2_500,
    spinnerStableMs: 1_000,
    checkIntervalMs: 100,
};
export class CompletionDetector {
    options;
    spinnerLastSeenAt = 0;
    constructor(options = DEFAULT_COMPLETION_OPTIONS) {
        this.options = options;
    }
    inspect(snapshot, now = Date.now()) {
        const spinnerVisible = detectSpinner(snapshot);
        if (spinnerVisible) {
            this.spinnerLastSeenAt = now;
        }
        const spinnerDetected = spinnerVisible ||
            (this.spinnerLastSeenAt > 0 && now - this.spinnerLastSeenAt < this.options.spinnerStableMs);
        const permission = detectPermissionPrompt(snapshot);
        return {
            spinnerDetected,
            permissionPromptDetected: permission.detected,
            suggestedKeys: permission.suggestedKeys,
        };
    }
    check(input) {
        if (input.seenDoneMarker) {
            return { status: "completed" };
        }
        const screen = this.inspect(input.snapshot, input.now);
        if (screen.permissionPromptDetected) {
            return { status: "needs_permission", suggested_keys: screen.suggestedKeys };
        }
        if (input.now >= input.deadlineAt) {
            return { status: "timeout" };
        }
        const quietEnough = input.now - input.lastOutputAt >= this.options.quietMs;
        const ranLongEnough = input.now - input.startedAt >= this.options.minRunMs;
        if (quietEnough && ranLongEnough && !screen.spinnerDetected) {
            return { status: "completed" };
        }
        return undefined;
    }
}
export function detectPermissionPrompt(snapshot) {
    const text = visibleText(snapshot);
    const hasOne = /^\s*1[.)]\s+/m.test(text);
    const hasTwo = /^\s*2[.)]\s+/m.test(text);
    const hasThree = /^\s*3[.)]\s+/m.test(text);
    const hasChoices = hasOne && hasTwo && hasThree;
    const hasYes = /\bYes\b/i.test(text);
    const hasNo = /\bNo\b/i.test(text);
    const hasDontAskAgain = /don't ask again|dont ask again/i.test(text);
    const hasCommandRequest = /wants to run|run command|execute command|permission to run|allow .* command/i.test(text);
    const detected = hasChoices && ((hasYes && hasNo) || hasDontAskAgain || hasCommandRequest);
    return {
        detected,
        suggestedKeys: detected ? ["1", "2", "3"] : [],
    };
}
export function detectSpinner(snapshot) {
    const bottom = snapshot.bottom_lines.join("\n");
    const raw = stripAnsi(snapshot.raw_tail).slice(-2_000);
    const text = `${bottom}\n${raw}`;
    const last = snapshot.bottom_lines.at(-1)?.trim() ?? "";
    return (/\b(thinking|loading|processing|waiting|working)\b/i.test(text) ||
        /esc to interrupt|press esc|ctrl-c to/i.test(text) ||
        /[\u2800-\u28ff\u25d0-\u25ff]/u.test(text) ||
        /(^|\s)[|/\\-]\s*$/.test(last));
}
function visibleText(snapshot) {
    const screenTail = snapshot.text.slice(-8_000);
    const rawTail = stripAnsi(snapshot.raw_tail).slice(-8_000);
    return `${screenTail}\n${rawTail}`;
}
//# sourceMappingURL=completion_detector.js.map