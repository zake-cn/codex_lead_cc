import type { MetricsInput } from "../types.js";
export declare function ccGetMetrics(input: MetricsInput): Promise<import("../types.js").MetricsReport & {
    metrics_path: string;
}>;
