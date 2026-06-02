#!/usr/bin/env node
import type { DelegateResult } from "../types.js";
export interface DelegateOptions {
    taskFile: string;
    sessionFile: string;
    timeoutSec: number;
    dryRun: boolean;
}
export declare function runDelegate(options: DelegateOptions): Promise<DelegateResult>;
export declare function delegateMain(rawArgs: string[]): Promise<void>;
