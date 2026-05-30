import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
const CLAUDE_NOT_FOUND_MESSAGE = "Claude Code CLI was not found. Install Claude Code, make sure `claude` is on PATH, and log in before running cc_run_task.";
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
    let logStream;
    let stdoutStream;
    let stderrStream;
    const child = spawn("claude", ["-p", options.task], {
        cwd: options.projectPath,
        detached: true,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
    });
    try {
        const streams = openLogStreams({
            logPath: options.logPath,
            stdoutPath: options.stdoutPath,
            stderrPath: options.stderrPath,
        });
        logStream = streams.logStream;
        stdoutStream = streams.stdoutStream;
        stderrStream = streams.stderrStream;
    }
    catch (error) {
        stderr = appendLine(stderr, `Failed to open Claude output log files: ${messageFrom(error)}`);
    }
    const finished = new Promise((resolve) => {
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            appendStderr(`Task timed out after ${options.timeoutSec} seconds. Sent SIGTERM to Claude Code CLI.`);
            terminateChildProcess(child.pid, "SIGTERM");
            forceKillTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    appendStderr("Claude Code CLI did not exit after SIGTERM. Sent SIGKILL.");
                    terminateChildProcess(child.pid, "SIGKILL");
                }
            }, 5_000);
        }, options.timeoutSec * 1_000);
        const finish = async (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutTimer);
            if (forceKillTimer) {
                clearTimeout(forceKillTimer);
            }
            await closeLogStreams([logStream, stdoutStream, stderrStream]);
            const finishedAt = new Date();
            resolve({
                ...result,
                pid: child.pid,
                startedAt,
                finishedAt,
                durationMs: finishedAt.getTime() - startedAt.getTime(),
            });
        };
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            appendStdout(chunk);
        });
        child.stderr?.on("data", (chunk) => {
            appendStderr(chunk);
        });
        child.on("error", (error) => {
            const message = error.code === "ENOENT" ? CLAUDE_NOT_FOUND_MESSAGE : error.message;
            void finish({
                status: "failed",
                stdout,
                stderr: appendLine(stderr, message),
                exitCode: null,
                error: message,
            });
        });
        child.on("close", (code) => {
            exitCode = code;
            void finish({
                status: determineStatus({ timedOut, stopped, exitCode }),
                stdout,
                stderr,
                exitCode,
            });
        });
    });
    function stop(reason) {
        if (settled) {
            return;
        }
        stopped = true;
        appendStderr(reason ? `Task stopped: ${reason}` : "Task stopped by request.");
        terminateChildProcess(child.pid, "SIGTERM");
        forceKillTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
                appendStderr("Claude Code CLI did not exit after stop request. Sent SIGKILL.");
                terminateChildProcess(child.pid, "SIGKILL");
            }
        }, 5_000);
    }
    function appendStdout(chunk) {
        stdout += chunk;
        stdoutStream?.write(chunk);
        logStream?.write(chunkWithPrefix("stdout", chunk));
    }
    function appendStderr(chunk) {
        const normalized = chunk.endsWith("\n") ? chunk : `${chunk}\n`;
        stderr += normalized;
        stderrStream?.write(normalized);
        logStream?.write(chunkWithPrefix("stderr", normalized));
    }
    return {
        pid: child.pid,
        finished,
        stop,
    };
}
function openLogStreams(paths) {
    for (const filePath of [paths.logPath, paths.stdoutPath, paths.stderrPath]) {
        if (filePath) {
            mkdirSync(path.dirname(filePath), { recursive: true });
        }
    }
    return {
        logStream: paths.logPath ? createWriteStream(paths.logPath, { flags: "a" }) : undefined,
        stdoutStream: paths.stdoutPath
            ? createWriteStream(paths.stdoutPath, { flags: "a" })
            : undefined,
        stderrStream: paths.stderrPath
            ? createWriteStream(paths.stderrPath, { flags: "a" })
            : undefined,
    };
}
async function closeLogStreams(streams) {
    await Promise.all(streams
        .filter((stream) => Boolean(stream))
        .map((stream) => new Promise((resolve) => {
        stream.end(resolve);
    })));
}
function determineStatus(args) {
    if (args.timedOut) {
        return "timeout";
    }
    if (args.stopped) {
        return "stopped";
    }
    return args.exitCode === 0 ? "completed" : "failed";
}
function chunkWithPrefix(channel, chunk) {
    return chunk
        .split(/(?<=\n)/)
        .filter((line) => line.length > 0)
        .map((line) => `[${new Date().toISOString()}] ${channel}: ${line}`)
        .join("");
}
function messageFrom(error) {
    return error instanceof Error ? error.message : String(error);
}
function terminateChildProcess(pid, signal) {
    if (!pid) {
        return;
    }
    try {
        process.kill(-pid, signal);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ESRCH") {
            return;
        }
        try {
            process.kill(pid, signal);
        }
        catch (fallbackError) {
            if (!isNodeError(fallbackError) || fallbackError.code !== "ESRCH") {
                throw fallbackError;
            }
        }
    }
}
function appendLine(existing, line) {
    if (!existing.trim()) {
        return line;
    }
    return `${existing.replace(/\s+$/, "")}\n${line}`;
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=claude_cli_runner.js.map