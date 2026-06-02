import type { ParsedTaskFile } from "../types.js";
export declare function loadTaskFile(taskFilePath: string): Promise<ParsedTaskFile>;
export declare function parseTaskFile(raw: string, label?: string): ParsedTaskFile;
