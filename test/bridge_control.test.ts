#!/usr/bin/env npx tsx
/**
 * Regression tests for ctrl-c bypass (Bug 3) and stale-state recovery (Bug 4).
 *
 * Run: npx tsx test/bridge_control.test.ts
 */

import { inputKeyToBytes } from "../src/bridge/cc_bridge.js";
import { detectPermissionPrompt, detectSpinner } from "../src/bridge/completion_detector.js";
import type { BridgeInputKey } from "../src/types.js";
import type { TerminalScreenSnapshot } from "../src/bridge/terminal_screen.js";

let passed = 0;
let failed = 0;

function assert(
  label: string,
  actual: unknown,
  expected: unknown,
  detail = "",
): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
    if (detail) console.log(`       ${detail}`);
  }
}

function makeSnapshot(bottomLines: string[], extraText = ""): TerminalScreenSnapshot {
  return {
    text: [...bottomLines, extraText].filter(Boolean).join("\n"),
    lines: bottomLines,
    bottom_lines: bottomLines,
    raw_tail: bottomLines.join("\n"),
  };
}

console.log("\n=== Bridge Control Regression Tests ===\n");

// ── Bug 3: Ctrl-c key encoding ──

console.log("1. inputKeyToBytes");

assert("1a. ctrl-c → \\x03", inputKeyToBytes("ctrl-c" as BridgeInputKey), "\x03",
  "ctrl-c must send the ETX character to interrupt the PTY process");

assert("1b. escape → \\x1b", inputKeyToBytes("escape" as BridgeInputKey), "\x1b");

assert("1c. key '1' includes CR", inputKeyToBytes("1" as BridgeInputKey), "1\r",
  "Permission keys auto-send Enter for convenience");

assert("1d. key '2' includes CR", inputKeyToBytes("2" as BridgeInputKey), "2\r");

assert("1e. key '3' includes CR", inputKeyToBytes("3" as BridgeInputKey), "3\r");

assert("1f. enter → \\r", inputKeyToBytes("enter" as BridgeInputKey), "\r");

// ── Bug 4: Recovery timer concepts ──
// The recovery timer itself requires a real PTY to test, but we can
// verify the stateless detection primitives used by tickRecovery().

console.log("\n2. Recovery-timer screen detection (stateless, no sticky history)");

// 2a. Post-timeout clean prompt screen
{
  console.log("2a. Clean prompt after timeout recovery");
  const lines = [
    "user@host:~/project$ ",
    "",
  ];
  const snap = makeSnapshot(lines);
  const sp = detectSpinner(snap);
  const pp = detectPermissionPrompt(snap);
  assert("2a. spinner false on clean prompt", sp, false);
  assert("2a. permission false on clean prompt", pp.detected, false);
}

// 2b. Post-timeout with residual "thinking" text
{
  console.log("2b. Stale thinking text still detectable");
  const lines = [
    "  ⎿  thinking...",
    "user@host:~/project$ ",
  ];
  const snap = makeSnapshot(lines);
  const sp = detectSpinner(snap);
  assert("2b. thinking in bottom area detected", sp, true,
    "Recovery should NOT transition to idle while spinner visible");
}

// 2c. Post-timeout with permission menu appearing
{
  console.log("2c. Permission menu after timeout");
  const lines = [
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again",
    "  3. No",
  ];
  const snap = makeSnapshot(lines);
  const pp = detectPermissionPrompt(snap);
  assert("2c. permission detected in recovery", pp.detected, true,
    "Recovery should surface permission menu instead of transitioning to idle");
}

// 2d. Screen with only shell prompt, no spinner, no permission
{
  console.log("2d. Pure shell prompt — ready for idle");
  const lines = [
    "~/project$ ",
  ];
  const snap = makeSnapshot(lines);
  const sp = detectSpinner(snap);
  const pp = detectPermissionPrompt(snap);
  assert("2d. spinner false", sp, false);
  assert("2d. permission false", pp.detected, false,
    "This is the exact condition where tickRecovery should set state=idle");
}

// 2e. Screen with "Esc to interrupt" but no spinner/permission
{
  console.log("2e. 'Esc to interrupt' status line without active spinner");
  const lines = [
    "  Esc to interrupt",
    "~/project$ ",
  ];
  const snap = makeSnapshot(lines);
  // detectSpinner checks for "esc to interrupt" as a spinner indicator
  const sp = detectSpinner(snap);
  assert("2e. esc-to-interrupt IS spinner", sp, true,
    "'Esc to interrupt' in bottom area should keep spinner=true");
}

// 2f. detectSpinner on spinner character ("-" hanging)
{
  console.log("2f. Hanging spinner char '-' at end of last line");
  const lines = [
    "  -",
  ];
  const snap = makeSnapshot(lines);
  const sp = detectSpinner(snap);
  assert("2f. hanging '-' detected as spinner", sp, true);
}

// 2g. detectSpinner on clean text line (not spinner)
{
  console.log("2g. Normal text output — not spinner");
  const lines = [
    "Build completed successfully.",
  ];
  const snap = makeSnapshot(lines);
  const sp = detectSpinner(snap);
  assert("2g. normal text NOT spinner", sp, false);
}

// ── Screen-stability completion detection ──

