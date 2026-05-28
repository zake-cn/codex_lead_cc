import type { TaskReport } from "../types.js";

export function buildTestReport(base: TaskReport): TaskReport {
  return {
    ...base,
    report_type: "test",
    test_result: base.test_result ?? (base.exit_code === 0 ? "passed" : "failed"),
    commands_run: base.commands_run ?? [],
    failures: base.failures ?? [],
  };
}
