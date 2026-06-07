#!/usr/bin/env npx tsx
/**
 * Regression tests for detectPermissionPrompt — covers the ❯ cursor bug.
 *
 * Run: npx tsx test/permission_detection.test.ts
 */

import { detectPermissionPrompt, detectSpinner } from "../src/bridge/completion_detector.js";
import type { TerminalScreenSnapshot } from "../src/bridge/terminal_screen.js";

let passed = 0;
let failed = 0;

function makeSnapshot(bottomLines: string[], extraText = ""): TerminalScreenSnapshot {
  return {
    text: [...bottomLines, extraText].filter(Boolean).join("\n"),
    lines: bottomLines,
    bottom_lines: bottomLines,
    raw_tail: bottomLines.join("\n"),
  };
}

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

// ── Test suite ──

console.log("\n=== Permission Detection Regression Tests ===\n");

// 1. Exact actual Claude Code menu format (❯ cursor)
{
  console.log("1. Actual ❯ cursor permission menu");
  const menu = [
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and always allow access to /home/user/project",
    "  3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("❯ menu detected", result.detected, true,
    "❯ before '1.' — this was the core regression");
  assert("❯ menu suggestedKeys", result.suggestedKeys, ["1", "2", "3"]);
}

// 2. ❯ cursor but no trailing spaces in last line
{
  console.log("2. ❯ cursor with compact menu");
  const menu = [
    "❯ 1. Yes",
    "2. Yes, and don't ask again",
    "3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("compact ❯ menu detected", result.detected, true);
  assert("compact ❯ menu keys", result.suggestedKeys, ["1", "2", "3"]);
}

// 3. Original format (spaces only) — must NOT regress
{
  console.log("3. Original space-indented menu (no regression)");
  const menu = [
    "Do you want to proceed?",
    "  1. Yes",
    "  2. Yes, and don't ask again",
    "  3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("space menu detected", result.detected, true);
  assert("space menu keys", result.suggestedKeys, ["1", "2", "3"]);
}

// 4. Mixed cursor — ❯ only on active, others plain
{
  console.log("4. Mixed cursor (❯ on first, spaces on others)");
  const menu = [
    "❯ 1. Yes",
    "  2. Yes, and don't ask again for sessions",
    "  3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("mixed cursor menu detected", result.detected, true);
  assert("mixed cursor menu keys", result.suggestedKeys, ["1", "2", "3"]);
}

// 5. ▶ cursor (another common TUI cursor)
{
  console.log("5. ▶ cursor (alternate TUI cursor)");
  const menu = [
    "Do you want to proceed?",
    "▶ 1. Yes",
    "  2. Yes, and always allow",
    "  3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("▶ menu detected", result.detected, true);
  assert("▶ menu keys", result.suggestedKeys, ["1", "2", "3"]);
}

// 6. Parenthesized options
{
  console.log("6. Parenthesized options with ❯");
  const menu = [
    "❯ 1) Yes",
    "  2) No",
    "  3) Don't ask again",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("parenthesized ❯ menu detected", result.detected, true);
}

// 7. Not a menu — regular code output with numbers
{
  console.log("7. False positive guard: code output with numbered lines");
  const code = [
    "  1. function foo() {",
    "  2.   return bar();",
    "  3. }",
    "",
  ];
  const snap = makeSnapshot(code);
  const result = detectPermissionPrompt(snap);
  assert("code output NOT detected as menu", result.detected, false,
    "No 'Yes'/'No' in this text, so should not trigger");
}

// 8. Not a menu — only two options
{
  console.log("8. False positive guard: two-option menu");
  const menu = [
    "❯ 1. Yes",
    "  2. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("two-option NOT menu", result.detected, false,
    "Requires 3 options plus Yes/No");
}

// 9. Not a menu — has 123 but no Yes/No
{
  console.log("9. False positive guard: numbered list without permission context");
  const list = [
    "1. Install dependencies",
    "2. Run build",
    "3. Deploy",
  ];
  const snap = makeSnapshot(list);
  const result = detectPermissionPrompt(snap);
  assert("numbered list NOT menu", result.detected, false);
}

// 10. Menu with "wants to run" command pattern
{
  console.log("10. Command permission with ❯");
  const menu = [
    "Claude Code wants to run the following command:",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again",
    "  3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("command permission menu detected", result.detected, true);
}

// 11. Menu where option 2 says "don't ask again" (no explicit "No" needed)
{
  console.log("11. Don't-ask-again variant with ❯");
  const menu = [
    "❯ 1. Proceed",
    "  2. Proceed, and don't ask again",
    "  3. Cancel",
  ];
  const snap = makeSnapshot(menu);
  // This has 123 but "Cancel" is not "No" — however hasDontAskAgain should match
  const result = detectPermissionPrompt(snap);
  assert("dont-ask variant detected", result.detected, true,
    "hasDontAskAgain should match even without hasYes/hasNo");
}

// 12. ❯ cursor with ANSI escape codes mixed in (simulating real PTY)
{
  console.log("12. ❯ menu with interspersed ANSI codes");
  // ANSI codes are stripped by visibleText -> currentBottomText -> stripAnsi
  // So we test post-strip text; the regex runs on clean text.
  const menu = [
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again",
    "  3. No",
    "  Esc to interrupt",   // TUI noise line — present in real output
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("ANSI-stripped ❯ menu detected", result.detected, true,
    "bottom_lines filtering removes shell prompts only, not TUI noise");
}

// 13. Menu at the very bottom of a long output (tests bottom_lines window)
{
  console.log("13. Menu at bottom of long output");
  const longLines = Array.from({ length: 50 }, (_, i) => `output line ${i + 1}`);
  const menuLines = [
    "Do you want to proceed?",
    "❯ 1. Yes",
    "  2. Yes, and don't ask again",
    "  3. No",
    "  Esc to interrupt",
  ];
  const all = [...longLines, ...menuLines];
  const snap: TerminalScreenSnapshot = {
    text: all.join("\n"),
    lines: all,
    bottom_lines: all.slice(-10),
    raw_tail: all.slice(-5).join("\n"),
  };
  const result = detectPermissionPrompt(snap);
  assert("bottom menu detected in long output", result.detected, true,
    `bottom_lines: ${JSON.stringify(snap.bottom_lines.slice(-6))}`);
}

// 14. Bug 1 regression: compact "2.Yes" format (no space after dot)
{
  console.log("14. Compact '2.Yes' format — no space after dot");
  const menu = [
    "Do you want to proceed?",
    "❯ 1. Yes",
    "2.Yes, and don't ask again for /home/user",
    "3. No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("compact 2.Yes menu detected", result.detected, true,
    "\\s* after [.)] allows zero-space compact format");
  assert("compact 2.Yes keys", result.suggestedKeys, ["1", "2", "3"]);
}

// 15. Bug 1 regression: fully compact menu (all dot-prefixed, no spaces)
{
  console.log("15. Fully compact menu (all dot-prefixed, no spaces)");
  const menu = [
    "1.Yes",
    "2.Yes, and don't ask again",
    "3.No",
  ];
  const snap = makeSnapshot(menu);
  const result = detectPermissionPrompt(snap);
  assert("fully compact menu detected", result.detected, true,
    "1.Yes / 2.Yes / 3.No should be detected as permission");
}

// 16. Bug 1 false-positive guard: compact numbers but NOT permission
{
  console.log("16. Compact numbers in code output — NOT permission");
  const code = [
    "1.function init() {",
    "2.return setup();",
    "3.finalize();",
  ];
  const snap = makeSnapshot(code);
  const result = detectPermissionPrompt(snap);
  assert("compact code output NOT menu", result.detected, false,
    "No Yes/No/dont-ask despite compact numbering");
}

// 17. Bug 4: detectSpinner on clean prompt (no spinner visible)
{
  console.log("17. detectSpinner on clean prompt — should be false");
  const prompt = [
    "user@host:~/project$ ",
    "",
  ];
  const snap = makeSnapshot(prompt);
  const spinner = detectSpinner(snap);
  assert("clean prompt NOT spinner", spinner, false,
    "Prompt line should not be detected as spinner");
}

// 18. Bug 4: detectSpinner with \"thinking\" in bottom area
{
  console.log("18. detectSpinner with 'thinking' indicator");
  const thinking = [
    "user@host:~/project$ ",
    "  ⎿  thinking...",
    "",
  ];
  const snap = makeSnapshot(thinking);
  const spinner = detectSpinner(snap);
  assert("thinking detected as spinner", spinner, true,
    "thinking/loading/processing/working should be detected");
}

// 19. Bug 4: detectSpinner with Braille spinner chars
{
  console.log("19. detectSpinner with Braille spinner chars");
  const spinnerLines = [
    "⠋ Working on it...",
    "",
  ];
  const snap = makeSnapshot(spinnerLines);
  const spinner = detectSpinner(snap);
  assert("braille spinner detected", spinner, true,
    "Braille pattern chars should be detected");
}

// ── Summary ──

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
