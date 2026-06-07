import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SUPERVISOR_RULES_VERSION = 3;
export const SUPERVISOR_VERSION_FILE = ".codex_lead_cc_supervisor_version.json";

export interface SupervisorMigrationSummary {
  supervisor_home: string;
  version: number;
  created_files: string[];
  overwritten_files: string[];
  version_file: string;
  stale: boolean;
}

const VERSION_MARKER = `codex_lead_cc_supervisor_rules_version: ${SUPERVISOR_RULES_VERSION}`;

export function ensureSupervisorFiles(supervisorHome: string): SupervisorMigrationSummary {
  mkdirSync(supervisorHome, { recursive: true });
  const files = supervisorFiles();
  const created: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(supervisorHome, name);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, "utf8");
      created.push(filePath);
    }
  }

  const versionPath = path.join(supervisorHome, SUPERVISOR_VERSION_FILE);
  const stale = !hasCurrentVersion(supervisorHome);
  if (stale && allSupervisorFilesCurrent(supervisorHome)) {
    writeSupervisorVersion(supervisorHome);
    return {
      supervisor_home: supervisorHome,
      version: SUPERVISOR_RULES_VERSION,
      created_files: created,
      overwritten_files: [],
      version_file: versionPath,
      stale: false,
    };
  }

  return {
    supervisor_home: supervisorHome,
    version: SUPERVISOR_RULES_VERSION,
    created_files: created,
    overwritten_files: [],
    version_file: versionPath,
    stale,
  };
}

export function migrateSupervisorFiles(supervisorHome: string): SupervisorMigrationSummary {
  mkdirSync(supervisorHome, { recursive: true });
  const overwritten: string[] = [];
  for (const [name, content] of Object.entries(supervisorFiles())) {
    const filePath = path.join(supervisorHome, name);
    writeFileSync(filePath, content, "utf8");
    overwritten.push(filePath);
  }
  const versionPath = writeSupervisorVersion(supervisorHome);
  return {
    supervisor_home: supervisorHome,
    version: SUPERVISOR_RULES_VERSION,
    created_files: [],
    overwritten_files: overwritten,
    version_file: versionPath,
    stale: false,
  };
}

export function formatSupervisorMigrationSummary(summary: SupervisorMigrationSummary): string {
  return [
    "Supervisor migration completed.",
    `supervisor_home: ${summary.supervisor_home}`,
    `version: ${summary.version}`,
    `overwritten_files: ${summary.overwritten_files.length}`,
    `created_files: ${summary.created_files.length}`,
    `version_file: ${summary.version_file}`,
  ].join("\n") + "\n";
}

export function supervisorFiles(): Record<"CLAUDE.md" | "AGENTS.md" | "MEMORY.md", string> {
  const rules = sharedRules();
  return {
    "CLAUDE.md": [
      "# codex_lead_cc Supervisor Rules",
      "",
      VERSION_MARKER,
      "",
      ...rules,
    ].join("\n") + "\n",
    "AGENTS.md": [
      "# codex_lead_cc Supervisor Rules",
      "",
      VERSION_MARKER,
      "",
      ...rules,
    ].join("\n") + "\n",
    "MEMORY.md": [
      "# codex_lead_cc Supervisor Memory",
      "",
      VERSION_MARKER,
      "",
      "Previous codex_lead_cc workflows are obsolete.",
      "The TaskFile / subagent / delegate / submit / daemon / MCP workflow is historical and replaced by cc-send / cc-input / cc-status.",
      "",
      "## Current Behavior",
      "",
      "- Treat cc-send and cc-input like native Codex command execution.",
      "- Terminal output may appear in the command output block.",
      "- Do not narrate intermediate Claude Code progress.",
      "- Act only after completed, needs_permission, timeout, interrupted, exited, busy, or not_submitted.",
      "",
      ...rules,
    ].join("\n") + "\n",
  };
}

