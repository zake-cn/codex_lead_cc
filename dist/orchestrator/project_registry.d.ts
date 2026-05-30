import type { ProjectSessionRecord } from "../types.js";
import { StateStore } from "./state_store.js";
export interface ProjectContext {
    session_id: string;
    project_id: string;
    project_path: string;
}
export declare function registerProjectSession(input: {
    store: StateStore;
    projectPath: string;
    supervisorHome: string;
}): Promise<ProjectSessionRecord>;
export declare function resolveProjectContext(store: StateStore, sessionId: string | undefined): Promise<ProjectContext | undefined>;
export declare function resolveProjectPathById(store: StateStore, projectId: string | undefined): Promise<string | undefined>;
