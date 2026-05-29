import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CodexLeadService } from "../src/services/codex_lead_service.js";
import { createRuntime } from "../src/orchestrator/runtime.js";
import { mcpToolNamesForExposure } from "../src/mcp/exposure.js";

const compactTools = mcpToolNamesForExposure("compact");
assert.deepEqual(compactTools, ["cc_dispatch", "cc_wait", "cc_inspect", "cc_decide"]);
assert.ok(!compactTools.includes("cc_create_worker"));
assert.ok(!compactTools.includes("cc_assign_task"));

const fullTools = mcpToolNamesForExposure("full");
assert.ok(fullTools.includes("cc_dispatch"));
assert.ok(fullTools.includes("cc_create_worker"));
assert.ok(fullTools.includes("cc_assign_task"));
assert.ok(fullTools.includes("cc_wait_for_events"));
assert.ok(fullTools.includes("cc_admin"));

const stateRoot = await mkdtemp(path.join(os.tmpdir(), "codex_lead_cc_gateway_"));

try {
  const service = new CodexLeadService(createRuntime(stateRoot));
  const projectId = "gateway-smoke";

  const plan = await service.dispatch({
    action: "create_plan",
    project_id: projectId,
    goal: "Smoke gateway plan",
  });
  assert.equal(plan.ok, true);

  const worker = await service.dispatch({
    action: "create_worker",
    project_path: process.cwd(),
    project_id: projectId,
    role: "scout",
  });
  assert.equal(worker.ok, true);
  const workerId = worker.ok ? (worker.data as { id: string }).id : "";

  const task = await service.dispatch({
    action: "assign_task",
    worker_id: workerId,
    task: { goal: "Blocked smoke task; do not start Claude." },
    depends_on: ["task_missing"],
    timeout_sec: 30,
  });
  assert.equal(task.ok, true);
  assert.equal(task.ok ? (task.data as { status: string }).status : "", "blocked");

  const status = await service.inspect({
    action: "get_status",
    project_id: projectId,
  });
  assert.equal(status.ok, true);
  assert.ok(status.ok && Array.isArray((status.data as { workers: unknown[] }).workers));

  const stateDecision = await service.decide({
    action: "set_supervisor_state",
    project_id: projectId,
    state: "sleeping",
    reason: "Gateway smoke waits for events.",
  });
  assert.equal(stateDecision.ok, true);

  const wait = await service.wait({
    project_id: projectId,
    timeout_sec: 1,
  });
  assert.equal(wait.ok, true);
  assert.equal(wait.ok ? (wait.data as { woke: boolean }).woke : true, false);

  const bad = await service.inspect({
    action: "get_report",
    task_id: "task_missing",
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok ? "" : bad.error.code, "TASK_NOT_FOUND");

  process.stdout.write("smoke:gateway passed\n");
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}
