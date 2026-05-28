import type {
  CcRunTaskReport,
  ClaudeCliRunResult,
  CommandRunSummary,
  DiffSummary,
  ReviewFinding,
  TaskRecord,
  TaskReport,
} from "../types.js";
import { reportTypeForRole } from "./report_schema.js";

export function buildReport(args: {
  task: string;
  projectPath: string;
  result: ClaudeCliRunResult;
}): CcRunTaskReport {
  return {
    status: args.result.status,
    task: args.task,
    project_path: args.projectPath,
    summary: summarize(args.result),
    stdout: args.result.stdout,
    stderr: args.result.stderr,
    exit_code: args.result.exitCode,
    started_at: args.result.startedAt.toISOString(),
    finished_at: args.result.finishedAt.toISOString(),
  };
}

function summarize(result: ClaudeCliRunResult): string {
  if (result.status === "timeout") {
    return "Claude Code CLI did not finish before the timeout. Partial stdout/stderr were captured.";
  }

  if (result.status === "failed") {
    const stderrFirstLine = firstMeaningfulLine(result.stderr);
    if (stderrFirstLine) {
      return `Claude Code CLI failed: ${stderrFirstLine}`;
    }
    return `Claude Code CLI failed with exit code ${result.exitCode ?? "unknown"}.`;
  }

  const stdoutFirstLine = firstMeaningfulLine(result.stdout);
  if (stdoutFirstLine) {
    return stdoutFirstLine;
  }
  return "Claude Code CLI completed successfully without stdout.";
}

function firstMeaningfulLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export function buildTaskReport(args: {
  task: TaskRecord;
  result?: ClaudeCliRunResult;
  stdout: string;
  stderr: string;
  status?: TaskRecord["status"];
  summary?: string;
  diffSummary?: DiffSummary;
}): TaskReport {
  const status = args.status ?? args.result?.status ?? args.task.status;
  const startedAt = args.result?.startedAt.toISOString() ?? args.task.started_at ?? null;
  const finishedAt = args.result?.finishedAt.toISOString() ?? args.task.finished_at ?? null;
  const durationMs =
    args.result?.durationMs ??
    args.task.duration_ms ??
    durationFromIso(startedAt, finishedAt);

  return {
    report_type: args.task.report_type ?? reportTypeForRole(args.task.role),
    task_id: args.task.id,
    worker_id: args.task.worker_id,
    role: args.task.role,
    status,
    task: args.task.task,
    summary: args.summary ?? summarizeTaskReport(status, args.stdout, args.stderr),
    stdout: args.stdout,
    stderr: args.stderr,
    exit_code: args.result?.exitCode ?? args.task.exit_code,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    log_path: args.task.log_path,
    report_path: args.task.report_path,
    worktree_path: args.task.worktree_path,
    patch_path: args.task.patch_path,
    files_modified: args.diffSummary?.files.map((file) => file.path) ?? args.task.files_modified,
    diff_summary: args.diffSummary,
    ...roleSpecificFields(args.task, args.stdout, args.stderr, args.result?.exitCode ?? args.task.exit_code),
  };
}

export function summarizeTaskReport(
  status: TaskRecord["status"],
  stdout: string,
  stderr: string,
): string {
  if (status === "pending") {
    return "Task is pending and has not started yet.";
  }
  if (status === "blocked") {
    return "Task is blocked by unfinished dependencies.";
  }
  if (status === "ready") {
    return "Task is ready to run when a worker slot is available.";
  }
  if (status === "waiting_permission") {
    return "Task is waiting for supervisor permission.";
  }
  if (status === "running") {
    return "Task is running. Final report is not available yet.";
  }
  if (status === "stopped") {
    return "Task was stopped before completion. Partial output was captured.";
  }
  if (status === "timeout") {
    return "Task timed out before Claude Code finished. Partial output was captured.";
  }
  if (status === "failed") {
    const stderrFirstLine = firstMeaningfulLine(stderr);
    return stderrFirstLine
      ? `Claude Code CLI failed: ${stderrFirstLine}`
      : "Claude Code CLI failed.";
  }
  if (status === "skipped") {
    return "Task was skipped because a dependency did not complete.";
  }

  return firstMeaningfulLine(stdout) ?? "Claude Code CLI completed successfully.";
}

function durationFromIso(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) {
    return null;
  }
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

function roleSpecificFields(
  task: TaskRecord,
  stdout: string,
  stderr: string,
  exitCode: number | null,
): Partial<TaskReport> {
  if (task.role === "tester") {
    return {
      commands_run: [
        {
          command: inferTestCommand(task.task),
          exit_code: exitCode,
          summary: firstMeaningfulLine(stdout) ?? firstMeaningfulLine(stderr) ?? "No test summary captured.",
        },
      ] satisfies CommandRunSummary[],
      test_result: exitCode === 0 ? "passed" : exitCode === null ? "unknown" : "failed",
      failures: exitCode === 0 ? [] : failureLines(stdout, stderr),
    };
  }

  if (task.role === "reviewer") {
    return {
      review_target: task.target_task_id ?? task.patch_path,
      decision: inferReviewDecision(stdout),
      findings: inferFindings(stdout) satisfies ReviewFinding[],
    };
  }

  return {};
}

function inferTestCommand(taskText: string): string {
  const match = taskText.match(
    /(python3? -m unittest[^\n;.]*|uv run pytest[^\n;.]*|pytest[^\n;.]*|npm test[^\n;.]*|pnpm test[^\n;.]*|yarn test[^\n;.]*)/i,
  );
  return match?.[1]?.trim() ?? "test command requested through Claude Code";
}

function failureLines(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /fail|error|exception/i.test(line))
    .slice(0, 10);
}

function inferReviewDecision(stdout: string): "approve" | "request_changes" | "reject" | "unknown" {
  const lower = stdout.toLowerCase();
  if (lower.includes("reject")) {
    return "reject";
  }
  if (lower.includes("request_changes") || lower.includes("request changes")) {
    return "request_changes";
  }
  if (lower.includes("approve")) {
    return "approve";
  }
  return "unknown";
}

function inferFindings(stdout: string): ReviewFinding[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /severity|risk|issue|bug/i.test(line))
    .slice(0, 10);

  return lines.map((line) => ({
    severity: /high|critical/i.test(line) ? "high" : /medium/i.test(line) ? "medium" : "low",
    category: "review",
    description: line.replace(/^[-*]\s+/, ""),
  }));
}
