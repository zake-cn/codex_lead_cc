import { readFile } from "node:fs/promises";
import type { ParsedTaskFile, WorkerType } from "../types.js";
import { WORKER_TYPES } from "../types.js";

const REQUIRED_SECTIONS = [
  "Goal",
  "Allowed Scope",
  "Forbidden Actions",
  "Acceptance Criteria",
  "Verification",
  "Report Requirements",
] as const;

export async function loadTaskFile(taskFilePath: string): Promise<ParsedTaskFile> {
  const raw = await readFile(taskFilePath, "utf8");
  return parseTaskFile(raw, taskFilePath);
}

export function parseTaskFile(raw: string, label = "<task-file>"): ParsedTaskFile {
  if (!raw.trim()) {
    throw new Error(`TaskFile is empty: ${label}`);
  }

  const { header, sections } = splitMarkdown(raw);

  const taskId = readKey(header, "TaskId", label);
  const workerType = validateWorkerType(readKey(header, "WorkerType", label), label);

  const parsed: Record<string, string> = {};
  for (const name of REQUIRED_SECTIONS) {
    const content = sections[name];
    if (!content || !content.trim()) {
      throw new Error(`TaskFile is missing required section "## ${name}": ${label}`);
    }
    if (isPlaceholder(content)) {
      throw new Error(`TaskFile section "## ${name}" contains placeholder content: ${label}`);
    }
    parsed[name] = content.trim();
  }

  return {
    task_id: taskId,
    worker_type: workerType,
    goal: parsed["Goal"],
    allowed_scope: parsed["Allowed Scope"],
    forbidden_actions: parsed["Forbidden Actions"],
    acceptance_criteria: parsed["Acceptance Criteria"],
    verification: parsed["Verification"],
    report_requirements: parsed["Report Requirements"],
  };
}

// ── Markdown splitter ──

function splitMarkdown(raw: string): {
  header: string;
  sections: Record<string, string>;
} {
  const lines = raw.split(/\r?\n/);
  const headerLines: string[] = [];
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;

  for (const line of lines) {
    const headingMatch = /^## (.+)$/.exec(line);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
      continue;
    }
    if (currentSection) {
      sections[currentSection].push(line);
    } else {
      headerLines.push(line);
    }
  }

  const result: Record<string, string> = {};
  for (const [name, sectionLines] of Object.entries(sections)) {
    result[name] = sectionLines.join("\n");
  }

  return { header: headerLines.join("\n"), sections: result };
}

function readKey(header: string, key: string, label: string): string {
  for (const line of header.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}:`)) {
      const value = trimmed.slice(key.length + 1).trim();
      if (!value) {
        throw new Error(`TaskFile "${key}" is empty: ${label}`);
      }
      return value;
    }
  }
  throw new Error(`TaskFile is missing "${key}" in header: ${label}`);
}

function validateWorkerType(value: string, label: string): WorkerType {
  if (!WORKER_TYPES.includes(value as WorkerType)) {
    throw new Error(
      `TaskFile WorkerType must be one of: ${WORKER_TYPES.join(", ")}. Got: "${value}". ${label}`,
    );
  }
  return value as WorkerType;
}

function isPlaceholder(content: string): boolean {
  const stripped = content.trim();
  return (
    stripped === "..." ||
    stripped === "<todo>" ||
    stripped === "<TBD>" ||
    stripped === "TODO" ||
    stripped === "TBD" ||
    stripped.startsWith("<placeholder") ||
    stripped.length < 3
  );
}
