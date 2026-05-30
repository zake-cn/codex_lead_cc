import type { DiffSummary, GetDiffDetailInput, GetDiffSummaryInput, TaskRecord } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class DiffManager {
    private readonly store;
    constructor(store: StateStore);
    createDiffArtifacts(task: TaskRecord): Promise<DiffSummary | undefined>;
    getSummary(input: GetDiffSummaryInput): Promise<DiffSummary>;
    getDetail(input: GetDiffDetailInput): Promise<{
        task_id: string;
        file: string;
        diff: string;
    }>;
}
