import type { CreatePlanInput } from "../types.js";
export declare function ccCreatePlan(input: CreatePlanInput): Promise<{
    plan_id: string;
    version: number;
    status: import("../types.js").PlanRecord["status"];
}>;
