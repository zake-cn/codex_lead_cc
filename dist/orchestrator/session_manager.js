import { appendEvent, nextId, nowIso } from "./state_store.js";
export class SessionManager {
    store;
    constructor(store) {
        this.store = store;
    }
    async getWorkerHealth(input) {
        const state = await this.store.readState();
        const workers = Object.values(state.workers)
            .filter((worker) => {
            if (input.worker_id && worker.id !== input.worker_id) {
                return false;
            }
            if (input.project_id && worker.project_id !== input.project_id) {
                return false;
            }
            return true;
        })
            .map((worker) => buildHealthReport(worker));
        if (input.worker_id && workers.length === 0) {
            throw new Error(`Worker not found: ${input.worker_id}`);
        }
        await this.store.updateState((stateForEvent) => {
            for (const report of workers) {
                appendEvent(stateForEvent, {
                    type: "worker_health_checked",
                    project_id: stateForEvent.workers[report.worker_id]?.project_id,
                    worker_id: report.worker_id,
                    summary: `Worker ${report.worker_id} health is ${report.health_status}.`,
                    payload: report,
                });
            }
        });
        return { workers };
    }
    async restartWorker(input) {
        const timestamp = nowIso();
        return this.store.updateState((state) => {
            const worker = state.workers[input.worker_id];
            if (!worker) {
                throw new Error(`Worker not found: ${input.worker_id}`);
            }
            if (worker.current_task_id) {
                throw new Error(`Worker ${worker.id} is running task ${worker.current_task_id}; stop the task before restarting the worker.`);
            }
            if (worker.session_id) {
                const oldSession = state.sessions[worker.session_id];
                if (oldSession) {
                    oldSession.status = "stopped";
                    oldSession.last_active_at = timestamp;
                }
            }
            state.counters.session += 1;
            const sessionId = nextId("session", state.counters.session);
            worker.session_id = sessionId;
            worker.status = "idle";
            worker.updated_at = timestamp;
            worker.last_active_at = timestamp;
            state.sessions[sessionId] = {
                session_id: sessionId,
                worker_id: worker.id,
                runtime: worker.runtime ?? "claude_cli",
                project_id: worker.project_id,
                role: worker.role,
                status: "idle",
                created_at: timestamp,
                last_active_at: timestamp,
                idle_timeout_sec: worker.idle_timeout_sec ?? 900,
                metadata: { restart_reason: input.reason ?? "Worker restarted by supervisor." },
            };
            appendEvent(state, {
                type: "worker_restarted",
                project_id: worker.project_id,
                worker_id: worker.id,
                summary: `Worker ${worker.id} restarted with session ${sessionId}.`,
                payload: { session_id: sessionId, reason: input.reason },
            });
            return {
                worker_id: worker.id,
                status: worker.status,
                session_id: sessionId,
                message: "Worker restarted with fresh session metadata.",
            };
        });
    }
    async cleanupIdleWorkers(input) {
        const now = Date.now();
        const cleanedWorkerIds = [];
        const dryRun = input.dry_run ?? false;
        const timestamp = nowIso();
        await this.store.updateState((state) => {
            for (const worker of Object.values(state.workers)) {
                if (input.project_id && worker.project_id !== input.project_id) {
                    continue;
                }
                if (worker.current_task_id || worker.status === "running" || worker.status === "pending" || worker.status === "busy") {
                    continue;
                }
                const timeoutSec = input.idle_timeout_sec ?? worker.idle_timeout_sec ?? 900;
                const lastActive = worker.last_active_at ?? worker.updated_at ?? worker.created_at;
                const idleForMs = now - new Date(lastActive).getTime();
                if (idleForMs < timeoutSec * 1000) {
                    continue;
                }
                cleanedWorkerIds.push(worker.id);
                if (dryRun) {
                    continue;
                }
                worker.status = "stopped";
                worker.updated_at = timestamp;
                worker.last_active_at = timestamp;
                const session = worker.session_id ? state.sessions[worker.session_id] : undefined;
                if (session) {
                    session.status = "stopped";
                    session.last_active_at = timestamp;
                }
                appendEvent(state, {
                    type: "session_cleaned",
                    project_id: worker.project_id,
                    worker_id: worker.id,
                    summary: `Cleaned idle session for worker ${worker.id}.`,
                    payload: { session_id: worker.session_id, idle_timeout_sec: timeoutSec },
                });
            }
            if (cleanedWorkerIds.length > 0) {
                appendEvent(state, {
                    type: "idle_workers_cleaned",
                    project_id: input.project_id,
                    summary: `Cleaned ${cleanedWorkerIds.length} idle worker session(s).`,
                    payload: { worker_ids: cleanedWorkerIds, dry_run: dryRun },
                });
            }
        });
        return {
            dry_run: dryRun,
            cleaned_worker_ids: cleanedWorkerIds,
        };
    }
}
function buildHealthReport(worker) {
    const lastActive = worker.last_active_at ?? worker.updated_at ?? worker.created_at;
    const idleForMs = worker.current_task_id ? null : Date.now() - new Date(lastActive).getTime();
    const idleTimeoutSec = worker.idle_timeout_sec ?? 900;
    return {
        worker_id: worker.id,
        status: worker.status,
        health_status: inferHealth(worker, idleForMs, idleTimeoutSec),
        runtime: worker.runtime ?? "claude_cli",
        session_id: worker.session_id ?? null,
        current_task_id: worker.current_task_id ?? null,
        last_active_at: lastActive,
        idle_for_ms: idleForMs,
        idle_timeout_sec: idleTimeoutSec,
    };
}
function inferHealth(worker, idleForMs, idleTimeoutSec) {
    if (worker.status === "crashed") {
        return "crashed";
    }
    if (worker.status === "stopped") {
        return "stopped";
    }
    if (worker.current_task_id || worker.status === "running" || worker.status === "pending" || worker.status === "busy") {
        return "busy";
    }
    if (idleForMs !== null && idleForMs >= idleTimeoutSec * 1000) {
        return "idle_timeout";
    }
    return "healthy";
}
//# sourceMappingURL=session_manager.js.map