import type { ReportType, WorkerRole } from "../types.js";
export declare const REPORT_TYPES: readonly ["scout", "implementation", "test", "review", "task"];
export declare const FINAL_TASK_STATUS_SET: Set<"pending" | "running" | "stopped" | "blocked" | "ready" | "waiting_permission" | "completed" | "failed" | "timeout" | "skipped">;
export declare function reportTypeForRole(role: WorkerRole): ReportType;
