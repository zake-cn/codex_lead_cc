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

// ── Summary ──

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
