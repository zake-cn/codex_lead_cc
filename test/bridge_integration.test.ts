#!/usr/bin/env npx tsx
/**
 * Bridge integration tests with FakePty.
 *
 * Covers: Bug 3 (busy/ctrl-c) and Bug 4 (stale-state recovery timer).
 * Uses a real CcBridge instance with fake PTY and temp session dirs.
 *
 * Run: npx tsx test/bridge_integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { CcBridge } from "../src/bridge/cc_bridge.js";
import type { ClaudePty } from "../src/bridge/pty.js";
import type { BridgeCommandResult, BridgeStatusPayload, SessionFile } from "../src/types.js";

let passed = 0;
let failed = 0;
const createdDirs: string[] = [];

function assert(label: string, actual: unknown, expected: unknown, detail = ""): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  PASS ${label}`); }
  else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
    if (detail) console.log(`       ${detail}`);
  }
}

// ── Fake PTY ──

class FakePty implements ClaudePty {
  pid = 99999;
  private dataListeners: Array<(chunk: string) => void> = [];
  private exitListeners: Array<(code: number | null, sig?: string) => void> = [];
  writes: string[] = [];
  killed = false;

  write(data: string): void { this.writes.push(data); }
  kill(): void { this.killed = true; }
  onData(fn: (chunk: string) => void): void { this.dataListeners.push(fn); }
  onExit(fn: (code: number | null, sig?: string) => void): void { this.exitListeners.push(fn); }

  emitData(chunk: string): void { for (const fn of this.dataListeners) fn(chunk); }
  emitExit(code = 0): void { for (const fn of this.exitListeners) fn(code, "SIGTERM"); }
}

// ── Helpers ──

function makeSession(sessionDir: string): SessionFile {
  const bridgeDir = path.join(sessionDir, "bridge");
  return {
    version: 2, session_id: "test_" + randomUUID().slice(0, 8),
    project_path: "/tmp/test_project", supervisor_home: sessionDir,
    session_dir: sessionDir, artifact_root: path.join(sessionDir, "artifacts"),
    bridge_dir: bridgeDir,
    bridge_state_file: path.join(bridgeDir, "state.json"),
    claude_env_file: path.join(sessionDir, "claude_env.json"),
    created_at: new Date().toISOString(),
  };
}

function setupSession(): { dir: string; session: SessionFile; sessionFile: string } {
  const dir = path.join(tmpdir(), "cc_br_test_" + randomUUID().slice(0, 8));
  const session = makeSession(dir);
  const sf = path.join(dir, "session.json");
  mkdirSync(dir, { recursive: true });
  mkdirSync(session.bridge_dir, { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "inbox"), { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "streams"), { recursive: true });
  mkdirSync(path.join(session.bridge_dir, "results"), { recursive: true });
  mkdirSync(session.artifact_root, { recursive: true });
  writeFileSync(session.claude_env_file, JSON.stringify({ env: {} }), "utf8");
  writeFileSync(sf, JSON.stringify(session, null, 2), "utf8");
  createdDirs.push(dir);
  return { dir, session, sessionFile: sf };
}

function writeReq(inboxDir: string, req: Record<string, unknown>): string {
  const id = "req_" + randomUUID().slice(0, 8);
  const f = path.join(inboxDir, `${id}.json`);
  writeFileSync(f + ".tmp", JSON.stringify({ ...req, request_id: id, created_at: new Date().toISOString() }, null, 2), "utf8");
  renameSync(f + ".tmp", f);
  return id;
}

async function waitResult(resultsDir: string, id: string, ms = 4000): Promise<BridgeCommandResult> {
  const rf = path.join(resultsDir, `${id}.json`);
  const dl = Date.now() + ms;
  while (Date.now() < dl) { if (existsSync(rf)) return JSON.parse(readFileSync(rf, "utf8")); await sleep(50); }
  throw new Error(`Timeout: ${id}`);
}

function readState(sf: string): BridgeStatusPayload { return JSON.parse(readFileSync(sf, "utf8")); }

async function waitState(sf: string, target: string, ms = 4000): Promise<BridgeStatusPayload> {
  const dl = Date.now() + ms;
  while (Date.now() < dl) { if (existsSync(sf) && readState(sf).status === target) return readState(sf); await sleep(50); }
  const cur = existsSync(sf) ? readState(sf).status : "missing";
  throw new Error(`Timeout state=${target}, current=${cur}`);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──

async function main(): Promise<void> {
  console.log("\n=== Bridge Integration Tests ===\n");

  // ═══════════════════════════════════════════════════════════
  // Part A: Busy protection + ctrl-c bypass (Bug 3)
  // ═══════════════════════════════════════════════════════════
  {
    console.log("A. Busy / ctrl-c protection");
    const { dir, session, sessionFile } = setupSession();
    const pty = new FakePty();
    const bridge = new CcBridge(sessionFile, session, pty);
    bridge.start();

    try {
      // A1: start first send → running
      const r1 = writeReq(path.join(session.bridge_dir, "inbox"), { type: "send", prompt: "hello", timeout_sec: 30 });
      await sleep(200);
      await waitState(session.bridge_state_file, "running");

      // A2: second send → busy
      const r2 = writeReq(path.join(session.bridge_dir, "inbox"), { type: "send", prompt: "blocked", timeout_sec: 30 });
      assert("A2. second send → busy", (await waitResult(path.join(session.bridge_dir, "results"), r2)).status, "busy");

      // A3: normal input → busy
      const r3 = writeReq(path.join(session.bridge_dir, "inbox"), { type: "input", key: "1", timeout_sec: 30 });
      assert("A3. input key=1 → busy", (await waitResult(path.join(session.bridge_dir, "results"), r3)).status, "busy");

      // A4: ctrl-c → accepted
      const rc = writeReq(path.join(session.bridge_dir, "inbox"), { type: "input", key: "ctrl-c", timeout_sec: 30 });
      assert("A4. ctrl-c → completed", (await waitResult(path.join(session.bridge_dir, "results"), rc)).status, "completed");

      // A5: original send → interrupted
      assert("A5. original → interrupted", (await waitResult(path.join(session.bridge_dir, "results"), r1)).status, "interrupted");

      // A6: after interrupt, new send works
      const r4 = writeReq(path.join(session.bridge_dir, "inbox"), { type: "send", prompt: "recovery", timeout_sec: 30 });
      await waitState(session.bridge_state_file, "running");
      assert("A6. post-interrupt send accepted", readState(session.bridge_state_file).status, "running");

    } finally {
      bridge.disposeForTest();
      await sleep(50);
      rmSync(dir, { recursive: true, force: true });
      assert("A cleanup: dir removed", existsSync(dir), false);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Part B: Timeout → recovery timer → idle (Bug 4)
  // ═══════════════════════════════════════════════════════════
  {
    console.log("\nB. Recovery timer (timeout → idle)");
    const { dir, session, sessionFile } = setupSession();
    const pty = new FakePty();
    const bridge = new CcBridge(sessionFile, session, pty);
    bridge.start();

    try {
      // B1: request with timeout_sec=1
      const rt = writeReq(path.join(session.bridge_dir, "inbox"), { type: "send", prompt: "quick", timeout_sec: 1 });
      await sleep(200);
      await waitState(session.bridge_state_file, "running");

      // B2: wait for timeout (~1s deadline + completion check)
      const tr = await waitResult(path.join(session.bridge_dir, "results"), rt, 4000);
      assert("B2. timeout result = timeout", tr.status, "timeout");

      // B2-bis: re-read result file — must still say timeout
      assert("B2-bis. result file NOT overwritten",
        (JSON.parse(readFileSync(path.join(session.bridge_dir, "results", `${rt}.json`), "utf8")) as BridgeCommandResult).status,
        "timeout");

      // B3: state = timeout
      assert("B3. persistent state = timeout", readState(session.bridge_state_file).status, "timeout");

      // B4: tickRecovery before quiet — stays timeout
      bridge.tickRecovery(Date.now());
      assert("B4. stays timeout before quiet", readState(session.bridge_state_file).status, "timeout");

      // B5: emit clean prompt + tick with future time → idle
      pty.emitData("user@host:~/project$ ");
      bridge.tickRecovery(Date.now() + 3000); // past quietMs=2500
      const st5 = readState(session.bridge_state_file);
      assert("B5. recovery → idle", st5.status, "idle");
      assert("B5. spinner=false", st5.spinner_detected, false);

      // B6: new active request → recovery must NOT overwrite running
      const r6 = writeReq(path.join(session.bridge_dir, "inbox"), { type: "send", prompt: "x", timeout_sec: 30 });
      await sleep(200);
      await waitState(session.bridge_state_file, "running");
      bridge.tickRecovery(Date.now() + 5000);
      assert("B6. tickRecovery does NOT overwrite running", readState(session.bridge_state_file).status, "running");

      // B7: needs_permission guard — simulate compact permission screen
      // (Bug 1 regression: "2.Yes" without space after dot)
      pty.emitData(
        "Do you want to proceed?\n" +
        "❯ 1. Yes\n" +
        "2.Yes, and don't ask again\n" +
        "3. No",
      );
      await waitState(session.bridge_state_file, "needs_permission", 3000);
      bridge.tickRecovery(Date.now() + 5000);
      assert("B7. tickRecovery does NOT overwrite needs_permission",
        readState(session.bridge_state_file).status, "needs_permission");

      // B8: exited guard — PTY exit sets state=exited, tickRecovery no-op
      pty.emitExit(0);
      await waitState(session.bridge_state_file, "exited", 2000);
      bridge.tickRecovery(Date.now() + 5000);
      assert("B8. tickRecovery does NOT overwrite exited",
        readState(session.bridge_state_file).status, "exited");

    } finally {
      bridge.disposeForTest();
      await sleep(50);
      rmSync(dir, { recursive: true, force: true });
      assert("B cleanup: dir removed", existsSync(dir), false);
    }
  }

  // Verify no leftover test dirs
  for (const d of createdDirs) {
    assert(`Cleanup: ${path.basename(d)} removed`, existsSync(d), false);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error("Harness error:", err); process.exit(1); });