{
  console.log("\n3. CompletionDetector.check() — screen-stability-based completion");

  // Dynamic import since CompletionDetector is in the bridge module
  const { CompletionDetector, DEFAULT_COMPLETION_OPTIONS } =
    await import("../src/bridge/completion_detector.js");
  const detector = new CompletionDetector();

  const baseTime = 1_000_000;
  const baseInput = {
    startedAt: baseTime,
    submittedAt: baseTime + 500,
    lastOutputAt: baseTime + 500,
    deadlineAt: baseTime + 30_000,
    seenDoneMarker: false,
    effectiveOutputSeen: true,
    inputBoxStillContainsPrompt: false,
    snapshot: makeSnapshot(["Build completed successfully."]),
    screenStableSince: baseTime + 10_000,
    lastMeaningfulOutputAt: baseTime + 10_000,
    lastSpinnerSeenAt: 0,
  };

  // 3a. All conditions met → completed
  {
    console.log("3a. All screen-stability conditions met → completed");
    const input = { ...baseInput, now: baseTime + 15_000 };
    const result = detector.check(input);
    assert("3a. completed", result?.status ?? "undefined", "completed",
      "Screen stable 5s, quiet 5s after meaningful output, no spinner");
  }

  // 3b. Screen not stable long enough → keep waiting
  {
    console.log("3b. Screen not stable long enough → undefined");
    const input = {
      ...baseInput,
      now: baseTime + 10_500,  // only 500ms stable
      screenStableSince: baseTime + 10_000,
    };
    const result = detector.check(input);
    assert("3b. still waiting", result, undefined as unknown,
      "screenStableMs=1500, only 500ms elapsed → keep waiting");
  }

  // 3c. Insufficient quiet after meaningful output → keep waiting
  {
    console.log("3c. Not quiet long enough after meaningful output → undefined");
    const input = {
      ...baseInput,
      now: baseTime + 11_000,
      lastMeaningfulOutputAt: baseTime + 10_000,  // only 1s quiet
      screenStableSince: baseTime + 10_000,
    };
    const result = detector.check(input);
    assert("3c. still waiting", result, undefined as unknown,
      "fastQuietMs=2000, only 1000ms elapsed → keep waiting");
  }

  // 3d. Spinner detected → keep waiting
  {
    console.log("3d. Spinner visible → undefined");
    const spinnerSnap = makeSnapshot(["⠋ Thinking..."]);
    const input = {
      ...baseInput,
      now: baseTime + 15_000,
      screenStableSince: baseTime + 13_000,
      snapshot: spinnerSnap,
    };
    const result = detector.check(input);
    assert("3d. spinner blocks completion", result, undefined as unknown,
      "spinner detected → keep waiting");
  }

  // 3e. Permission prompt → needs_permission (checked before completion)
  {
    console.log("3e. Permission prompt → needs_permission (takes priority)");
    const permSnap = makeSnapshot([
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. Yes, and don't ask again",
      "  3. No",
    ]);
    const input = { ...baseInput, now: baseTime + 15_000, snapshot: permSnap };
    const result = detector.check(input);
    assert("3e. needs_permission", result?.status ?? "undefined", "needs_permission");
    assert("3e. suggested keys", result?.suggested_keys, ["1", "2", "3"]);
  }

  // 3f. Done marker → completed (checked first)
  {
    console.log("3f. Done marker → completed immediately");
    const input = {
      ...baseInput,
      now: baseTime + 500,  // early, before stability
      seenDoneMarker: true,
    };
    const result = detector.check(input);
    assert("3f. done marker bypasses stability", result?.status ?? "undefined", "completed");
  }

  // 3g. Deadline → detection_failed with reason
  {
    console.log("3g. Deadline reached → detection_failed with detailed reason");
    const input = {
      ...baseInput,
      now: baseTime + 30_000,  // at deadline
      deadlineAt: baseTime + 30_000,
      screenStableSince: baseTime + 29_000,  // only 1s stable
      lastMeaningfulOutputAt: baseTime + 29_000,  // only 1s quiet
      lastSpinnerSeenAt: baseTime + 29_500,  // 500ms since last spinner
    };
    const result = detector.check(input);
    assert("3g. detection_failed", result?.status ?? "undefined", "detection_failed");
    assert("3g. has error message", typeof result?.error === "string" && result!.error!.length > 0, true,
      `error: ${result?.error ?? "MISSING"}`);
  }

  // 3h. Not submitted — input box still contains prompt (no quietMs fallback)
  {
    console.log("3h. Not submitted — input box contains prompt, no effective output");
    const promptSnap = makeSnapshot(["user@host:~/project$ echo hello"]);
    const input = {
      ...baseInput,
      now: baseTime + 10_000,
      effectiveOutputSeen: false,
      inputBoxStillContainsPrompt: true,
      snapshot: promptSnap,
      submittedAt: baseTime + 500,
    };
    const result = detector.check(input);
    assert("3h. not_submitted", result?.status ?? "undefined", "not_submitted");
  }

  // 3i. postSpinnerQuietMs not met → keep waiting
  {
    console.log("3i. postSpinnerQuietMs not met → undefined");
    const cleanSnap = makeSnapshot(["Build completed."]);
    const input = {
      ...baseInput,
      now: baseTime + 15_000,
      screenStableSince: baseTime + 14_000,
      lastMeaningfulOutputAt: baseTime + 14_000,
      lastSpinnerSeenAt: baseTime + 14_500,  // only 500ms since spinner
      snapshot: cleanSnap,
    };
    const result = detector.check(input);
    assert("3i. post-spinner quiet blocks", result, undefined as unknown,
      "postSpinnerQuietMs=2000, only 500ms elapsed → keep waiting");
  }

  // 3j. minRunMs not met → keep waiting
  {
    console.log("3j. minRunMs not met → undefined");
    const input = {
      ...baseInput,
      now: baseTime + 500,  // only 500ms since start
      startedAt: baseTime,
      screenStableSince: baseTime + 400,
      lastMeaningfulOutputAt: baseTime + 400,
      lastSpinnerSeenAt: 0,
    };
    const result = detector.check(input);
    assert("3j. minRunMs blocks", result, undefined as unknown,
      "minRunMs=1500, only 500ms elapsed → keep waiting");
  }
}

// ── Summary ──

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
