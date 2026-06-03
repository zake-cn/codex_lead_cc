import type { BridgeCommandResult } from "../types.js";
import type { TerminalScreenSnapshot } from "./terminal_screen.js";
export declare const DONE_MARKER = "<<<CODEX_LEAD_CC_DONE>>>";
export interface CompletionDetectorOptions {
    minRunMs: number;
    quietMs: number;
    spinnerStableMs: number;
    checkIntervalMs: number;
    submitGraceMs: number;
}
export interface CompletionCheckInput {
    now: number;
    startedAt: number;
    submittedAt?: number;
    lastOutputAt: number;
    deadlineAt: number;
    seenDoneMarker: boolean;
    effectiveOutputSeen: boolean;
    inputBoxStillContainsPrompt: boolean;
    snapshot: TerminalScreenSnapshot;
}
export interface ScreenDetection {
    spinnerDetected: boolean;
    permissionPromptDetected: boolean;
    suggestedKeys: string[];
}
export declare const DEFAULT_COMPLETION_OPTIONS: CompletionDetectorOptions;
export declare class CompletionDetector {
    private readonly options;
    private spinnerLastSeenAt;
    constructor(options?: CompletionDetectorOptions);
    reset(): void;
    inspect(snapshot: TerminalScreenSnapshot, now?: number): ScreenDetection;
    check(input: CompletionCheckInput): BridgeCommandResult | undefined;
}
export declare function detectPermissionPrompt(snapshot: TerminalScreenSnapshot): {
    detected: boolean;
    suggestedKeys: string[];
};
export declare function detectSpinner(snapshot: TerminalScreenSnapshot): boolean;
