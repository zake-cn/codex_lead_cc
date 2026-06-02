import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
// ── Prestart artifacts ──
export function writePrestartArtifacts(args) {
    const artifactDir = path.join(args.artifactRoot, args.taskFile.task_id);
    try {
        mkdirSync(artifactDir, { recursive: true });
    }
    catch (e) {
        const code = e.code ?? "UNKNOWN";
        throw new Error(`Failed to create artifact directory.\n` +
            `  artifact_dir: ${artifactDir}\n` +
            `  reason: ${code} — ${e.message}`);
    }
    writeSafe(path.join(artifactDir, "task.md"), args.rawTaskFile, artifactDir);
    writeSafe(path.join(artifactDir, "prompt.md"), args.prompt, artifactDir);
    writeSafe(path.join(artifactDir, "started.json"), JSON.stringify({ started_at: new Date().toISOString(), task_id: args.taskFile.task_id }, null, 2) + "\n", artifactDir);
    return artifactDir;
}
export function writeResultArtifacts(input) {
    const artifactDir = path.join(input.artifactRoot, input.taskFile.task_id);
    // 1. Write Claude output
    writeSafe(path.join(artifactDir, "claude_stdout.md"), input.stdout || "(no output)", artifactDir);
    writeSafe(path.join(artifactDir, "claude_stderr.log"), input.stderr || "(no stderr)", artifactDir);
    // 2. If write mode, capture git diff FIRST
    let changedFiles = [];
    if (input.taskFile.worker_type === "write") {
        try {
            const diff = execSync("git diff", {
                cwd: input.projectPath,
                encoding: "utf8",
                maxBuffer: 10 * 1024 * 1024,
            });
            if (diff.trim()) {
                writeSafe(path.join(artifactDir, "diff.patch"), diff, artifactDir);
                changedFiles = parseChangedFiles(diff);
            }
        }
        catch {
            // git diff may fail if not a git repo — non-fatal
        }
    }
    // 3. Build result with accurate changed_files
    const result = {
        task_id: input.taskFile.task_id,
        worker_type: input.taskFile.worker_type,
        status: input.status,
        exit_code: input.exitCode,
        duration_ms: input.durationMs,
        artifact_dir: artifactDir,
        changed_files: changedFiles,
        summary: input.stdout.slice(0, 2000).trim(),
    };
    // 4. Write result.json last
    writeSafe(path.join(artifactDir, "result.json"), JSON.stringify(result, null, 2) + "\n", artifactDir);
    return result;
}
// ── Helpers ──
function writeSafe(filePath, content, artifactDir) {
    try {
        writeFileSync(filePath, content, "utf8");
    }
    catch (e) {
        const code = e.code ?? "UNKNOWN";
        throw new Error(`Failed to write artifact.\n` +
            `  file: ${filePath}\n` +
            `  artifact_dir: ${artifactDir}\n` +
            `  reason: ${code} — ${e.message}`);
    }
}
function parseChangedFiles(diff) {
    const files = new Set();
    for (const line of diff.split(/\r?\n/)) {
        const match = /^\+\+\+ b\/(.+)$/.exec(line);
        if (match)
            files.add(match[1]);
    }
    return [...files].sort();
}
//# sourceMappingURL=artifacts.js.map