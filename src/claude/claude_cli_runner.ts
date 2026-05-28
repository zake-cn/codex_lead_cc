import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

import type {
  ClaudeCliRunOptions,
  ClaudeCliRunResult,
  FinalTaskStatus,
  RunningClaudeCli,
} from "../types.js";

const CLAUDE_NOT_FOUND_MESSAGE =
  "Claude Code CLI was not found. Install Claude Code, make sure `claude` is on PATH, and log in before running cc_run_task.";

export async function runClaudeCli(
  options: ClaudeCliRunOptions,
): Promise<ClaudeCliRunResult> {
  const running = startClaudeCli(options);
  return running.finished;
}

export function startClaudeCli(
  options: ClaudeCliRunOptions & {
    logPath?: string;
    stdoutPath?: string;
    stderrPath?: string;
  },
): RunningClaudeCli {
  const startedAt = new Date();
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let settled = false;
  let timedOut = false;
  let stopped = false;
  let forceKillTimer: NodeJS.Timeout | undefined;
  let logStream: WriteStream | undefined;
  let stdoutStream: WriteStream | undefined;
  let stderrStream: WriteStream | undefined;

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
  } catch (error) {
    stderr = appendLine(stderr, `Failed to open Claude output log files: ${messageFrom(error)}`);
  }

  const finished = new Promise<ClaudeCliRunResult>((resolve) => {
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      appendStderr(
        `Task timed out after ${options.timeoutSec} seconds. Sent SIGTERM to Claude Code CLI.`,
      );
      terminateChildProcess(child.pid, "SIGTERM");

      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          appendStderr("Claude Code CLI did not exit after SIGTERM. Sent SIGKILL.");
          terminateChildProcess(child.pid, "SIGKILL");
        }
      }, 5_000);
    }, options.timeoutSec * 1_000);

    const finish = async (
      result: Omit<ClaudeCliRunResult, "startedAt" | "finishedAt" | "durationMs" | "pid">,
    ) => {
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

    child.stdout?.on("data", (chunk: string) => {
      appendStdout(chunk);
    });

    child.stderr?.on("data", (chunk: string) => {
      appendStderr(chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
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

  function stop(reason?: string): void {
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

  function appendStdout(chunk: string): void {
    stdout += chunk;
    stdoutStream?.write(chunk);
    logStream?.write(chunkWithPrefix("stdout", chunk));
  }

  function appendStderr(chunk: string): void {
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

function openLogStreams(paths: {
  logPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
}): {
  logStream?: WriteStream;
  stdoutStream?: WriteStream;
  stderrStream?: WriteStream;
} {
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

async function closeLogStreams(streams: Array<WriteStream | undefined>): Promise<void> {
  await Promise.all(
    streams
      .filter((stream): stream is WriteStream => Boolean(stream))
      .map(
        (stream) =>
          new Promise<void>((resolve) => {
            stream.end(resolve);
          }),
      ),
  );
}

function determineStatus(args: {
  timedOut: boolean;
  stopped: boolean;
  exitCode: number | null;
}): FinalTaskStatus {
  if (args.timedOut) {
    return "timeout";
  }
  if (args.stopped) {
    return "stopped";
  }
  return args.exitCode === 0 ? "completed" : "failed";
}

function chunkWithPrefix(channel: "stdout" | "stderr", chunk: string): string {
  return chunk
    .split(/(?<=\n)/)
    .filter((line) => line.length > 0)
    .map((line) => `[${new Date().toISOString()}] ${channel}: ${line}`)
    .join("");
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function terminateChildProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) {
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return;
    }
    try {
      process.kill(pid, signal);
    } catch (fallbackError) {
      if (!isNodeError(fallbackError) || fallbackError.code !== "ESRCH") {
        throw fallbackError;
      }
    }
  }
}

function appendLine(existing: string, line: string): string {
  if (!existing.trim()) {
    return line;
  }
  return `${existing.replace(/\s+$/, "")}\n${line}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
