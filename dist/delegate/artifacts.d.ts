import type { DelegateResult, ParsedTaskFile } from "../types.js";
export declare function writePrestartArtifacts(args: {
    artifactRoot: string;
    taskFile: ParsedTaskFile;
    rawTaskFile: string;
    prompt: string;
}): string;
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
}
export declare function writeResultArtifacts(input: ArtifactInput): DelegateResult;
