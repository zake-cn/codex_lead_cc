import type { MetricsInput, MetricsReport } from "../types.js";
import { StateStore } from "./state_store.js";
export declare class MetricsCollector {
    private readonly store;
    constructor(store: StateStore);
    getMetrics(input: MetricsInput): Promise<MetricsReport & {
        metrics_path: string;
    }>;
}
