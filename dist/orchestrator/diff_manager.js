import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { appendEvent, nextId } from "./state_store.js";
const execFileAsync = promisify(execFile);
export class DiffManager {
    store;
    constructor(store) {
        this.store = store;
    }
    async createDiffArtifacts(task) {
        if (task.role !== "implementer") {
            return undefined;
        }
        const gitPath = task.execution_path || task.project_path;
        const isGit = await isGitRepo(gitPath);
        if (!isGit) {
            return undefined;
        }
        const [{ stdout: patch }, { stdout: numstat }] = await Promise.all([
            execFileAsync("git", ["-C", gitPath, "diff", "--patch", "--binary"]),
            execFileAsync("git", ["-C", gitPath, "diff", "--numstat"]),
        ]);
        const paths = this.store.taskPaths(task.id);
        const summary = buildSummary(task.id, numstat, patch, paths.displayPatchPath);
        await Promise.all([
            writeFile(paths.patchPath, patch, "utf8"),
            writeFile(paths.diffSummaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
        ]);
        await this.store.updateState((state) => {
            const latestTask = state.tasks[task.id];
            if (latestTask) {
                latestTask.patch_path = paths.displayPatchPath;
                latestTask.diff_summary_path = paths.displayDiffSummaryPath;
                latestTask.files_modified = summary.files.map((file) => file.path);
                latestTask.updated_at = new Date().toISOString();
            }
            for (const artifact of [
                { type: "patch", path: paths.displayPatchPath },
                { type: "diff_summary", path: paths.displayDiffSummaryPath },
            ]) {
                state.counters.artifact += 1;
                const id = nextId("art", state.counters.artifact);
                state.artifacts[id] = {
                    id,
                    project_id: task.project_id,
                    task_id: task.id,
                    type: artifact.type,
                    path: artifact.path,
                    created_at: new Date().toISOString(),
                };
            }
            appendEvent(state, {
                type: "patch_created",
                project_id: task.project_id,
                task_id: task.id,
                worker_id: task.worker_id,
                summary: `Created patch for ${task.id}: ${summary.files_changed} files changed.`,
                payload: summary,
            });
        });
        return summary;
    }
    async getSummary(input) {
        const state = await this.store.readState();
        const task = state.tasks[input.task_id];
        if (!task) {
            throw new Error(`Task not found: ${input.task_id}`);
        }
        const paths = this.store.taskPaths(task.id);
        const raw = await readFile(paths.diffSummaryPath, "utf8").catch(() => undefined);
        if (!raw) {
            return {
                task_id: task.id,
                files_changed: 0,
                insertions: 0,
                deletions: 0,
                files: [],
                patch_path: task.patch_path,
            };
        }
        return JSON.parse(raw);
    }
    async getDetail(input) {
        const state = await this.store.readState();
        const task = state.tasks[input.task_id];
        if (!task) {
            throw new Error(`Task not found: ${input.task_id}`);
        }
        const patch = await readFile(this.store.taskPaths(task.id).patchPath, "utf8").catch(() => "");
        return {
            task_id: task.id,
            file: input.file,
            diff: extractFileDiff(patch, input.file),
        };
    }
}
function buildSummary(taskId, numstat, patch, patchPath) {
    const files = numstat
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [insertionsRaw, deletionsRaw, filePath] = line.split(/\s+/, 3);
        const insertions = Number(insertionsRaw) || 0;
        const deletions = Number(deletionsRaw) || 0;
        return {
            path: filePath,
            change_summary: changeSummary(filePath, patch),
            risk: riskForPath(filePath),
            insertions,
            deletions,
        };
    });
    return {
        task_id: taskId,
        files_changed: files.length,
        insertions: files.reduce((sum, file) => sum + file.insertions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        files,
        patch_path: patchPath,
    };
}
function changeSummary(filePath, patch) {
    if (patch.includes(`new file mode`) && patch.includes(`+++ b/${filePath}`)) {
        return `Added ${filePath}.`;
    }
    if (patch.includes(`deleted file mode`) && patch.includes(`--- a/${filePath}`)) {
        return `Deleted ${filePath}.`;
    }
    return `Modified ${filePath}.`;
}
function riskForPath(filePath) {
    if (filePath.includes(".env") || filePath.startsWith(".git/")) {
        return "high";
    }
    if (filePath === "package.json" || filePath.endsWith("pyproject.toml")) {
        return "medium";
    }
    return "low";
}
function extractFileDiff(patch, filePath) {
    const lines = patch.split(/\r?\n/);
    const chunks = [];
    let collecting = false;
    for (const line of lines) {
        if (line.startsWith("diff --git ")) {
            if (collecting) {
                break;
            }
            collecting =
                line.includes(` a/${filePath} `) ||
                    line.endsWith(` a/${filePath} b/${filePath}`) ||
                    line.includes(` b/${filePath}`);
        }
        if (collecting) {
            chunks.push(line);
        }
    }
    return chunks.join("\n");
}
async function isGitRepo(path) {
    try {
        await execFileAsync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"]);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=diff_manager.js.map