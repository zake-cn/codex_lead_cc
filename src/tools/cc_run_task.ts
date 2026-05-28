import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { runClaudeCli } from "../claude/claude_cli_runner.js";
import { buildReport } from "../report/build_report.js";
import type { CcRunTaskInput, CcRunTaskReport } from "../types.js";

const DEFAULT_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 3_600;

export async function ccRunTask(input: CcRunTaskInput): Promise<CcRunTaskReport> {
  const normalized = await normalizeInput(input);
  const result = await runClaudeCli({
    projectPath: normalized.projectPath,
    task: normalized.task,
    timeoutSec: normalized.timeoutSec,
  });

  const report = buildReport({
    task: normalized.task,
    projectPath: normalized.projectPath,
    result,
  });

  await writeTaskLog(report);
  return report;
}

async function normalizeInput(input: CcRunTaskInput): Promise<{
  projectPath: string;
  task: string;
  timeoutSec: number;
}> {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be a JSON object.");
  }

  if (!input.task || typeof input.task !== "string") {
    throw new Error("`task` is required and must be a non-empty string.");
  }

  if (!input.project_path || typeof input.project_path !== "string") {
    throw new Error("`project_path` is required and must be a non-empty string.");
  }

  const projectPath = path.resolve(input.project_path);
  const projectStat = await stat(projectPath).catch(() => undefined);
  if (!projectStat?.isDirectory()) {
    throw new Error(`project_path does not exist or is not a directory: ${projectPath}`);
  }

  const timeoutSec = input.timeout_sec ?? DEFAULT_TIMEOUT_SEC;
  if (!Number.isInteger(timeoutSec) || timeoutSec <= 0 || timeoutSec > MAX_TIMEOUT_SEC) {
    throw new Error(`timeout_sec must be an integer between 1 and ${MAX_TIMEOUT_SEC}.`);
  }

  return {
    projectPath,
    task: input.task,
    timeoutSec,
  };
}

async function writeTaskLog(report: CcRunTaskReport): Promise<void> {
  const logRoot = process.env.CODEX_LEAD_CC_LOG_DIR
    ? path.resolve(process.env.CODEX_LEAD_CC_LOG_DIR)
    : path.resolve(process.cwd(), ".codex_lead_cc", "logs");
  const logPath = path.join(logRoot, "tasks.jsonl");

  try {
    await mkdir(logRoot, { recursive: true });
    await writeFile(logPath, `${JSON.stringify(report)}\n`, { flag: "a" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.stderr = appendLine(report.stderr, `Failed to write task log: ${message}`);
  }
}

function appendLine(existing: string, line: string): string {
  if (!existing.trim()) {
    return line;
  }
  return `${existing.replace(/\s+$/, "")}\n${line}`;
}
