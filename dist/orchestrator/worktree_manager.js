import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appendEvent } from "./state_store.js";
const execFileAsync = promisify(execFile);
export class WorktreeManager {
    store;
    constructor(store) {
        this.store = store;
    }
    async prepareTaskExecution(task) {
        if (task.role !== "implementer") {
            if (task.role === "tester" && task.target_task_id) {
                const state = await this.store.readState();
                const target = state.tasks[task.target_task_id];
                if (target?.worktree_path) {
                    return {
                        executionPath: path.resolve(target.worktree_path),
                        worktreePath: target.worktree_path,
                        worktreeMode: "direct",
                        baseBranch: target.base_branch,
                    };
                }
            }
            return {
                executionPath: task.project_path,
                worktreeMode: task.role === "scout" || task.role === "reviewer" ? "readonly" : "direct",
            };
        }
        const gitInfo = await getGitInfo(task.project_path);
        if (!gitInfo.isGitRepo) {
            await this.store.updateState((state) => {
                appendEvent(state, {
                    type: "worktree_fallback",
                    project_id: task.project_id,
                    task_id: task.id,
                    worker_id: task.worker_id,
                    summary: `Project ${task.project_id} is not a git repository; implementer will use direct mode.`,
                    payload: { project_path: task.project_path },
                });
            });
            return {
                executionPath: task.project_path,
                worktreeMode: "direct",
            };
        }
        const worktreePath = this.store.worktreePath(task.id, "impl");
        await execFileAsync("git", [
            "-C",
            task.project_path,
            "worktree",
            "add",
            "--detach",
            worktreePath,
            "HEAD",
        ]);
        const displayWorktreePath = this.store.displayPath(worktreePath);
        await this.store.updateState((state) => {
            const latestTask = state.tasks[task.id];
            if (latestTask) {
                latestTask.worktree_path = displayWorktreePath;
                latestTask.worktree_mode = "isolated";
                latestTask.execution_path = worktreePath;
                latestTask.base_branch = gitInfo.baseBranch;
                latestTask.updated_at = new Date().toISOString();
            }
            const worker = state.workers[task.worker_id];
            if (worker) {
                worker.worktree_path = displayWorktreePath;
                worker.worktree_mode = "isolated";
                worker.updated_at = new Date().toISOString();
            }
            state.counters.artifact += 1;
            const artifactId = `art_${state.counters.artifact.toString().padStart(3, "0")}`;
            state.artifacts[artifactId] = {
                id: artifactId,
                project_id: task.project_id,
                task_id: task.id,
                type: "worktree",
                path: displayWorktreePath,
                created_at: new Date().toISOString(),
            };
            appendEvent(state, {
                type: "worktree_created",
                project_id: task.project_id,
                task_id: task.id,
                worker_id: task.worker_id,
                summary: `Created isolated worktree for ${task.id}.`,
                payload: { worktree_path: displayWorktreePath, base_branch: gitInfo.baseBranch },
            });
        });
        return {
            executionPath: worktreePath,
            worktreePath: displayWorktreePath,
            worktreeMode: "isolated",
            baseBranch: gitInfo.baseBranch,
        };
    }
    async cleanup(input) {
        const state = await this.store.readState();
        const tasks = Object.values(state.tasks).filter((task) => {
            if (!task.worktree_path) {
                return false;
            }
            if (input.task_id && task.id !== input.task_id) {
                return false;
            }
            if (input.worker_id && task.worker_id !== input.worker_id) {
                return false;
            }
            return true;
        });
        const cleaned = [];
        for (const task of tasks) {
            const absoluteWorktree = path.resolve(task.worktree_path);
            if (!absoluteWorktree.startsWith(this.store.worktreesDir)) {
                throw new Error(`Refusing to clean worktree outside managed directory: ${task.worktree_path}`);
            }
            await removeWorktree(task.project_path, absoluteWorktree);
            cleaned.push(task.worktree_path);
        }
        await this.store.updateState((latest) => {
            for (const task of tasks) {
                const latestTask = latest.tasks[task.id];
                if (latestTask) {
                    delete latestTask.worktree_path;
                    latestTask.worktree_mode = "direct";
                    latestTask.updated_at = new Date().toISOString();
                }
                const worker = latest.workers[task.worker_id];
                if (worker?.worktree_path === task.worktree_path) {
                    delete worker.worktree_path;
                    worker.worktree_mode = "direct";
                    worker.updated_at = new Date().toISOString();
                }
                appendEvent(latest, {
                    type: "worktree_cleanup",
                    project_id: task.project_id,
                    task_id: task.id,
                    worker_id: task.worker_id,
                    summary: `Cleaned worktree for ${task.id}.`,
                    payload: { worktree_path: task.worktree_path },
                });
            }
        });
        return { cleaned };
    }
}
async function getGitInfo(projectPath) {
    try {
        await execFileAsync("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"]);
        const { stdout } = await execFileAsync("git", [
            "-C",
            projectPath,
            "rev-parse",
            "--abbrev-ref",
            "HEAD",
        ]);
        return {
            isGitRepo: true,
            baseBranch: stdout.trim() || "HEAD",
        };
    }
    catch {
        return { isGitRepo: false };
    }
}
async function removeWorktree(projectPath, worktreePath) {
    try {
        await execFileAsync("git", ["-C", projectPath, "worktree", "remove", "--force", worktreePath]);
    }
    catch {
        await rm(worktreePath, { recursive: true, force: true });
    }
}
//# sourceMappingURL=worktree_manager.js.map