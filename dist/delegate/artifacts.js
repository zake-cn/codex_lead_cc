import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
export function writeArtifacts(input) {
    const artifactDir = path.join(input.artifactRoot, input.taskFile.task_id);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(path.join(artifactDir, "task.md"), input.rawTaskFile, "utf8");
    writeFileSync(path.join(artifactDir, "prompt.md"), input.prompt, "utf8");
    writeFileSync(path.join(artifactDir, "claude_stdout.md"), input.stdout || "(no output)", "utf8");
    writeFileSync(path.join(artifactDir, "claude_stderr.log"), input.stderr || "(no stderr)", "utf8");
    const result = {
        task_id: input.taskFile.task_id,
        worker_type: input.taskFile.worker_type,
        status: input.status,
        exit_code: input.exitCode,
        duration_ms: input.durationMs,
        artifact_dir: artifactDir,
        changed_files: input.changedFiles,
        summary: extractSummary(input.stdout, input.taskFile.report_requirements),
    };
    writeFileSync(path.join(artifactDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    if (input.taskFile.worker_type === "write") {
        try {
            const diff = execSync("git diff", {
                cwd: input.projectPath,
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
            });
            if (diff.trim()) {
                writeFileSync(path.join(artifactDir, "diff.patch"), diff, "utf8");
                result.changed_files = parseChangedFiles(diff);
            }
        }
        catch {
            // git diff may fail if not a git repo — non-fatal
        }
    }
    return artifactDir;
}
function extractSummary(stdout, _reportRequirements) {
    // Take the first 2000 chars as compact summary for the supervisor.
    // The full output is always in claude_stdout.md.
    return stdout.slice(0, 2000).trim();
}
function parseChangedFiles(diff) {
    const files = new Set();
    for (const line of diff.split(/\r?\n/)) {
        const match = /^\+\+\+ b\/(.+)$/.exec(line);
        if (match) {
            files.add(match[1]);
        }
    }
    return [...files].sort();
}
//# sourceMappingURL=artifacts.js.map