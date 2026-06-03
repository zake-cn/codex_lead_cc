import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { stdin as input, stdout } from "node:process";
import { BRIDGE_INPUT_KEYS } from "../types.js";
const NO_ACTIVE_BRIDGE = "No active codex_lead_cc bridge found in this process environment.\n" +
    "This command must be run inside a Codex session launched by codex_lead_cc.";
export async function ccSendMain(rawArgs) {
    const options = await parseSendArgs(rawArgs);
    const result = await runFileBridgeRequest({
        type: "send",
        request_id: makeRequestId(),
        prompt: options.prompt,
        timeout_sec: options.timeoutSec,
        created_at: new Date().toISOString(),
    });
    writeStatusFooter(result);
    if (!["completed", "needs_permission"].includes(result.status)) {
        process.exitCode = 1;
    }
}
export async function ccInputMain(rawArgs) {
    const options = parseInputArgs(rawArgs);
    const result = await runFileBridgeRequest({
        type: "input",
        request_id: makeRequestId(),
        key: options.key,
        timeout_sec: options.timeoutSec,
        created_at: new Date().toISOString(),
    });
    writeStatusFooter(result);
    if (!["completed", "needs_permission"].includes(result.status)) {
        process.exitCode = 1;
    }
}
export async function ccStatusMain(_rawArgs) {
    const env = loadBridgeEnv();
    const status = readBridgeStatus(env);
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}
async function runFileBridgeRequest(request) {
    const env = loadBridgeEnv();
    ensureBridgeDirs(env);
    writeRequest(env, request);
    return streamUntilResult(env, request);
}
async function streamUntilResult(env, request) {
    const streamFile = path.join(env.streamsDir, `${request.request_id}.log`);
    const resultFile = path.join(env.resultsDir, `${request.request_id}.json`);
    const deadline = Date.now() + request.timeout_sec * 1_000 + 15_000;
    let offset = 0;
    while (Date.now() < deadline) {
        offset = flushStream(streamFile, offset);
        if (existsSync(resultFile)) {
            offset = flushStream(streamFile, offset);
            return parseResult(resultFile);
        }
        await sleep(100);
    }
    return {
        status: "timeout",
        error: `Timed out waiting for bridge result for request ${request.request_id}.`,
    };
}
function flushStream(streamFile, offset) {
    if (!existsSync(streamFile))
        return offset;
    const size = statSync(streamFile).size;
    if (size <= offset)
        return offset;
    const raw = readFileSync(streamFile);
    stdout.write(raw.subarray(offset));
    return size;
}
function parseResult(resultFile) {
    const parsed = JSON.parse(readFileSync(resultFile, "utf8"));
    if (!parsed || typeof parsed.status !== "string") {
        throw new Error(`Bridge result is invalid: ${resultFile}`);
    }
    return parsed;
}
function writeRequest(env, request) {
    const finalPath = path.join(env.inboxDir, `${request.request_id}.json`);
    const tempPath = `${finalPath}.tmp.${process.pid}`;
    writeFileSync(tempPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
    renameSync(tempPath, finalPath);
}
function readBridgeStatus(env) {
    if (!existsSync(env.stateFile)) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    const status = JSON.parse(readFileSync(env.stateFile, "utf8"));
    if (status.session_id !== env.sessionId) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    return status;
}
function loadBridgeEnv() {
    const sessionFile = process.env.CODEX_LEAD_CC_SESSION_FILE;
    const sessionId = process.env.CODEX_LEAD_CC_SESSION_ID;
    if (!sessionFile || !sessionId || !path.isAbsolute(sessionFile)) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    let session;
    try {
        session = JSON.parse(readFileSync(sessionFile, "utf8"));
    }
    catch {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    if (session.version !== 2 || session.session_id !== sessionId) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    const bridgeDir = process.env.CODEX_LEAD_CC_BRIDGE_DIR || session.bridge_dir;
    const stateFile = process.env.CODEX_LEAD_CC_BRIDGE_STATE || session.bridge_state_file;
    if (!bridgeDir || !stateFile || !path.isAbsolute(bridgeDir) || !path.isAbsolute(stateFile)) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    if (bridgeDir !== session.bridge_dir || stateFile !== session.bridge_state_file) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    return {
        sessionFile,
        sessionId,
        bridgeDir,
        stateFile,
        inboxDir: path.join(bridgeDir, "inbox"),
        streamsDir: path.join(bridgeDir, "streams"),
        resultsDir: path.join(bridgeDir, "results"),
    };
}
function ensureBridgeDirs(env) {
    if (!existsSync(env.bridgeDir) || !existsSync(env.inboxDir) || !existsSync(env.resultsDir)) {
        throw new Error(NO_ACTIVE_BRIDGE);
    }
    mkdirSync(env.streamsDir, { recursive: true });
}
async function parseSendArgs(rawArgs) {
    let timeoutSec = 120;
    const promptArgs = [];
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--timeout-sec") {
            if (!next)
                throw new Error("--timeout-sec requires a value.");
            timeoutSec = positiveInteger(next, "--timeout-sec");
            i++;
        }
        else if (arg === "--help" || arg === "-h") {
            stdout.write(ccSendHelp());
            process.exit(0);
        }
        else {
            promptArgs.push(arg);
        }
    }
    const prompt = promptArgs.length > 0 ? promptArgs.join(" ") : await readStdin();
    if (!prompt.trim()) {
        throw new Error("cc-send requires a prompt from argv or stdin.");
    }
    return { prompt, timeoutSec };
}
function parseInputArgs(rawArgs) {
    let timeoutSec = 120;
    let key;
    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        const next = rawArgs[i + 1];
        if (arg === "--key") {
            if (!next)
                throw new Error("--key requires a value.");
            if (!isBridgeInputKey(next)) {
                throw new Error("--key must be one of: 1, 2, 3, enter, escape, ctrl-c.");
            }
            key = next;
            i++;
        }
        else if (arg === "--timeout-sec") {
            if (!next)
                throw new Error("--timeout-sec requires a value.");
            timeoutSec = positiveInteger(next, "--timeout-sec");
            i++;
        }
        else if (arg === "--help" || arg === "-h") {
            stdout.write(ccInputHelp());
            process.exit(0);
        }
        else {
            throw new Error(`Unknown cc-input argument: ${arg}`);
        }
    }
    if (!key)
        throw new Error("cc-input requires --key.");
    return { key, timeoutSec };
}
function readStdin() {
    return new Promise((resolve, reject) => {
        let data = "";
        input.setEncoding("utf8");
        input.on("data", (chunk) => { data += chunk; });
        input.on("end", () => resolve(data));
        input.on("error", reject);
    });
}
function positiveInteger(raw, label) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return value;
}
function isBridgeInputKey(value) {
    return BRIDGE_INPUT_KEYS.includes(value);
}
function writeStatusFooter(result) {
    stdout.write(`\n<<<CODEX_LEAD_CC_STATUS>>>\n${JSON.stringify(result)}\n<<<CODEX_LEAD_CC_STATUS_END>>>\n`);
}
function makeRequestId() {
    return `req_${Date.now()}_${randomUUID().slice(0, 8)}`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function ccSendHelp() {
    return `codex_lead_cc cc-send - Send a prompt to the current Claude Code bridge
Usage:
  codex_lead_cc cc-send [--timeout-sec 120] "prompt"
  codex_lead_cc cc-send [--timeout-sec 120] < prompt.txt
`;
}
function ccInputHelp() {
    return `codex_lead_cc cc-input - Send a key to the current Claude Code bridge
Usage: codex_lead_cc cc-input --key <1|2|3|enter|escape|ctrl-c> [--timeout-sec 120]
`;
}
//# sourceMappingURL=cc_client.js.map