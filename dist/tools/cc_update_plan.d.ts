import type { UpdatePlanInput } from "../types.js";
export declare function ccUpdatePlan(input: UpdatePlanInput): Promise<{
    plan_id: string;
    version: number;
    status: import("../types.js").PlanRecord["status"];
    change_id: string;
}>;
