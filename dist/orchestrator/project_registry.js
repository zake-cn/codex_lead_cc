import { stat } from "node:fs/promises";
import path from "node:path";
import { nextId, nowIso } from "./state_store.js";
export async function registerProjectSession(input) {
    const projectPath = await normalizeProjectPath(input.projectPath);
    const supervisorHome = path.resolve(input.supervisorHome);
    const timestamp = nowIso();
    return input.store.updateState((state) => {
        const existingProject = Object.values(state.projects).find((project) => project.path === projectPath);
        let projectId = existingProject?.project_id;
        if (!projectId) {
            state.counters.project += 1;
            projectId = nextId("proj", state.counters.project);
            state.projects[projectId] = {
                project_id: projectId,
                path: projectPath,
                created_at: timestamp,
                updated_at: timestamp,
            };
        }
        state.counters.supervisor_session += 1;
        const sessionId = nextId("sup_session", state.counters.supervisor_session);
        const session = {
            session_id: sessionId,
            project_id: projectId,
            project_path: projectPath,
            supervisor_home: supervisorHome,
            status: "active",
            created_at: timestamp,
            updated_at: timestamp,
        };
        state.project_sessions[sessionId] = session;
        state.projects[projectId].last_session_id = sessionId;
        state.projects[projectId].updated_at = timestamp;
        return session;
    });
}
export async function resolveProjectContext(store, sessionId) {
    if (!sessionId) {
        return undefined;
    }
    const state = await store.readState();
    const session = state.project_sessions[sessionId];
    if (!session || session.status !== "active") {
        return undefined;
    }
    return {
        session_id: session.session_id,
        project_id: session.project_id,
        project_path: session.project_path,
    };
}
export async function resolveProjectPathById(store, projectId) {
    if (!projectId) {
        return undefined;
    }
    const state = await store.readState();
    return state.projects[projectId]?.path;
}
async function normalizeProjectPath(projectPath) {
    if (!projectPath || typeof projectPath !== "string") {
        throw new Error("projectPath is required and must be a non-empty string.");
    }
    const resolved = path.resolve(projectPath);
    const projectStat = await stat(resolved).catch(() => undefined);
    if (!projectStat?.isDirectory()) {
        throw new Error(`Project path does not exist or is not a directory: ${resolved}`);
    }
    return resolved;
}
//# sourceMappingURL=project_registry.js.map