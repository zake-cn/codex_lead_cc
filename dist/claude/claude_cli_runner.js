import { spawn } from "node:child_process";
import { buildClaudeWorkerEnv, getClaudeRuntimeCommand } from "./claude_runtime_env.js";
const CLAUDE_NOT_FOUND_MESSAGE = "Claude Code CLI was not found. Install or configure the configured Claude runtime command before running worker tasks.";
export async function runClaudeCli(options) {
    const running = startClaudeCli(options);
    return running.finished;
}
export function startClaudeCli(options) {
    const startedAt = new Date();
    let stdout = "";
    let stderr = "";
    let exitCode = null;
    let settled = false;
    let timedOut = false;
    let stopped = false;
    let forceKillTimer;
    let child;
    const baseEnv = options.env ?? process.env;
    const runtime = getClaudeRuntimeCommand(baseEnv);
    const workerEnv = buildClaudeWorkerEnv(baseEnv);
    child = spawn(runtime.command, [...runtime.argsPrefix, "-p", options.task], {
        cwd: options.projectPath,
        detached: false,
        env: workerEnv,
        stdio: ["ignore", "pipe", "pipe"],
    });
    const finished = new Promise((resolve) => {
        if (!child) {
            resolve(makeResult("failed", "", "Failed to spawn Claude process.", null, "Failed to spawn Claude process."));
            return;
        }
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            const msg = `Task timed out after ${options.timeoutSec} seconds. Sending SIGTERM.`;
            appendStderr(msg);
            if (child) {
                child.kill("SIGTERM");
                forceKillTimer = setTimeout(() => {
                    if (child && child.exitCode === null && child.signalCode === null) {
                        appendStderr("Claude Code CLI did not exit after SIGTERM. Sending SIGKILL.");
                        child.kill("SIGKILL");
                    }
                }, 5_000);
            }
        }, options.timeoutSec * 1_000);
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeoutTimer);
            if (forceKillTimer)
                clearTimeout(forceKillTimer);
            const finishedAt = new Date();
            resolve({
                ...result,
                pid: child?.pid,
                startedAt,
                finishedAt,
                durationMs: finishedAt.getTime() - startedAt.getTime(),
            });
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            appendStdout(chunk);
            options.onStdout?.(chunk);
        });
        child.stderr?.on("data", (chunk) => {
            appendStderr(chunk);
            options.onStderr?.(chunk);
        });
        child.on("error", (error) => {
            const message = error.code === "ENOENT" ? CLAUDE_NOT_FOUND_MESSAGE : error.message;
            finish(makeResult("failed", stdout, appendLine(stderr, message), null, message));
        });
        child.on("close", (code) => {
            exitCode = code;
            finish(makeResult(determineStatus({ timedOut, stopped, exitCode }), stdout, stderr, exitCode));
        });
    });
    function stop(reason) {
        if (settled || !child)
            return;
        stopped = true;
        const msg = reason ? `Task stopped: ${reason}` : "Task stopped by request.";
        appendStderr(msg);
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
            if (child && child.exitCode === null && child.signalCode === null) {
                appendStderr("Claude Code CLI did not exit after stop request. Sending SIGKILL.");
                child.kill("SIGKILL");
            }
        }, 5_000);
    }
    function appendStdout(chunk) {
        stdout += chunk;
    }
    function appendStderr(chunk) {
        const normalized = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
        stderr += normalized;
    }
    return {
        pid: child?.pid,
        finished,
        stop,
    };
}
// ── helpers ──
function makeResult(status, stdout, stderr, exitCode, error) {
    const now = new Date();
    return {
        status,
        stdout,
        stderr,
        exitCode,
        pid: undefined,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        error,
    };
}
function determineStatus(args) {
    if (args.timedOut)
        return "timeout";
    if (args.stopped)
        return "stopped";
    return args.exitCode === 0 ? "completed" : "failed";
}
function appendLine(existing, line) {
    if (!existing.trim())
        return line;
    return `${existing.replace(/\s+$/, "")}\n${line}`;
}
//# sourceMappingURL=claude_cli_runner.js.map