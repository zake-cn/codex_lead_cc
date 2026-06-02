#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { buildFinalClaudeEnv, criticalEnvPresent, getClaudeRuntimeCommand, loadClaudeRuntimeEnvFile, } from "../claude/claude_runtime_env.js";
import { startClaudeCli } from "../claude/claude_cli_runner.js";
import { writePrestartArtifacts, writeResultArtifacts } from "./artifacts.js";
import { loadSessionFile } from "./session.js";
import { loadTaskFile } from "./task_file.js";
export async function runDelegate(options) {
    // 1. Start
    log("delegate started");
    log(`  task_file: ${options.taskFile}`);
    log(`  session_file: ${options.sessionFile}`);
    log(`  timeout_sec: ${options.timeoutSec}`);
    // 2. Load session
    const session = await loadSessionFile(options.sessionFile);
    log(`session loaded (project: ${session.project_path}, supervisor: ${session.supervisor_home})`);
    assertInside(session.task_dir, session.supervisor_home, "task_dir");
    assertInside(session.artifact_root, session.supervisor_home, "artifact_root");
    assertOutside(session.project_path, session.supervisor_home, "project_path");
    if (!isInside(options.taskFile, session.task_dir)) {
        throw new Error(`TaskFile does not belong to this session.\n` +
            `  task_file: ${options.taskFile}\n  session.task_dir: ${session.task_dir}`);
    }
    // 3. EXPLICIT: load Claude env from file (no process.env mutation)
    const loadedClaudeEnv = loadClaudeRuntimeEnvFile(session.claude_env_file);
    if (loadedClaudeEnv.loaded) {
        log(`claude env loaded: ${loadedClaudeEnv.env_names.length} vars`);
    }
    else {
        log(`WARNING: claude env NOT loaded from ${session.claude_env_file}`);
        for (const w of loadedClaudeEnv.warnings)
            log(`  env warning: ${w}`);
    }
    // 4. Load and validate TaskFile
    const rawTaskFile = await readFile(options.taskFile, "utf8");
    const taskFile = await loadTaskFile(options.taskFile);
    log(`task loaded (id: ${taskFile.task_id}, type: ${taskFile.worker_type})`);
    // 5. Build Claude prompt
    const prompt = buildClaudePrompt(taskFile, rawTaskFile);
    // 6. Write prestart artifacts
    const artifactDir = writePrestartArtifacts({
        artifactRoot: session.artifact_root,
        taskFile,
        rawTaskFile,
        prompt,
    });
    log(`artifact dir prepared: ${artifactDir}`);
    // 6a. Build FINAL Claude env explicitly (loadedEnv overrides baseEnv)
    const finalClaudeEnv = buildFinalClaudeEnv({
        baseEnv: process.env,
        loadedEnv: loadedClaudeEnv.env,
    });
    // 6b. Write claude_env_applied.json diagnostic (names only, NO values)
    const runtime = getClaudeRuntimeCommand(finalClaudeEnv);
    const critical = criticalEnvPresent(loadedClaudeEnv.env);
    const hasProxy = Object.entries(critical)
        .filter(([k]) => /proxy/i.test(k))
        .some(([, v]) => v === true);
    writeEnvDiagnostic(artifactDir, {
        env_file: loadedClaudeEnv.env_file ?? "(none)",
        loaded: loadedClaudeEnv.loaded,
        env_names: loadedClaudeEnv.env_names,
        critical_env_present: critical,
        command: runtime.command,
        args_prefix_length: runtime.argsPrefix.length,
        project_path: session.project_path,
        proxy_present: hasProxy,
    });
    if (!loadedClaudeEnv.loaded) {
        log("WARNING: proceeding without Claude env — Claude may lack auth/proxy config");
    }
    const missingCritical = Object.entries(critical).filter(([, v]) => !v).map(([k]) => k);
    if (missingCritical.length > 0) {
        log(`WARNING: missing critical env vars: ${missingCritical.join(", ")}`);
    }
    // 7. Dry-run
    if (options.dryRun) {
        log("dry-run: would launch Claude, exiting");
        return dryRunResult(taskFile, session, prompt, artifactDir, loadedClaudeEnv.loaded, missingCritical);
    }
    // 8. Launch Claude — pass env EXPLICITLY
    log(`launching claude (cwd: ${session.project_path}, cmd: ${runtime.command}, timeout: ${options.timeoutSec}s)`);
    const startedAt = Date.now();
    let stdoutChunks = 0, stderrChunks = 0;
    const running = startClaudeCli({
        projectPath: session.project_path,
        task: prompt,
        timeoutSec: options.timeoutSec,
        env: finalClaudeEnv,
        onStdout(_chunk) { stdoutChunks++; if (stdoutChunks === 1)
            log("claude stdout started"); },
        onStderr(_chunk) { stderrChunks++; if (stderrChunks === 1)
            log("claude stderr started"); },
    });
    // 9. Wait
    const result = await running.finished;
    const durationMs = Date.now() - startedAt;
    log(`claude ${result.status} (exit: ${result.exitCode}, duration: ${durationMs}ms)`);
    // 10. Result artifacts
    const delegateResult = writeResultArtifacts({
        artifactRoot: session.artifact_root,
        taskFile, rawTaskFile, prompt,
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
// ── Prompt ──
function buildClaudePrompt(taskFile, rawTaskFile) {
    const header = taskFile.worker_type === "readonly"
        ? [
            "You are Claude Code executing a delegated codex_lead_cc task.",
            "", "You are running inside the real project directory.",
            "Follow the TaskFile exactly.", "",
            "WorkerType: readonly", "",
            "You may inspect files and run non-mutating inspection commands when useful.",
            "You must not modify files.", "You must not delete files.",
            "You must not invoke nested delegate runs.", "",
            "Return the required report headings exactly.",
        ]
        : [
            "You are Claude Code executing a delegated codex_lead_cc task.",
            "", "You are running inside the real project directory.",
            "Follow the TaskFile exactly.", "",
            "WorkerType: write", "",
            "You may modify files only inside Allowed Scope.",
            "You must not touch Forbidden Actions.",
            "You must run or explain Verification.",
            "You must not invoke nested delegate runs.", "",
            "Return the required report headings exactly.",
        ];
    return [...header, "", "---", "", rawTaskFile].join("\n");
}
// ── Env diagnostic ──
function writeEnvDiagnostic(artifactDir, info) {
    try {
        writeFileSync(path.join(artifactDir, "claude_env_applied.json"), JSON.stringify(info, null, 2) + "\n", "utf8");
    }
    catch { /* non-fatal */ }
}
// ── CLI ──
export async function delegateMain(rawArgs) {
    if (process.env.CODEX_CLAUDE_CHILD_THREAD !== "1") {
        process.stderr.write("delegate must be invoked from a Codex subagent shell (CODEX_CLAUDE_CHILD_THREAD=1).\n");
        process.exitCode = 1;
        throw new Error("delegate must be invoked from a Codex subagent shell. Set CODEX_CLAUDE_CHILD_THREAD=1.");
    }
    let taskFile;
    let sessionFile;
    let timeoutSec = 300;
    let dryRun = false;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i], next = rawArgs[i + 1];
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
            if (!Number.isInteger(timeoutSec) || timeoutSec <= 0)
                throw new Error("--timeout-sec must be a positive integer.");
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
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
function delegateHelp() {
    return `codex_lead_cc delegate — Execute a delegated task via Claude Code
Usage: codex_lead_cc delegate --task-file <path> --session-file <path> [--timeout-sec 300] [--dry-run]
Must be invoked with CODEX_CLAUDE_CHILD_THREAD=1.
`;
}
// ── Logging ──
function log(message) {
    process.stderr.write(`[delegate] ${message}\n`);
}
// ── Path checks ──
function isInside(child, parent) {
    const c = path.resolve(child), p = path.resolve(parent);
    return c === p || c.startsWith(p + path.sep);
}
function assertInside(child, parent, label) {
    if (!isInside(child, parent))
        throw new Error(`${label} must be inside supervisor_home.\n  ${label}: ${child}\n  supervisor_home: ${parent}`);
}
function assertOutside(child, parent, label) {
    if (isInside(child, parent))
        throw new Error(`${label} must NOT be inside supervisor_home.\n  ${label}: ${child}\n  supervisor_home: ${parent}`);
}
// ── Dry run ──
function dryRunResult(taskFile, session, prompt, artifactDir, envLoaded, missingCritical) {
    const note = envLoaded
        ? (missingCritical.length > 0 ? `WARNING: missing critical env vars: ${missingCritical.join(", ")}` : "env loaded successfully")
        : "WARNING: Claude runtime env file was not loaded — Claude may lack auth/proxy config.";
    return {
        task_id: taskFile.task_id, worker_type: taskFile.worker_type,
        status: "completed", exit_code: 0, duration_ms: 0,
        artifact_dir: artifactDir, changed_files: [],
        summary: `[dry-run] Would execute Claude in: ${session.project_path}\nEnv status: ${note}\n\nPrompt preview (first 500 chars):\n${prompt.slice(0, 500)}`,
    };
}
//# sourceMappingURL=delegate_runner.js.map