import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CodexLeadService } from "../src/services/codex_lead_service.js";
import type { PermissionRequestRecord, TaskRecord } from "../src/types.js";
import { createRuntime } from "../src/orchestrator/runtime.js";
import { appendEvent, nextId, nowIso } from "../src/orchestrator/state_store.js";

const stateRoot = await mkdtemp(path.join(os.tmpdir(), "codex_lead_cc_wait_mode_"));

try {
  const runtime = createRuntime(stateRoot);
  const service = new CodexLeadService(runtime);
  const projectId = "wait-mode-demo";

  await service.setSupervisorState({
    project_id: projectId,
    state: "sleeping",
    reason: "Smoke test waits for worker events.",
  });
  const supervisorState = await service.getSupervisorState({ project_id: projectId });
  assert.equal(supervisorState.state, "sleeping");

  const worker = await service.createWorker({
    project_path: process.cwd(),
    project_id: projectId,
    role: "scout",
  });

  let taskId = "";
  await runtime.store.updateState((state) => {
    state.counters.task += 1;
    taskId = nextId("task", state.counters.task);
    const timestamp = nowIso();
    const paths = runtime.store.taskPaths(taskId);
    const task: TaskRecord = {
      id: taskId,
      worker_id: worker.id,
      role: worker.role,
      project_id: projectId,
      project_path: worker.project_path,
      execution_path: worker.project_path,
      task: "Smoke task completed event.",
      status: "completed",
      depends_on: [],
      blocked_by: [],
      runtime: "claude_cli",
      timeout_sec: 30,
      exit_code: 0,
      summary: "Smoke task completed.",
      log_path: paths.displayLogPath,
      report_path: paths.displayReportPath,
      stdout_path: paths.displayStdoutPath,
      stderr_path: paths.displayStderrPath,
      patch_path: paths.displayPatchPath,
      diff_summary_path: paths.displayDiffSummaryPath,
      worktree_mode: "readonly",
      report_type: "scout",
      created_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      updated_at: timestamp,
      duration_ms: 1,
    };
    state.tasks[taskId] = task;
    appendEvent(state, {
      type: "heartbeat",
      project_id: projectId,
      task_id: taskId,
      worker_id: worker.id,
      summary: "Worker heartbeat.",
      payload: {},
    });
  });

  let state = await runtime.store.readState();
  assert.equal(Object.keys(state.notifications).length, 0, "heartbeat must not create notifications");

  await runtime.store.updateState((latest) => {
    appendEvent(latest, {
      type: "task_completed",
      project_id: projectId,
      task_id: taskId,
      worker_id: worker.id,
      summary: `Task ${taskId} completed.`,
      payload: { exit_code: 0 },
    });
  });

  await runtime.store.updateState((latest) => {
    latest.counters.permission += 1;
    const requestId = nextId("perm", latest.counters.permission);
    const timestamp = nowIso();
    const request: PermissionRequestRecord = {
      id: requestId,
      project_id: projectId,
      task_id: taskId,
      worker_id: worker.id,
      tool: "Bash",
      action: "pytest tests/test_demo.py -q",
      risk_level: "test",
      reason: "Smoke tester requests test command approval.",
      affected_paths: ["tests/test_demo.py"],
      status: "pending",
      suggested_decision: "allow_for_task",
      choices: ["allow_once", "allow_for_task", "allow_for_project", "deny"],
      created_at: timestamp,
    };
    latest.permission_requests[requestId] = request;
    appendEvent(latest, {
      type: "permission_requested",
      project_id: projectId,
      task_id: taskId,
      worker_id: worker.id,
      summary: "Tester requested pytest approval.",
      payload: request as unknown as Record<string, unknown>,
    });
  });

  const inbox = await service.getInbox({ project_id: projectId, only_unread: true });
  assert.equal(inbox.notifications.length, 2);
  assert.ok(inbox.notifications.some((notification) => notification.type === "task_completed"));
  const permissionNotification = inbox.notifications.find((notification) => notification.type === "permission_requested");
  assert.ok(permissionNotification);
  assert.equal(permissionNotification.priority, "critical");

  const wakePacket = await service.waitForEvents({
    project_id: projectId,
    since_event_id: 0,
    wake_on: ["permission_requested"],
    timeout_sec: 1,
    max_events: 5,
  });
  assert.equal(wakePacket.woke, true);
  assert.equal(wakePacket.wake_reason, "permission_requested");
  assert.equal(wakePacket.priority, "critical");
  assert.ok(!JSON.stringify(wakePacket).includes("raw_log"));

  await service.markNotificationsRead({
    notification_ids: [permissionNotification.notification_id],
  });
  const criticalInbox = await service.getInbox({
    project_id: projectId,
    only_unread: true,
    min_priority: "critical",
  });
  assert.equal(criticalInbox.notifications.length, 0);

  const timeoutPacket = await service.waitForEvents({
    project_id: projectId,
    since_event_id: 999,
    wake_on: ["worker_stalled"],
    timeout_sec: 1,
  });
  assert.equal(timeoutPacket.woke, false);
  assert.equal(timeoutPacket.wake_reason, "timeout");

  await service.setSupervisorState({
    project_id: projectId,
    state: "active",
    reason: "Smoke test verifies active supervisors still receive inbox notifications.",
  });
  await runtime.store.updateState((latest) => {
    appendEvent(latest, {
      type: "task_failed",
      project_id: projectId,
      task_id: taskId,
      worker_id: worker.id,
      summary: `Task ${taskId} failed after supervisor became active.`,
      payload: { error: "synthetic failure" },
    });
  });
  const activeInbox = await service.getInbox({
    project_id: projectId,
    only_unread: true,
    min_priority: "high",
  });
  assert.ok(activeInbox.notifications.some((notification) => notification.type === "task_failed"));

  process.stdout.write("smoke:wait-mode passed\n");
} finally {
  await rm(stateRoot, { recursive: true, force: true });
}
