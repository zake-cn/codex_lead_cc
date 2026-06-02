#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { loadClaudeRuntimeEnvFileIntoProcess } from "../claude/claude_runtime_env.js";
import { startClaudeCli } from "../claude/claude_cli_runner.js";
import type { DelegateResult, ParsedTaskFile, SessionFile } from "../types.js";
import { writeArtifacts } from "./artifacts.js";
import { loadSessionFile } from "./session.js";
import { loadTaskFile } from "./task_file.js";

export interface DelegateOptions {
  taskFile: string;
  sessionFile: string;
  timeoutSec: number;
  dryRun: boolean;
}

export async function runDelegate(options: DelegateOptions): Promise<DelegateResult> {
  // 1. Reject direct invocation — must be called from a Codex subagent
  if (process.env.CODEX_CLAUDE_CHILD_THREAD !== "1") {
    process.stderr.write(
      "codex_lead_cc delegate must be invoked from a Codex subagent shell.\n",
    );
    process.exitCode = 1;
    throw new Error(
      "codex_lead_cc delegate must be invoked from a Codex subagent shell.\n" +
        "Set CODEX_CLAUDE_CHILD_THREAD=1 before invoking delegate.",
    );
  }

  // 2. Load session
  const session = await loadSessionFile(options.sessionFile);

  // 3. Load Claude runtime env into process
  loadClaudeRuntimeEnvFileIntoProcess(session.claude_env_file);

  // 4. Load and validate TaskFile
  const rawTaskFile = await readFile(options.taskFile, "utf8");
  const taskFile = await loadTaskFile(options.taskFile);

  // 5. Build Claude prompt
  const prompt = buildClaudePrompt(taskFile, rawTaskFile);

  if (options.dryRun) {
    return dryRunResult(taskFile, session, prompt);
  }

  // 6. Start Claude Code in real project directory
  const startedAt = Date.now();
  const running = startClaudeCli({
    projectPath: session.project_path,
    task: prompt,
    timeoutSec: options.timeoutSec,
  });

  // 7. Wait for Claude to finish
  const result = await running.finished;
  const durationMs = Date.now() - startedAt;

  // 8. Write artifacts
  const artifactDir = writeArtifacts({
    artifactRoot: session.artifact_root,
    taskFile,
    rawTaskFile,
    prompt,
    projectPath: session.project_path,
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    exitCode: result.exitCode,
    durationMs,
    changedFiles: [],
  });

  // 9. Return compact result
  return {
    task_id: taskFile.task_id,
    worker_type: taskFile.worker_type,
    status: result.status,
    exit_code: result.exitCode,
    duration_ms: durationMs,
    artifact_dir: artifactDir,
    changed_files: [],
    summary: result.stdout.slice(0, 2000).trim(),
    error: result.error,
  };
}

// ── Prompt construction ──

function buildClaudePrompt(taskFile: ParsedTaskFile, rawTaskFile: string): string {
  const mode = taskFile.worker_type;

  const header =
    mode === "readonly"
      ? [
          "You are Claude Code executing a delegated codex_lead_cc task.",
          "",
          "You are running inside the real project directory.",
          "Follow the TaskFile exactly.",
          "",
          "WorkerType: readonly",
          "",
          "You may inspect files and run non-mutating inspection commands when useful.",
          "You must not modify files.",
          "You must not delete files.",
          "You must not invoke nested delegate runs.",
          "",
          "Return the required report headings exactly.",
        ]
      : [
          "You are Claude Code executing a delegated codex_lead_cc task.",
          "",
          "You are running inside the real project directory.",
          "Follow the TaskFile exactly.",
          "",
          "WorkerType: write",
          "",
          "You may modify files only inside Allowed Scope.",
          "You must not touch Forbidden Actions.",
          "You must run or explain Verification.",
          "You must not invoke nested delegate runs.",
          "",
          "Return the required report headings exactly.",
        ];

  return [...header, "", "---", "", rawTaskFile].join("\n");
}

// ── CLI entry (called from src/index.ts or standalone) ──

export async function delegateMain(rawArgs: string[]): Promise<void> {
  let taskFile: string | undefined;
  let sessionFile: string | undefined;
  let timeoutSec = 300;
  let dryRun = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === "--task-file") {
      if (!next) throw new Error("--task-file requires a value.");
      taskFile = next;
      i++;
    } else if (arg === "--session-file") {
      if (!next) throw new Error("--session-file requires a value.");
      sessionFile = next;
      i++;
    } else if (arg === "--timeout-sec") {
      if (!next) throw new Error("--timeout-sec requires a value.");
      timeoutSec = Number(next);
      if (!Number.isInteger(timeoutSec) || timeoutSec <= 0) {
        throw new Error("--timeout-sec must be a positive integer.");
      }
      i++;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(delegateHelp());
      return;
    } else {
      throw new Error(`Unknown delegate argument: ${arg}`);
    }
  }

  if (!taskFile) {
    taskFile = process.env.CODEX_LEAD_CC_TASK_FILE;
    if (!taskFile) throw new Error("--task-file is required.");
  }
  if (!sessionFile) {
    sessionFile = process.env.CODEX_LEAD_CC_SESSION_FILE;
    if (!sessionFile) throw new Error("--session-file is required.");
  }

  const result = await runDelegate({ taskFile, sessionFile, timeoutSec, dryRun });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function delegateHelp(): string {
  return `codex_lead_cc delegate — Execute a delegated task via Claude Code

Usage:
  codex_lead_cc delegate --task-file <path> --session-file <path> [--timeout-sec 300] [--dry-run]

This command must be invoked from a Codex subagent shell (CODEX_CLAUDE_CHILD_THREAD=1).
`;
}

// ── Helpers ──

function dryRunResult(
  taskFile: ParsedTaskFile,
  session: SessionFile,
  prompt: string,
): DelegateResult {
  return {
    task_id: taskFile.task_id,
    worker_type: taskFile.worker_type,
    status: "completed",
    exit_code: 0,
    duration_ms: 0,
    artifact_dir: `${session.artifact_root}/${taskFile.task_id}`,
    changed_files: [],
    summary: `[dry-run] Would execute Claude Code in: ${session.project_path}\n\nPrompt preview (first 500 chars):\n${prompt.slice(0, 500)}`,
  };
}
