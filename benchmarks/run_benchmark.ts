import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ccCreatePlan } from "../src/tools/cc_create_plan.js";
import { ccGetMetrics } from "../src/tools/cc_get_metrics.js";
import { ccUpdatePlan } from "../src/tools/cc_update_plan.js";

interface BenchmarkTask {
  benchmark_id: string;
  mode: string;
  goal: string;
  workers: string[];
  success_criteria: string[];
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const tasks = await loadTasks();

  if (!execute) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dry_run",
          message: "Use --execute to create a local Phase 3 plan and collect current metrics.",
          tasks,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const benchmark = tasks.find((task) => task.benchmark_id === "bugfix_csv_escape") ?? tasks[0];
  const [firstRole, ...remainingRoles] = benchmark.workers;
  const plan = await ccCreatePlan({
    project_id: "demo-project",
    goal: benchmark.goal,
    tasks: [
      {
        role: firstRole as "scout" | "implementer" | "tester" | "reviewer",
        goal: `${firstRole} step for ${benchmark.benchmark_id}`,
      },
    ],
  });
  if (remainingRoles.length > 0) {
    await ccUpdatePlan({
      plan_id: plan.plan_id,
      reason: "Benchmark expands the initial scout plan into the full worker chain.",
      add_tasks: remainingRoles.map((role, index) => ({
        role: role as "scout" | "implementer" | "tester" | "reviewer",
        goal: `${role} step for ${benchmark.benchmark_id}`,
        depends_on: [`${plan.plan_id}_step_${String(index + 1).padStart(3, "0")}`],
      })),
    });
  }
  const metrics = await ccGetMetrics({
    project_id: "demo-project",
    plan_id: plan.plan_id,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        benchmark_id: benchmark.benchmark_id,
        mode: "codex_lead_cc",
        plan,
        metrics,
      },
      null,
      2,
    )}\n`,
  );
}

async function loadTasks(): Promise<BenchmarkTask[]> {
  const tasksDir = path.resolve("benchmarks", "tasks");
  const files = (await readdir(tasksDir)).filter((file) => file.endsWith(".json")).sort();
  const tasks: BenchmarkTask[] = [];
  for (const file of files) {
    tasks.push(JSON.parse(await readFile(path.join(tasksDir, file), "utf8")) as BenchmarkTask);
  }
  return tasks;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
