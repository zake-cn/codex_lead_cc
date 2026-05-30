import type { CreatePlanInput, GetPlanInput, ListPlansInput, PlanRecord, UpdatePlanInput } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class PlanManager {
    private readonly store;
    constructor(store: StateStore);
    createPlan(input: CreatePlanInput): Promise<{
        plan_id: string;
        version: number;
        status: PlanRecord["status"];
    }>;
    getPlan(input: GetPlanInput): Promise<Record<string, unknown>>;
    updatePlan(input: UpdatePlanInput): Promise<{
        plan_id: string;
        version: number;
        status: PlanRecord["status"];
        change_id: string;
    }>;
    listPlans(input: ListPlansInput): Promise<{
        plans: PlanRecord[];
    }>;
}
