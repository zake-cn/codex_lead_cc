import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { registerProjectSession } from "../src/orchestrator/project_registry.js";
import { createRuntime } from "../src/orchestrator/runtime.js";
import { StateStore } from "../src/orchestrator/state_store.js";
import { CodexLeadService } from "../src/services/codex_lead_service.js";

const wrapperPath = path.resolve("dist/cli/codex_lead_cc.js");
assert.ok(existsSync(wrapperPath), "wrapper must be built before running smoke:isolation");

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "codex_lead_cc_isolation_"));
const projectDir = await mkdtemp(path.join(tempRoot, "project_"));
const configHome = path.join(tempRoot, "config_home");
const supervisorHome = path.join(configHome, "supervisor");
const runtimeHome = path.join(configHome, "runtime");

try {
  const configPath = runWrapper(["config", "path"], projectDir, configHome);
  assert.equal(configPath.status, 0, configPath.stderr);
  assert.equal(configPath.stdout.trim(), path.join(configHome, "config.json"));

  const reset = runWrapper(["config", "reset"], projectDir, configHome);
  assert.equal(reset.status, 0, reset.stderr);
  const resetConfig = JSON.parse(reset.stdout) as Record<string, unknown>;
  assert.equal(resetConfig.supervisor_home, supervisorHome);
  assert.equal(resetConfig.runtime_home, runtimeHome);

  const show = runWrapper(["config", "show"], projectDir, configHome);
  assert.equal(show.status, 0, show.stderr);
  const shownConfig = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(shownConfig.default_mcp_exposure, "compact");
  assert.equal(shownConfig.worker_mode, "caller_directory");

  const dryRun = runWrapper(["--dry-run"], projectDir, configHome);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const launch = JSON.parse(dryRun.stdout) as {
    cwd: string;
    runtime_home: string;
    supervisor_home: string;
    project_id: string;
    session_id: string;
    args: string[];
  };
  assert.equal(launch.cwd, supervisorHome);
  assert.equal(launch.supervisor_home, supervisorHome);
  assert.equal(launch.runtime_home, runtimeHome);
  assert.equal(launch.project_id, "proj_preview");
  assert.equal(launch.session_id, "sup_session_preview");
  assert.ok(!dryRun.stdout.includes(projectDir), "dry-run must not expose the caller project path");

  const store = new StateStore(runtimeHome);
  const session = await registerProjectSession({
    store,
    projectPath: projectDir,
    supervisorHome,
  });
  assert.match(session.project_id, /^proj_\d+$/);
  assert.match(session.session_id, /^sup_session_\d+$/);

  const service = new CodexLeadService(createRuntime(runtimeHome, {
    supervisorSessionId: session.session_id,
  }));
  const worker = await service.createWorker({ role: "scout" });
  const publicWorker = worker as unknown as Record<string, unknown>;
  assert.equal(publicWorker.project_id, session.project_id);
  assert.ok(!("project_path" in publicWorker), "public worker result must not expose project_path");

  const internalWorker = await service.runtime.workers.getWorker(publicWorker.id as string);
  assert.equal(internalWorker.project_path, path.resolve(projectDir));

  const status = await service.getStatus({ worker_id: publicWorker.id as string });
  assert.equal(status.project_id, session.project_id);
  assert.ok(!("project_path" in status), "status result must not expose project_path");

  const plan = await service.dispatch({
    action: "create_plan",
    goal: "Smoke plan should inherit project_id from the active supervisor session.",
  });
  assert.equal(plan.ok, true);
  const state = await store.readState();
  const planId = plan.ok ? (plan.data as { plan_id: string }).plan_id : "";
  assert.equal(state.plans[planId]?.project_id, session.project_id);
  assert.equal(state.projects[session.project_id]?.path, path.resolve(projectDir));

  process.stdout.write("smoke:isolation passed\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function runWrapper(
  args: string[],
  cwd: string,
  configHomePath: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [wrapperPath, ...args], {
    cwd,
    env: {
      ...process.env,
      CODEX_LEAD_CC_HOME: configHomePath,
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
