#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { loadClaudeRuntimeEnvFileIntoProcess } from "../claude/claude_runtime_env.js";
import { startClaudeCli } from "../claude/claude_cli_runner.js";
import { writePrestartArtifacts, writeResultArtifacts } from "./artifacts.js";
import { loadSessionFile } from "./session.js";
import { loadTaskFile } from "./task_file.js";
export async function runDelegate(options) {
    // 1. Guard
    if (process.env.CODEX_CLAUDE_CHILD_THREAD !== "1") {
        process.stderr.write("delegate must be invoked from a Codex subagent shell (CODEX_CLAUDE_CHILD_THREAD=1).\n");
        process.exitCode = 1;
        throw new Error("delegate must be invoked from a Codex subagent shell. Set CODEX_CLAUDE_CHILD_THREAD=1.");
    }
    log("delegate started");
    log(`  task_file: ${options.taskFile}`);
    log(`  session_file: ${options.sessionFile}`);
    log(`  timeout_sec: ${options.timeoutSec}`);
    // 2. Load session
    const session = await loadSessionFile(options.sessionFile);
    log(`session loaded (project: ${session.project_path})`);
    // 3. Load Claude runtime env
    loadClaudeRuntimeEnvFileIntoProcess(session.claude_env_file);
    log("claude env loaded");
    // 4. Load and validate TaskFile
    const rawTaskFile = await readFile(options.taskFile, "utf8");
    const taskFile = await loadTaskFile(options.taskFile);
    log(`task loaded (id: ${taskFile.task_id}, type: ${taskFile.worker_type})`);
    // 5. Build Claude prompt
    const prompt = buildClaudePrompt(taskFile, rawTaskFile);
    // 6. Write prestart artifacts BEFORE launching Claude
    const artifactDir = writePrestartArtifacts({
        artifactRoot: session.artifact_root,
        taskFile,
        rawTaskFile,
        prompt,
    });
    log(`artifact dir prepared: ${artifactDir}`);
    // 7. Dry-run mode
    if (options.dryRun) {
        log("dry-run: would launch Claude, exiting");
        return dryRunResult(taskFile, session, prompt, artifactDir);
    }
    // 8. Launch Claude Code in real project directory
    log(`launching claude (cwd: ${session.project_path}, timeout: ${options.timeoutSec}s)`);
    const startedAt = Date.now();
    let stdoutChunks = 0;
    let stderrChunks = 0;
    const running = startClaudeCli({
        projectPath: session.project_path,
        task: prompt,
        timeoutSec: options.timeoutSec,
        onStdout(_chunk) {
            stdoutChunks++;
            if (stdoutChunks === 1)
                log("claude stdout started");
        },
        onStderr(_chunk) {
            stderrChunks++;
            if (stderrChunks === 1)
                log("claude stderr started");
        },
    });
    // 9. Wait for Claude to finish
    const result = await running.finished;
    const durationMs = Date.now() - startedAt;
    log(`claude ${result.status} (exit: ${result.exitCode}, duration: ${durationMs}ms, stdout_chunks: ${stdoutChunks}, stderr_chunks: ${stderrChunks})`);
    // 10. Write result artifacts
    const delegateResult = writeResultArtifacts({
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
    });
    log(`delegate complete: ${delegateResult.status}`);
    return delegateResult;
}
// ── Prompt construction ──
function buildClaudePrompt(taskFile, rawTaskFile) {
    const header = taskFile.worker_type === "readonly"
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
// ── CLI entry ──
export async function delegateMain(rawArgs) {
    let taskFile;
    let sessionFile;
    let timeoutSec = 300;
    let dryRun = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--task-file") {
            if (!next)
                throw new Error("--task-file requires a value.");
            taskFile = next;
            i++;
        }
        else if (arg === "--session-file") {
            if (!next)
                throw new Error("--session-file requires a value.");
            sessionFile = next;
            i++;
        }
        else if (arg === "--timeout-sec") {
            if (!next)
                throw new Error("--timeout-sec requires a value.");
            timeoutSec = Number(next);
            if (!Number.isInteger(timeoutSec) || timeoutSec <= 0) {
                throw new Error("--timeout-sec must be a positive integer.");
            }
            i++;
        }
        else if (arg === "--dry-run") {
            dryRun = true;
        }
        else if (arg === "--help" || arg === "-h") {
            process.stdout.write(delegateHelp());
            return;
        }
        else {
            throw new Error(`Unknown delegate argument: ${arg}`);
        }
    }
    if (!taskFile) {
        taskFile = process.env.CODEX_LEAD_CC_TASK_FILE;
        if (!taskFile)
            throw new Error("--task-file is required.");
    }
    if (!sessionFile) {
        sessionFile = process.env.CODEX_LEAD_CC_SESSION_FILE;
        if (!sessionFile)
            throw new Error("--session-file is required.");
    }
    const result = await runDelegate({ taskFile, sessionFile, timeoutSec, dryRun });
    // stdout: ONLY the compact JSON result
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
function delegateHelp() {
    return `codex_lead_cc delegate — Execute a delegated task via Claude Code

Usage:
  codex_lead_cc delegate --task-file <path> --session-file <path> [--timeout-sec 300] [--dry-run]

This command must be invoked with CODEX_CLAUDE_CHILD_THREAD=1.
`;
}
// ── Progress logging (stderr only, never stdout) ──
function log(message) {
    process.stderr.write(`[delegate] ${message}\n`);
}
// ── Dry run ──
function dryRunResult(taskFile, session, prompt, artifactDir) {
    return {
        task_id: taskFile.task_id,
        worker_type: taskFile.worker_type,
        status: "completed",
        exit_code: 0,
        duration_ms: 0,
        artifact_dir: artifactDir,
        changed_files: [],
        summary: `[dry-run] Would execute Claude Code in: ${session.project_path}\n\nPrompt preview (first 500 chars):\n${prompt.slice(0, 500)}`,
    };
}
//# sourceMappingURL=delegate_runner.js.map