import type { ReportType, TaskStatus, WorkerRole } from "../types.js";

export const REPORT_TYPES = ["scout", "implementation", "test", "review", "task"] as const;
export const FINAL_TASK_STATUS_SET = new Set<TaskStatus>([
  "completed",
  "failed",
  "timeout",
  "stopped",
  "skipped",
]);

export function reportTypeForRole(role: WorkerRole): ReportType {
  if (role === "implementer") {
    return "implementation";
  }
  if (role === "tester") {
    return "test";
  }
  if (role === "reviewer") {
    return "review";
  }
  if (role === "scout") {
    return "scout";
  }
  return "task";
}
