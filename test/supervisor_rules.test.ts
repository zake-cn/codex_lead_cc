#!/usr/bin/env npx tsx
/**
 * Regression checks for generated supervisor command-waiting rules.
 *
 * Run: npx tsx test/supervisor_rules.test.ts
 */

import {
  SUPERVISOR_RULES_VERSION,
  supervisorFiles,
} from "../src/supervisor.js";

let passed = 0;
let failed = 0;

function assertContains(label: string, content: string, expected: string): void {
  if (content.includes(expected)) {
    passed++;
    console.log(`  PASS ${label}`);
    return;
  }
  failed++;
  console.log(`  FAIL ${label}`);
  console.log(`       missing: ${JSON.stringify(expected)}`);
}

console.log("\n=== Supervisor Rules Regression Tests ===\n");

const files = supervisorFiles();
const generatedRules = [files["CLAUDE.md"], files["AGENTS.md"], files["MEMORY.md"]];

for (const [index, content] of generatedRules.entries()) {
  const name = ["CLAUDE.md", "AGENTS.md", "MEMORY.md"][index];
  assertContains(`${name} version 3`, content, "codex_lead_cc_supervisor_rules_version: 3");
  assertContains(`${name} tool-like protocol`, content, "## Tool-Like Waiting Protocol");
  assertContains(
    `${name} waits for footer`,
    content,
    "Do not continue reasoning until the final <<<CODEX_LEAD_CC_STATUS>>> footer appears.",
  );
  assertContains(
    `${name} forbids progress narration`,
    content,
    "Do not send assistant progress messages while the command is still running.",
  );
  assertContains(
    `${name} keeps stream debug-only`,
    content,
    "Only use --stream when the user explicitly asks to debug bridge output.",
  );
  assertContains(
    `${name} forbids status polling`,
    content,
    "Do not use cc-status as a normal waiting loop or to poll Claude Code progress.",
  );
}

assertContains(
  "MEMORY.md current behavior",
  files["MEMORY.md"],
  "Treat cc-send and cc-input like native Codex command execution.",
);

if (SUPERVISOR_RULES_VERSION !== 3) {
  failed++;
  console.log(`  FAIL exported version: expected 3, actual ${SUPERVISOR_RULES_VERSION}`);
} else {
  passed++;
  console.log("  PASS exported version");
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
