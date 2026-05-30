import type { CleanupIdleWorkersInput } from "../types.js";
export declare function ccCleanupIdleWorkers(input: CleanupIdleWorkersInput): Promise<{
    dry_run: boolean;
    cleaned_worker_ids: string[];
}>;
