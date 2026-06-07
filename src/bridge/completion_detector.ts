import type { BridgeCommandResult } from "../types.js";
import type { TerminalScreenSnapshot } from "./terminal_screen.js";
import { stripAnsi } from "./terminal_screen.js";

export const DONE_MARKER = "<<<CODEX_LEAD_CC_DONE>>>";

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

export const DEFAULT_COMPLETION_OPTIONS: CompletionDetectorOptions = {
  minRunMs: 1_500,
  quietMs: 2_500,
  spinnerStableMs: 1_000,
  checkIntervalMs: 100,
  submitGraceMs: 5_000,
};

export class CompletionDetector {
  private spinnerLastSeenAt = 0;

  constructor(private readonly options = DEFAULT_COMPLETION_OPTIONS) {}

  reset(): void {
    this.spinnerLastSeenAt = 0;
  }

  inspect(snapshot: TerminalScreenSnapshot, now = Date.now()): ScreenDetection {
    const spinnerVisible = detectSpinner(snapshot);
    if (spinnerVisible) {
      this.spinnerLastSeenAt = now;
    }
    const spinnerDetected =
      spinnerVisible ||
      (this.spinnerLastSeenAt > 0 && now - this.spinnerLastSeenAt < this.options.spinnerStableMs);
    const permission = detectPermissionPrompt(snapshot);
    return {
      spinnerDetected,
      permissionPromptDetected: permission.detected,
      suggestedKeys: permission.suggestedKeys,
    };
  }

  check(input: CompletionCheckInput): BridgeCommandResult | undefined {
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

    if (!input.submittedAt) {
      return undefined;
    }

    const quietEnough = input.now - input.lastOutputAt >= this.options.quietMs;
    const ranLongEnough = input.now - input.startedAt >= this.options.minRunMs;
    if (!input.effectiveOutputSeen) {
      const graceExpired = input.now - input.submittedAt >= this.options.submitGraceMs;
      if (graceExpired && (quietEnough || input.inputBoxStillContainsPrompt)) {
        return {
          status: "not_submitted",
          error: "Prompt appears to remain in Claude Code input box; no effective output was observed.",
        };
      }
      return undefined;
    }

    if (quietEnough && ranLongEnough && !screen.spinnerDetected && input.effectiveOutputSeen) {
      return { status: "completed" };
    }
    return undefined;
  }
}

export function detectPermissionPrompt(snapshot: TerminalScreenSnapshot): {
  detected: boolean;
  suggestedKeys: string[];
} {
  const text = visibleText(snapshot);
  // Allow common terminal cursor/selector characters before option numbers
  // (e.g. ❯ ▶ ▸ ●) so Claude Code permission menus are detected.
  const hasOne = /^[\s❯▶▸●○]*1[.)]\s+/m.test(text);
  const hasTwo = /^[\s❯▶▸●○]*2[.)]\s+/m.test(text);
  const hasThree = /^[\s❯▶▸●○]*3[.)]\s+/m.test(text);
  const hasChoices = hasOne && hasTwo && hasThree;
  const hasYes = /\bYes\b/i.test(text);
  const hasNo = /\bNo\b/i.test(text);
  const hasDontAskAgain = /don't ask again|dont ask again/i.test(text);
  const hasCommandRequest =
    /wants to run|run command|execute command|permission to run|allow .* command/i.test(text);

  const detected = hasChoices && ((hasYes && hasNo) || hasDontAskAgain || hasCommandRequest);
  return {
    detected,
    suggestedKeys: detected ? ["1", "2", "3"] : [],
  };
}

export function detectSpinner(snapshot: TerminalScreenSnapshot): boolean {
  const bottom = currentBottomText(snapshot);
  const last = snapshot.bottom_lines.at(-1)?.trim() ?? "";
  return (
    /\b(thinking|loading|processing|waiting|working)\b/i.test(bottom) ||
    /esc to interrupt|press esc|ctrl-c to/i.test(bottom) ||
    /[\u2800-\u28ff\u25d0-\u25ff]/u.test(bottom) ||
    /(^|\s)[|/\\-]\s*$/.test(last)
  );
}

function visibleText(snapshot: TerminalScreenSnapshot): string {
  return currentBottomText(snapshot, 8_000);
}

function currentBottomText(snapshot: TerminalScreenSnapshot, maxChars = 2_000): string {
  const current = snapshot.bottom_lines
    .slice(-5)
    .filter((line) => !looksLikeInputEchoLine(line))
    .join("\n");
  return stripAnsi(current).slice(-maxChars);
}

function looksLikeInputEchoLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^(?:bash|sh|zsh)-?\d*(?:\.\d+)*[$#]\s+/i.test(trimmed)) return true;
  if (/^>\s+\S/.test(trimmed)) return true;
  return false;
}
