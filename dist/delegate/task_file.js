import { readFile } from "node:fs/promises";
import { WORKER_TYPES } from "../types.js";
const REQUIRED_SECTIONS = [
    "Goal",
    "Allowed Scope",
    "Forbidden Actions",
    "Acceptance Criteria",
    "Verification",
    "Report Requirements",
];
export async function loadTaskFile(taskFilePath) {
    const raw = await readFile(taskFilePath, "utf8");
    return parseTaskFile(raw, taskFilePath);
}
export function parseTaskFile(raw, label = "<task-file>") {
    if (!raw.trim()) {
        throw new Error(`TaskFile is empty: ${label}`);
    }
    const { header, sections } = splitMarkdown(raw);
    const taskId = readKey(header, "TaskId", label);
    const workerType = validateWorkerType(readKey(header, "WorkerType", label), label);
    const parsed = {};
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
function splitMarkdown(raw) {
    const lines = raw.split(/\r?\n/);
    const headerLines = [];
    const sections = {};
    let currentSection = null;
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
        }
        else {
            headerLines.push(line);
        }
    }
    const result = {};
    for (const [name, sectionLines] of Object.entries(sections)) {
        result[name] = sectionLines.join("\n");
    }
    return { header: headerLines.join("\n"), sections: result };
}
function readKey(header, key, label) {
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
function validateWorkerType(value, label) {
    if (!WORKER_TYPES.includes(value)) {
        throw new Error(`TaskFile WorkerType must be one of: ${WORKER_TYPES.join(", ")}. Got: "${value}". ${label}`);
    }
    return value;
}
function isPlaceholder(content) {
    const stripped = content.trim();
    return (stripped === "..." ||
        stripped === "<todo>" ||
        stripped === "<TBD>" ||
        stripped === "TODO" ||
        stripped === "TBD" ||
        stripped.startsWith("<placeholder") ||
        stripped.length < 3);
}
//# sourceMappingURL=task_file.js.map