#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDelegate } from "../delegate/delegate_runner.js";
import { loadSessionFile } from "../delegate/session.js";
import { loadTaskFile } from "../delegate/task_file.js";
const POLL_INTERVAL_MS = 250;
const READY_FILE = "daemon.ready";
const HEARTBEAT_INTERVAL_MS = 2_000;
const HEARTBEAT_STALE_MS = 10_000;
const IDLE_EXIT_MS = 30 * 60 * 1000;
export async function daemonMain(rawArgs) {
    const options = parseDaemonArgs(rawArgs);
    await runDaemon(options);
}
export async function submitMain(rawArgs) {
    try {
        const options = parseSubmitArgs(rawArgs);
        const result = await submit(options);
        await writeCompactJson(result);
        if (result.status !== "completed") {
            process.exitCode = 1;
        }
    }
    catch (error) {
        const result = compactErrorResult({
            requestId: "request_error",
            taskId: "unknown",
            workerType: "readonly",
            status: "failed",
            artifactDir: "",
            startedAt: Date.now(),
            error,
        });
        await writeCompactJson(result);
        process.exitCode = 1;
    }
}
async function runDaemon(options) {
    const session = await loadSessionFile(options.sessionFile);
    const sessionDir = path.dirname(options.sessionFile);
    const readyFile = path.join(sessionDir, READY_FILE);
    assertSessionQueuePaths(session);
    mkdirSync(session.queue_dir, { recursive: true });
    mkdirSync(session.result_dir, { recursive: true });
    const writeHeartbeat = () => writeReadyFile(readyFile, options.sessionFile, session);
    const cleanup = () => {
        if (heartbeatTimer)
            clearInterval(heartbeatTimer);
        if (existsSync(readyFile)) {
            try {
                unlinkSync(readyFile);
            }
            catch { /* non-fatal */ }
        }
    };
    const exitCleanly = () => {
        cleanup();
        process.exit(0);
    };
    let heartbeatTimer;
    writeHeartbeat();
    heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();
    process.once("SIGTERM", exitCleanly);
    process.once("SIGINT", exitCleanly);
    log(`ready pid=${process.pid}`);
    log(`queue=${session.queue_dir}`);
    const parentPid = readParentPid();
    let lastActivity = Date.now();
    try {
        while (true) {
            if (parentPid && !isProcessAlive(parentPid)) {
                log(`parent process ${parentPid} is gone; exiting`);
                return;
            }
            if (Date.now() - lastActivity > IDLE_EXIT_MS) {
                log("idle timeout reached; exiting");
                return;
            }
            const requestFile = nextRequestFile(session.queue_dir);
            if (!requestFile) {
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            lastActivity = Date.now();
            await processRequestFile(requestFile, session);
        }
    }
    finally {
        cleanup();
    }
}
async function processRequestFile(requestFile, session) {
    const startedAt = Date.now();
    const runningFile = `${requestFile}.running`;
    let request;
    try {
        renameSync(requestFile, runningFile);
        request = parseRequest(readFileSync(runningFile, "utf8"), requestFile);
        log(`request ${request.request_id} started`);
        const result = await runDelegate({
            taskFile: request.task_file,
            sessionFile: request.session_file,
            timeoutSec: request.timeout_sec,
            dryRun: false,
        });
        writeQueueResult(session.result_dir, request.request_id, result);
        log(`request ${request.request_id} completed status=${result.status}`);
    }
    catch (error) {
        const requestId = request?.request_id ?? requestIdFromQueueFile(requestFile);
        const taskInfo = request
            ? await loadTaskInfo(request.task_file, session.artifact_root)
            : fallbackTaskInfo(requestId, session.artifact_root);
        const result = compactErrorResult({
            requestId,
            taskId: taskInfo.taskId,
            workerType: taskInfo.workerType,
            status: "failed",
            artifactDir: taskInfo.artifactDir,
            startedAt,
            error,
        });
        writeQueueResult(session.result_dir, requestId, result);
        log(`request ${requestId} failed: ${result.error}`);
    }
    finally {
        if (existsSync(runningFile)) {
            try {
                unlinkSync(runningFile);
            }
            catch { /* non-fatal */ }
        }
    }
}
async function submit(options) {
    if (process.env.CODEX_CLAUDE_CHILD_THREAD !== "1") {
        throw new Error("submit must be invoked from a Codex subagent shell (CODEX_CLAUDE_CHILD_THREAD=1).");
    }
    if (!path.isAbsolute(options.taskFile)) {
        throw new Error(`--task-file must be an absolute path: ${options.taskFile}`);
    }
    if (!path.isAbsolute(options.sessionFile)) {
        throw new Error(`--session-file must be an absolute path: ${options.sessionFile}`);
    }
    const startedAt = Date.now();
    const session = await loadSessionFile(options.sessionFile);
    assertSessionQueuePaths(session);
    assertInside(session.task_dir, session.supervisor_home, "task_dir");
    assertInside(session.queue_dir, session.supervisor_home, "queue_dir");
    assertInside(session.result_dir, session.supervisor_home, "result_dir");
    if (!isInside(options.taskFile, session.task_dir)) {
        throw new Error(`TaskFile does not belong to this session.\n` +
            `  task_file: ${options.taskFile}\n  session.task_dir: ${session.task_dir}`);
    }
    if (!existsSync(session.queue_dir)) {
        throw new Error(`Delegate daemon queue directory is missing: ${session.queue_dir}`);
    }
    if (!existsSync(session.result_dir)) {
        throw new Error(`Delegate daemon result directory is missing: ${session.result_dir}`);
    }
    const daemonError = daemonUnavailableReason(options.sessionFile, session);
    if (daemonError) {
        throw new Error(daemonError);
    }
    const taskInfo = await loadTaskInfo(options.taskFile, session.artifact_root);
    const requestId = `req_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const request = {
        request_id: requestId,
        task_file: options.taskFile,
        session_file: options.sessionFile,
        timeout_sec: options.timeoutSec,
        created_at: new Date().toISOString(),
    };
    writeRequest(session.queue_dir, request);
    const resultFile = path.join(session.result_dir, `${requestId}.json`);
    const waitMs = options.timeoutSec * 1000 + 15_000;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        if (existsSync(resultFile)) {
            const raw = await readFile(resultFile, "utf8");
            return JSON.parse(raw);
        }
        const waitDaemonError = daemonUnavailableReason(options.sessionFile, session);
        if (waitDaemonError) {
            return compactErrorResult({
                requestId,
                taskId: taskInfo.taskId,
                workerType: taskInfo.workerType,
                status: "failed",
                artifactDir: taskInfo.artifactDir,
                startedAt,
                error: waitDaemonError,
            });
        }
        await sleep(POLL_INTERVAL_MS);
    }
    return compactErrorResult({
        requestId,
        taskId: taskInfo.taskId,
        workerType: taskInfo.workerType,
        status: "timeout",
        artifactDir: taskInfo.artifactDir,
        startedAt,
        error: `Timed out waiting for delegate daemon result after ${Math.round(waitMs / 1000)} seconds.`,
    });
}
function writeRequest(queueDir, request) {
    const finalPath = path.join(queueDir, `${request.request_id}.json`);
    const tempPath = `${finalPath}.tmp.${process.pid}`;
    writeFileSync(tempPath, JSON.stringify(request) + "\n", "utf8");
    renameSync(tempPath, finalPath);
}
function writeQueueResult(resultDir, requestId, result) {
    const finalPath = path.join(resultDir, `${requestId}.json`);
    const tempPath = `${finalPath}.tmp.${process.pid}`;
    writeFileSync(tempPath, JSON.stringify(result) + "\n", "utf8");
    renameSync(tempPath, finalPath);
}
function writeCompactJson(result) {
    return new Promise((resolve, reject) => {
        process.stdout.write(`${JSON.stringify(result)}\n`, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function writeReadyFile(readyFile, sessionFile, session) {
    writeFileSync(readyFile, JSON.stringify({
        pid: process.pid,
        ready_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        session_file: sessionFile,
        queue_dir: session.queue_dir,
        result_dir: session.result_dir,
    }, null, 2) + "\n", "utf8");
}
function daemonUnavailableReason(sessionFile, session) {
    if (!session.daemon_pid) {
        return (`Delegate daemon is not registered in this session.\n` +
            `  session_file: ${sessionFile}`);
    }
    if (!isProcessAlive(session.daemon_pid)) {
        return (`Delegate daemon is not running for this session.\n` +
            `  daemon_pid: ${session.daemon_pid}\n` +
            `  session_file: ${sessionFile}`);
    }
    const readyFile = path.join(path.dirname(sessionFile), READY_FILE);
    if (!existsSync(readyFile)) {
        return (`Delegate daemon ready file is missing.\n` +
            `  daemon_pid: ${session.daemon_pid}\n` +
            `  ready_file: ${readyFile}`);
    }
    let ready = {};
    try {
        ready = JSON.parse(readFileSync(readyFile, "utf8"));
    }
    catch {
        return `Delegate daemon ready file is invalid: ${readyFile}`;
    }
    if (typeof ready.pid === "number" && ready.pid !== session.daemon_pid) {
        return (`Delegate daemon ready file pid does not match session daemon_pid.\n` +
            `  daemon_pid: ${session.daemon_pid}\n` +
            `  ready_pid: ${ready.pid}\n` +
            `  ready_file: ${readyFile}`);
    }
    let ageMs;
    try {
        ageMs = Date.now() - statSync(readyFile).mtimeMs;
    }
    catch {
        return (`Delegate daemon ready file is missing.\n` +
            `  daemon_pid: ${session.daemon_pid}\n` +
            `  ready_file: ${readyFile}`);
    }
    if (ageMs > HEARTBEAT_STALE_MS) {
        return (`Delegate daemon heartbeat is stale.\n` +
            `  daemon_pid: ${session.daemon_pid}\n` +
            `  heartbeat_age_ms: ${Math.round(ageMs)}\n` +
            `  ready_file: ${readyFile}`);
    }
    return undefined;
}
async function loadTaskInfo(taskFile, artifactRoot) {
    const parsed = await loadTaskFile(taskFile);
    return {
        taskId: parsed.task_id,
        workerType: parsed.worker_type,
        artifactDir: path.join(artifactRoot, parsed.task_id),
    };
}
function fallbackTaskInfo(requestId, artifactRoot) {
    return {
        taskId: requestId,
        workerType: "readonly",
        artifactDir: path.join(artifactRoot, requestId),
    };
}
function compactErrorResult(args) {
    const error = messageFrom(args.error);
    return {
        request_id: args.requestId,
        task_id: args.taskId,
        worker_type: args.workerType,
        status: args.status,
        exit_code: null,
        duration_ms: Date.now() - args.startedAt,
        artifact_dir: args.artifactDir,
        changed_files: [],
        summary: error,
        error,
    };
}
function nextRequestFile(queueDir) {
    const files = readdirSync(queueDir)
        .filter((name) => name.endsWith(".json"))
        .sort();
    const first = files[0];
    return first ? path.join(queueDir, first) : undefined;
}
function parseRequest(raw, label) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Request file is not valid JSON: ${label}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Request file must be a JSON object: ${label}`);
    }
    const request = parsed;
    if (!request.request_id || typeof request.request_id !== "string") {
        throw new Error(`Request file is missing request_id: ${label}`);
    }
    if (!request.task_file || typeof request.task_file !== "string") {
        throw new Error(`Request file is missing task_file: ${label}`);
    }
    if (!request.session_file || typeof request.session_file !== "string") {
        throw new Error(`Request file is missing session_file: ${label}`);
    }
    if (!Number.isInteger(request.timeout_sec) || Number(request.timeout_sec) <= 0) {
        throw new Error(`Request file has invalid timeout_sec: ${label}`);
    }
    return {
        request_id: request.request_id,
        task_file: request.task_file,
        session_file: request.session_file,
        timeout_sec: Number(request.timeout_sec),
        created_at: typeof request.created_at === "string" ? request.created_at : new Date(0).toISOString(),
    };
}
function parseDaemonArgs(rawArgs) {
    let sessionFile;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--session-file") {
            if (!next)
                throw new Error("--session-file requires a value.");
            sessionFile = next;
            i++;
        }
        else if (arg === "--help" || arg === "-h") {
            process.stdout.write(daemonHelp());
            process.exit(0);
        }
        else {
            throw new Error(`Unknown daemon argument: ${arg}`);
        }
    }
    if (!sessionFile) {
        throw new Error("--session-file is required.");
    }
    if (!path.isAbsolute(sessionFile)) {
        throw new Error(`--session-file must be an absolute path: ${sessionFile}`);
    }
    return { sessionFile };
}
function parseSubmitArgs(rawArgs) {
    let taskFile;
    let sessionFile;
    let timeoutSec = 120;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--task-file") {
            if (!next)
                throw new Error("--task-file requires a value.");
            taskFile = next;
            i++;
        }
        else if (arg === "--session-file") {
            if (!next)
                throw new Error("--session-file requires a value.");
            sessionFile = next;
            i++;
        }
        else if (arg === "--timeout-sec") {
            if (!next)
                throw new Error("--timeout-sec requires a value.");
            timeoutSec = Number(next);
            if (!Number.isInteger(timeoutSec) || timeoutSec <= 0) {
                throw new Error("--timeout-sec must be a positive integer.");
            }
            i++;
        }
        else if (arg === "--help" || arg === "-h") {
            process.stdout.write(submitHelp());
            process.exit(0);
        }
        else {
            throw new Error(`Unknown submit argument: ${arg}`);
        }
    }
    if (!taskFile) {
        taskFile = process.env.CODEX_LEAD_CC_TASK_FILE;
        if (!taskFile)
            throw new Error("--task-file is required.");
    }
    if (!sessionFile) {
        sessionFile = process.env.CODEX_LEAD_CC_SESSION_FILE;
        if (!sessionFile)
            throw new Error("--session-file is required.");
    }
    return { taskFile, sessionFile, timeoutSec };
}
function assertSessionQueuePaths(session) {
    if (!session.queue_dir) {
        throw new Error("Session file is missing queue_dir.");
    }
    if (!session.result_dir) {
        throw new Error("Session file is missing result_dir.");
    }
}
function isInside(child, parent) {
    const c = path.resolve(child);
    const p = path.resolve(parent);
    return c === p || c.startsWith(p + path.sep);
}
function assertInside(child, parent, label) {
    if (!isInside(child, parent)) {
        throw new Error(`${label} must be inside supervisor_home.\n  ${label}: ${child}\n  supervisor_home: ${parent}`);
    }
}
function requestIdFromQueueFile(requestFile) {
    return path.basename(requestFile).replace(/\.json$/, "");
}
function readParentPid() {
    const raw = process.env.CODEX_LEAD_CC_PARENT_PID;
    if (!raw)
        return undefined;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function messageFrom(error) {
    return error instanceof Error ? error.message : String(error);
}
function log(message) {
    process.stderr.write(`[daemon] ${message}\n`);
}
function daemonHelp() {
    return `codex_lead_cc daemon - Run the local delegate daemon
Usage: codex_lead_cc daemon --session-file <path>
`;
}
function submitHelp() {
    return `codex_lead_cc submit - Submit a TaskFile to the local delegate daemon
Usage: CODEX_CLAUDE_CHILD_THREAD=1 codex_lead_cc submit --task-file <path> --session-file <path> [--timeout-sec 120]
`;
}
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    daemonMain(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${messageFrom(error)}\n`);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=delegate_daemon.js.map