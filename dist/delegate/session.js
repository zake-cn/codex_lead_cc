import { readFile } from "node:fs/promises";
export async function loadSessionFile(sessionFile) {
    const raw = await readFile(sessionFile, "utf8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Session file is not valid JSON: ${sessionFile}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Session file must be a JSON object.");
    }
    const session = parsed;
    if (session.version !== 1) {
        throw new Error(`Unsupported session file version: ${session.version}`);
    }
    const required = [
        "session_id",
        "project_path",
        "supervisor_home",
        "task_dir",
        "artifact_root",
        "claude_env_file",
    ];
    for (const key of required) {
        if (typeof session[key] !== "string" || !session[key].trim()) {
            throw new Error(`Session file is missing required field: ${key}`);
        }
    }
    return {
        version: 1,
        session_id: session.session_id,
        project_path: session.project_path,
        supervisor_home: session.supervisor_home,
        task_dir: session.task_dir,
        artifact_root: session.artifact_root,
        claude_env_file: session.claude_env_file,
        created_at: session.created_at ?? new Date(0).toISOString(),
    };
}
//# sourceMappingURL=session.js.map