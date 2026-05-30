import { SUPERVISOR_STATES } from "../types.js";
import { nowIso } from "./state_store.js";
const VALID_STATES = new Set(SUPERVISOR_STATES);
export class SupervisorStateManager {
    store;
    constructor(store) {
        this.store = store;
    }
    async setState(input) {
        const projectId = normalizeProjectId(input.project_id);
        const stateValue = normalizeSupervisorState(input.state);
        const timestamp = nowIso();
        const key = supervisorStateKey(projectId, input.plan_id);
        await this.store.updateState((state) => {
            state.supervisor_states[key] = {
                key,
                project_id: projectId,
                plan_id: input.plan_id,
                state: stateValue,
                reason: input.reason,
                updated_at: timestamp,
            };
        });
        return {
            ok: true,
            state: stateValue,
            updated_at: timestamp,
        };
    }
    async getState(input) {
        const projectId = normalizeProjectId(input.project_id);
        const state = await this.store.readState();
        const exact = state.supervisor_states[supervisorStateKey(projectId, input.plan_id)];
        if (exact) {
            return exact;
        }
        const projectDefault = state.supervisor_states[supervisorStateKey(projectId)];
        if (projectDefault) {
            return projectDefault;
        }
        return {
            key: supervisorStateKey(projectId, input.plan_id),
            project_id: projectId,
            plan_id: input.plan_id,
            state: "active",
            reason: "No supervisor state has been set; defaulting to active.",
            updated_at: new Date(0).toISOString(),
        };
    }
}
export function supervisorStateKey(projectId, planId) {
    return `${projectId}::${planId ?? "*"}`;
}
function normalizeProjectId(projectId) {
    if (!projectId || typeof projectId !== "string" || projectId.trim().length === 0) {
        throw new Error("project_id is required and must be a non-empty string.");
    }
    return projectId.trim();
}
function normalizeSupervisorState(state) {
    if (!VALID_STATES.has(state)) {
        throw new Error(`state must be one of: ${SUPERVISOR_STATES.join(", ")}.`);
    }
    return state;
}
//# sourceMappingURL=supervisor_state.js.map