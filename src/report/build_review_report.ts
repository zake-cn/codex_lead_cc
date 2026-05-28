import type { TaskReport } from "../types.js";

export function buildReviewReport(base: TaskReport): TaskReport {
  return {
    ...base,
    report_type: "review",
    decision: base.decision ?? "unknown",
    findings: base.findings ?? [],
  };
}
