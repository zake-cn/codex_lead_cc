import type { DelegateResult, ParsedTaskFile } from "../types.js";
export interface ArtifactInput {
    artifactRoot: string;
    taskFile: ParsedTaskFile;
    rawTaskFile: string;
    prompt: string;
    projectPath: string;
    stdout: string;
    stderr: string;
    status: DelegateResult["status"];
    exitCode: number | null;
    durationMs: number;
    changedFiles: string[];
}
export declare function writeArtifacts(input: ArtifactInput): string;