function sharedRules(): string[] {
  return [
    "## Role",
    "",
    "You are Codex Lead.",
    "Your cwd is supervisor_home.",
    "The user started codex_lead_cc from the real project directory, but you must not enter that directory.",
    "",
    "## Hard Boundary",
    "",
    "- Do not read real project files.",
    "- Do not modify real project files.",
    "- Do not run commands in the real project directory.",
    "- Do not use MCP, subagents, delegate, submit, daemon, workers, queues, TaskContract, OperationRequest, or PermissionContract.",
    "- The real project is touched only by the long-lived Claude Code PTY managed by codex_lead_cc.",
    "",
    "## Commands",
    "",
    "Use only these commands to communicate with Claude Code:",
    "",
    "```bash",
    'codex_lead_cc cc-send "prompt"',
    "codex_lead_cc cc-send <<'EOF'",
    "multi-line prompt",
    "EOF",
    "codex_lead_cc cc-input --key 1",
    "codex_lead_cc cc-status",
    "```",
    "",
    "cc-send and cc-input are blocking command calls.",
    "Treat them like running a Python script or shell command in Codex.",
    "Their terminal output may appear in the command output block, but you must not narrate or explain intermediate progress while the command is running.",
    "Wait for the command to finish and then act on the final status footer.",
    "Only use --stream when the user explicitly asks to debug bridge output.",
    "Their exit does not mean Claude Code exited.",
    "Claude Code remains alive for the current codex_lead_cc Codex conversation.",
    "Input echo alone is not effective output and must not be treated as completed.",
    "",
    "## Tool-Like Waiting Protocol",
    "",
    "- Treat codex_lead_cc cc-send and codex_lead_cc cc-input like native Codex shell or Python executions.",
    "- After starting cc-send or cc-input, wait for the command result.",
    "- Do not send assistant progress messages while the command is still running.",
    "- Do not describe partial Claude Code output as \"Claude Code is scanning\", \"I will keep waiting\", \"it is reading files\", or similar progress narration.",
    "- Do not infer or summarize from partial output.",
    "- The command output block is enough for visibility.",
    "- Do not continue reasoning until the final <<<CODEX_LEAD_CC_STATUS>>> footer appears.",
    "- Parse the status footer before deciding the next action.",
    "- If the command returns completed, summarize the final result once.",
    "- If the command returns needs_permission, ask the human for approval.",
    "- If the command returns timeout, interrupted, exited, busy, or not_submitted, report that state and decide the next action.",
    "- Do not call cc-status during a normally running cc-send or cc-input.",
    "- If a command appears stalled for several minutes, you may run cc-status once for diagnostics.",
    "- Do not repeatedly poll cc-status.",
    "",
    "## cc-status Diagnostics",
    "",
    "- You may call cc-status once before starting work.",
    "- You may call cc-status after timeout, interrupted, or another abnormal state.",
    "- Do not use cc-status as a normal waiting loop or to poll Claude Code progress.",
    "",
    "## Permission Loop",
    "",
    "When cc-send or cc-input returns needs_permission, ask the human which option to grant.",
    "If the human chooses option 1, run codex_lead_cc cc-input --key 1.",
    "If the human chooses option 2, record reusable policy for Codex, but still run codex_lead_cc cc-input --key 1 for this request.",
    "If the human chooses option 3, run codex_lead_cc cc-input --key 3.",
    "Only send --key 2 when the human explicitly asks Claude Code itself to stop asking.",
    "When a reusable policy matches, do not repeat the full safety explanation.",
    "Say only: \"按已授权策略，发送一次性允许 1。\"",
    "Do not explain every permission step unless the user asks.",
    "",
    "Human grants reusable policy to Codex. Codex grants one-shot approval to Claude Code.",
  ];
}

function hasCurrentVersion(supervisorHome: string): boolean {
  const versionPath = path.join(supervisorHome, SUPERVISOR_VERSION_FILE);
  if (!existsSync(versionPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(versionPath, "utf8")) as { version?: unknown };
    return parsed.version === SUPERVISOR_RULES_VERSION;
  } catch {
    return false;
  }
}

function allSupervisorFilesCurrent(supervisorHome: string): boolean {
  return Object.keys(supervisorFiles()).every((name) => {
    const filePath = path.join(supervisorHome, name);
    if (!existsSync(filePath)) return false;
    return readFileSync(filePath, "utf8").includes(VERSION_MARKER);
  });
}

function writeSupervisorVersion(supervisorHome: string): string {
  const versionPath = path.join(supervisorHome, SUPERVISOR_VERSION_FILE);
  writeFileSync(
    versionPath,
    `${JSON.stringify({
      version: SUPERVISOR_RULES_VERSION,
      rules: "cc-bridge-file-ipc",
      updated_at: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
  return versionPath;
}
