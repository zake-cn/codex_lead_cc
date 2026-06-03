import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
export const SUPERVISOR_RULES_VERSION = 2;
export const SUPERVISOR_VERSION_FILE = ".codex_lead_cc_supervisor_version.json";
const VERSION_MARKER = `codex_lead_cc_supervisor_rules_version: ${SUPERVISOR_RULES_VERSION}`;
export function ensureSupervisorFiles(supervisorHome) {
    mkdirSync(supervisorHome, { recursive: true });
    const files = supervisorFiles();
    const created = [];
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
export function migrateSupervisorFiles(supervisorHome) {
    mkdirSync(supervisorHome, { recursive: true });
    const overwritten = [];
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
export function formatSupervisorMigrationSummary(summary) {
    return [
        "Supervisor migration completed.",
        `supervisor_home: ${summary.supervisor_home}`,
        `version: ${summary.version}`,
        `overwritten_files: ${summary.overwritten_files.length}`,
        `created_files: ${summary.created_files.length}`,
        `version_file: ${summary.version_file}`,
    ].join("\n") + "\n";
}
export function supervisorFiles() {
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
            ...rules,
        ].join("\n") + "\n",
    };
}
function sharedRules() {
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
        "cc-send and cc-input are blocking output waiters.",
        "They stream Claude Code PTY output and exit only after completed, needs_permission, timeout, interrupted, exited, or busy.",
        "Their exit does not mean Claude Code exited.",
        "Claude Code remains alive for the current codex_lead_cc Codex conversation.",
        "",
        "## Permission Loop",
        "",
        "When cc-send or cc-input returns needs_permission, ask the human which option to grant.",
        "If the human chooses option 1, run codex_lead_cc cc-input --key 1.",
        "If the human chooses option 2, record reusable policy for Codex, but still run codex_lead_cc cc-input --key 1 for this request.",
        "If the human chooses option 3, run codex_lead_cc cc-input --key 3.",
        "Only send --key 2 when the human explicitly asks Claude Code itself to stop asking.",
        "",
        "Human grants reusable policy to Codex. Codex grants one-shot approval to Claude Code.",
    ];
}
function hasCurrentVersion(supervisorHome) {
    const versionPath = path.join(supervisorHome, SUPERVISOR_VERSION_FILE);
    if (!existsSync(versionPath))
        return false;
    try {
        const parsed = JSON.parse(readFileSync(versionPath, "utf8"));
        return parsed.version === SUPERVISOR_RULES_VERSION;
    }
    catch {
        return false;
    }
}
function allSupervisorFilesCurrent(supervisorHome) {
    return Object.keys(supervisorFiles()).every((name) => {
        const filePath = path.join(supervisorHome, name);
        if (!existsSync(filePath))
            return false;
        return readFileSync(filePath, "utf8").includes(VERSION_MARKER);
    });
}
function writeSupervisorVersion(supervisorHome) {
    const versionPath = path.join(supervisorHome, SUPERVISOR_VERSION_FILE);
    writeFileSync(versionPath, `${JSON.stringify({
        version: SUPERVISOR_RULES_VERSION,
        rules: "cc-bridge-file-ipc",
        updated_at: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    return versionPath;
}
//# sourceMappingURL=supervisor.js.map