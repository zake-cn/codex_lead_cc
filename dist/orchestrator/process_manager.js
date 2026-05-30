import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
export class ProcessManager {
    startTaskWorker(taskId, stateDir) {
        const entryPath = taskWorkerEntryPath();
        const child = spawn(process.execPath, [entryPath, "--task-id", taskId, "--state-dir", stateDir], {
            cwd: process.cwd(),
            detached: true,
            env: process.env,
            stdio: "ignore",
        });
        child.unref();
        if (!child.pid) {
            throw new Error(`Failed to start task worker for task ${taskId}.`);
        }
        return child.pid;
    }
    stopPid(pid, signal = "SIGTERM") {
        try {
            process.kill(-pid, signal);
            return {
                ok: true,
                message: `Sent ${signal} to process group ${pid}.`,
            };
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ESRCH") {
                return this.stopSinglePid(pid, signal);
            }
            return this.stopSinglePid(pid, signal);
        }
    }
    stopSinglePid(pid, signal) {
        try {
            process.kill(pid, signal);
            return {
                ok: true,
                message: `Sent ${signal} to pid ${pid}.`,
            };
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ESRCH") {
                return {
                    ok: false,
                    message: `Process ${pid} is not running.`,
                };
            }
            throw error;
        }
    }
}
function taskWorkerEntryPath() {
    const currentFile = fileURLToPath(import.meta.url);
    return path.join(path.dirname(currentFile), "task_worker_entry.js");
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=process_manager.js.map