import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SessionFile } from "../types.js";

export async function loadSessionFile(sessionFile: string): Promise<SessionFile> {
  const raw = await readFile(sessionFile, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Session file is not valid JSON: ${sessionFile}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Session file must be a JSON object.");
  }

  const session = parsed as Record<string, unknown>;

  if (session.version !== 1) {
    throw new Error(`Unsupported session file version: ${session.version}`);
  }

  const required = [
    "session_id",
    "project_path",
    "supervisor_home",
    "task_dir",
    "artifact_root",
    "claude_env_file",
  ] as const;

  for (const key of required) {
    if (typeof session[key] !== "string" || !(session[key] as string).trim()) {
      throw new Error(`Session file is missing required field: ${key}`);
    }
  }

  const sessionDir = path.dirname(sessionFile);
  const daemonPid = typeof session.daemon_pid === "number" && Number.isInteger(session.daemon_pid)
    ? session.daemon_pid
    : undefined;

  return {
    version: 1,
    session_id: session.session_id as string,
    project_path: session.project_path as string,
    supervisor_home: session.supervisor_home as string,
    task_dir: session.task_dir as string,
    artifact_root: session.artifact_root as string,
    queue_dir: typeof session.queue_dir === "string" && session.queue_dir.trim()
      ? session.queue_dir
      : path.join(sessionDir, "queue"),
    result_dir: typeof session.result_dir === "string" && session.result_dir.trim()
      ? session.result_dir
      : path.join(sessionDir, "results"),
    claude_env_file: session.claude_env_file as string,
    daemon_pid: daemonPid,
    created_at: (session.created_at as string) ?? new Date(0).toISOString(),
  };
}
