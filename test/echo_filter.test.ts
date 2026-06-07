#!/usr/bin/env npx tsx
/**
 * Regression tests for input echo filtering (Bug 2).
 *
 * Strict leading-echo boundary: only the continuous input-echo region at
 * the start of output is filtered by prompt text.  Once Claude's actual
 * response body begins, ALL further lines are preserved — even if they
 * happen to match prompt lines exactly.
 *
 * Run: npx tsx test/echo_filter.test.ts
 */

import { cleanFinalText, isInputEcho } from "../src/bridge/cc_bridge.js";

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

function assertContains(
  label: string,
  haystack: string,
  needle: string,
  shouldContain: boolean,
): void {
  const ok = haystack.includes(needle) === shouldContain;
  if (ok) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected ${shouldContain ? "contains" : "no"}: ${JSON.stringify(needle)}`);
    console.log(`       in: ${JSON.stringify(haystack.slice(0, 200))}`);
  }
}

console.log("\n=== Input Echo Filter Regression Tests ===\n");

// ── 1. isInputEcho (utility function, still used for screen detection) ──

console.log("1. isInputEcho");

{
  const prompt = "不要调用工具，只回复 SEQUENTIAL_A_OK";
  assert("1a. single-line echo detected", isInputEcho(prompt, prompt), true);
}
{
  const prompt = "hello";
  const echo = "> hello";
  assert("1b. >-prefix echo detected", isInputEcho(prompt, echo), true);
}
{
  const prompt = "line one\nline two\nline three";
  assert("1c. multi-line line1 echo", isInputEcho(prompt, "line one"), true);
  assert("1d. multi-line line2 echo", isInputEcho(prompt, "line two"), true);
}
{
  const prompt = "不要调用工具，只回复 SEQUENTIAL_A_OK";
  assert("1e. unrelated text NOT echo",
    isInputEcho(prompt, "Claude Code 正在处理..."), false);
}
{
  // Counter-example: short prompt, response contains it as prefix
  const prompt = "hello";
  const response = "hello world, how are you?";
  assert("1f. short prompt NOT echo on longer response",
    isInputEcho(prompt, response), false);
}

// ── 2. cleanFinalText — strict leading-echo boundary ──

console.log("\n2. cleanFinalText — leading-echo removal");

// 2a. Single-line echo at start removed, response body kept
{
  const output = "不要调用工具，只回复 SEQUENTIAL_A_OK\nSEQUENTIAL_A_OK\n\n";
  const result = cleanFinalText(output, "不要调用工具，只回复 SEQUENTIAL_A_OK");
  assertContains("2a. leading echo removed", result, "不要调用工具", false);
  assertContains("2a. response token kept", result, "SEQUENTIAL_A_OK", true);
}

// 2b. Echo with "> " prefix — stripped, response kept
{
  const output = "> 不要调用工具，只回复 SEQUENTIAL_A_OK\nOK\n";
  const result = cleanFinalText(output, "不要调用工具，只回复 SEQUENTIAL_A_OK");
  assertContains("2b. >-prefix echo removed", result, "不要调用工具", false);
  assertContains("2b. response kept", result, "OK", true);
}

// 2c. Multi-line prompt echo at start — removed
{
  const prompt = "line one\nline two\nline three";
  const output = "line one\nline two\nline three\nREAL_OUTPUT\n";
  const result = cleanFinalText(output, prompt);
  assertContains("2c. echo line1 removed", result, "line one", false);
  assertContains("2c. echo line2 removed", result, "line two", false);
  assertContains("2c. response kept", result, "REAL_OUTPUT", true);
}

// 2d. Short prompt "ok" at start — echo removed, body kept
{
  const output = "ok\nsome real output\n";
  const result = cleanFinalText(output, "ok");
  assertContains("2d. echo 'ok' removed", result, "ok", false);
  assertContains("2d. response body kept", result, "some real output", true);
}

// 2e. ANSI-wrapped echo — stripped, response kept
{
  const prompt = "hello world";
  const output = "\x1b[32mhello world\x1b[0m\nactual response\n";
  const result = cleanFinalText(output, prompt);
  assertContains("2e. ANSI echo removed", result, "hello world", false);
  assertContains("2e. response kept", result, "actual response", true);
}

// 2f. Prompt split across wrapped lines — fragments joined, stripped
{
  const prompt = "this is a very long prompt that wraps";
  const output = "this is a very long\nprompt that wraps\nREAL_OUTPUT\n";
  const result = cleanFinalText(output, prompt);
  assertContains("2f. wrapped echo removed", result, "this is a very long", false);
  assertContains("2f. response kept after wrapped echo", result, "REAL_OUTPUT", true);
}

// 2g. Bare ">" prefix lines — skipped, echo still stripped
{
  const prompt = "hello world";
  const output = ">\nhello world\nREAL_OUTPUT\n";
  const result = cleanFinalText(output, prompt);
  assertContains("2g. > fragment skipped, echo removed", result, "hello world", false);
  assertContains("2g. response kept", result, "REAL_OUTPUT", true);
}

// ── 3. STRONG ASSERTION: response body contains exact prompt lines ──

console.log("\n3. Counter-examples — response body must KEEP prompt-like text");

// 3a. The critical strong assertion: Claude repeats/states the prompt
//     text as part of its response body.  These lines MUST be preserved.
//     Only the LEADING echo region (if any) is stripped.
{
  const prompt = "system: do X\nuser: run test";
  const output = "OK, I will run:\nsystem: do X\nuser: run test\n\nTest complete";
  const result = cleanFinalText(output, prompt);
  // "OK, I will run:" is novel content → echo boundary ends before it.
  // Everything after (including the prompt lines) must be kept.
  assertContains("3a. prompt line1 KEPT in response body",
    result, "system: do X", true);
  assertContains("3a. prompt line2 KEPT in response body",
    result, "user: run test", true);
  assertContains("3a. 'OK, I will run' KEPT",
    result, "OK, I will run", true);
  assertContains("3a. 'Test complete' KEPT",
    result, "Test complete", true);
}

// 3b. Response body that coincidentally contains the target token.
//     Only the leading echo (first line matching prompt) is removed.
{
  const prompt = "SEQUENTIAL_A_OK";
  // Simulated: first line "> SEQUENTIAL_A_OK" is the input-box echo,
  // rest is Claude's response.  The token in the response body must stay.
  const output = "> SEQUENTIAL_A_OK\nI'll reply with SEQUENTIAL_A_OK as requested.\nOK\n";
  const result = cleanFinalText(output, prompt);
  assertContains("3b. leading echo >... removed", result, "> SEQUENTIAL_A_OK", false);
  assertContains("3b. response body token KEPT",
    result, "SEQUENTIAL_A_OK", true);
  assertContains("3b. 'I'll reply' KEPT", result, "I'll reply", true);
}

// 3c. Short prompt — Claude response starts with the same word
//     followed by more content.  "ok here is the result..." is novel
//     content (not just echo), so the entire line is kept per the
//     strict leading-echo boundary rule.
{
  const prompt = "ok";
  const output = "ok here is the result of your query\nmore text\n";
  const result = cleanFinalText(output, prompt);
  // The first line "ok here is the result..." has substantial novel
  // content beyond the prompt "ok", so it's NOT in the echo region.
  // The entire line is preserved as Claude's response body.
  assertContains("3c. full response line KEPT (novel content after 'ok')",
    result, "ok here is the result", true);
  assertContains("3c. 'more text' KEPT", result, "more text", true);
}

// 3d. Claude's response repeats the full multi-line prompt verbatim
//     (e.g. quoting back what the user asked).  Must be preserved.
{
  const prompt = "do thing A\ndo thing B";
  const output = "I understand you want me to:\ndo thing A\ndo thing B\n\nProceeding...";
  const result = cleanFinalText(output, prompt);
  assertContains("3d. prompt line1 in body KEPT", result, "do thing A", true);
  assertContains("3d. prompt line2 in body KEPT", result, "do thing B", true);
  assertContains("3d. 'I understand' KEPT", result, "I understand", true);
  assertContains("3d. 'Proceeding' KEPT", result, "Proceeding", true);
}

// 3e. isInputEcho on response body token → must still report false
//     for genuine non-echo response text.
{
  const prompt = "hello";
  const response = "hello! I'd be happy to help you with that task.";
  // isInputEcho is a character-level detector; for short prompts (< 8)
  // it requires EXACT equality after prefix stripping, so this returns false.
  assert("3e. short-prompt response NOT flagged as echo",
    isInputEcho(prompt, response), false);
}

// ── Summary ──

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
