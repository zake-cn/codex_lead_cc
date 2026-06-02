import { readFileSync } from "node:fs";
import net, { type Socket } from "node:net";
import path from "node:path";
import { stdin as input, stdout } from "node:process";

import type {
  BridgeCommandResult,
  BridgeInputKey,
  BridgeStatusPayload,
  SessionFile,
} from "../types.js";
import { BRIDGE_INPUT_KEYS } from "../types.js";
import { encodeFrame, parseFrame, type BridgeRequest, type BridgeResponse } from "./protocol.js";

const NO_ACTIVE_BRIDGE =
  "No active codex_lead_cc bridge found in this process environment.";

interface BridgeEnv {
  socketPath: string;
  sessionFile: string;
  sessionId: string;
}

export async function ccSendMain(rawArgs: string[]): Promise<void> {
  const options = await parseSendArgs(rawArgs);
  const result = await streamBridgeRequest({
    type: "send",
    prompt: options.prompt,
    timeout_sec: options.timeoutSec,
  });
  writeStatusFooter(result);
  if (!["completed", "needs_permission"].includes(result.status)) {
    process.exitCode = 1;
  }
}

export async function ccInputMain(rawArgs: string[]): Promise<void> {
  const options = parseInputArgs(rawArgs);
  const result = await streamBridgeRequest({
    type: "input",
    key: options.key,
    timeout_sec: options.timeoutSec,
  });
  writeStatusFooter(result);
  if (!["completed", "needs_permission"].includes(result.status)) {
    process.exitCode = 1;
  }
}

export async function ccStatusMain(_rawArgs: string[]): Promise<void> {
  const status = await requestBridgeStatus();
  stdout.write(`${JSON.stringify(status, null, 2)}\n`);
}

async function streamBridgeRequest(request: BridgeRequest): Promise<BridgeCommandResult> {
  const env = loadBridgeEnv();
  validateSessionBinding(env);
  return new Promise((resolve, reject) => {
    const client = connect(env);
    let buffer = "";
    let resolved = false;

    client.on("connect", () => {
      client.write(encodeFrame(request));
    });
    client.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const frame = parseFrame(raw) as BridgeResponse;
        if (frame.type === "output") {
          stdout.write(frame.data);
        } else if (frame.type === "result") {
          resolved = true;
          resolve(frame.result);
          client.end();
        } else if (frame.type === "error") {
          resolved = true;
          reject(new Error(frame.error));
          client.end();
        }
      }
    });
    client.on("error", reject);
    client.on("close", () => {
      if (!resolved) {
        reject(new Error("codex_lead_cc bridge connection closed before a result was returned."));
      }
    });
  });
}

async function requestBridgeStatus(): Promise<BridgeStatusPayload> {
  const env = loadBridgeEnv();
  validateSessionBinding(env);
  return new Promise((resolve, reject) => {
    const client = connect(env);
    let buffer = "";
    let resolved = false;

    client.on("connect", () => {
      client.write(encodeFrame({ type: "status" }));
    });
    client.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const frame = parseFrame(raw) as BridgeResponse;
        if (frame.type === "status") {
          resolved = true;
          resolve(frame.status);
          client.end();
        } else if (frame.type === "error") {
          resolved = true;
          reject(new Error(frame.error));
          client.end();
        }
      }
    });
    client.on("error", reject);
    client.on("close", () => {
      if (!resolved) {
        reject(new Error("codex_lead_cc bridge connection closed before status was returned."));
      }
    });
  });
}

function connect(env: BridgeEnv): Socket {
  return net.createConnection(env.socketPath);
}

function loadBridgeEnv(): BridgeEnv {
  const socketPath = process.env.CODEX_LEAD_CC_BRIDGE_SOCKET;
  const sessionFile = process.env.CODEX_LEAD_CC_SESSION_FILE;
  const sessionId = process.env.CODEX_LEAD_CC_SESSION_ID;
  if (!socketPath || !sessionFile || !sessionId) {
    throw new Error(NO_ACTIVE_BRIDGE);
  }
  if (!path.isAbsolute(socketPath) || !path.isAbsolute(sessionFile)) {
    throw new Error(NO_ACTIVE_BRIDGE);
  }
  return { socketPath, sessionFile, sessionId };
}

function validateSessionBinding(env: BridgeEnv): void {
  let session: Partial<SessionFile>;
  try {
    session = JSON.parse(readFileSync(env.sessionFile, "utf8")) as Partial<SessionFile>;
  } catch {
    throw new Error(NO_ACTIVE_BRIDGE);
  }
  if (session.session_id !== env.sessionId || session.bridge_socket !== env.socketPath) {
    throw new Error(NO_ACTIVE_BRIDGE);
  }
}

async function parseSendArgs(rawArgs: string[]): Promise<{ prompt: string; timeoutSec: number }> {
  let timeoutSec = 120;
  const promptArgs: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === "--timeout-sec") {
      if (!next) throw new Error("--timeout-sec requires a value.");
      timeoutSec = positiveInteger(next, "--timeout-sec");
      i++;
    } else if (arg === "--help" || arg === "-h") {
      stdout.write(ccSendHelp());
      process.exit(0);
    } else {
      promptArgs.push(arg);
    }
  }

  const prompt = promptArgs.length > 0 ? promptArgs.join(" ") : await readStdin();
  if (!prompt.trim()) {
    throw new Error("cc-send requires a prompt from argv or stdin.");
  }
  return { prompt, timeoutSec };
}

function parseInputArgs(rawArgs: string[]): { key: BridgeInputKey; timeoutSec: number } {
  let timeoutSec = 120;
  let key: BridgeInputKey | undefined;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const next = rawArgs[i + 1];
    if (arg === "--key") {
      if (!next) throw new Error("--key requires a value.");
      if (!isBridgeInputKey(next)) {
        throw new Error("--key must be one of: 1, 2, 3, enter, escape, ctrl-c.");
      }
      key = next;
      i++;
    } else if (arg === "--timeout-sec") {
      if (!next) throw new Error("--timeout-sec requires a value.");
      timeoutSec = positiveInteger(next, "--timeout-sec");
      i++;
    } else if (arg === "--help" || arg === "-h") {
      stdout.write(ccInputHelp());
      process.exit(0);
    } else {
      throw new Error(`Unknown cc-input argument: ${arg}`);
    }
  }
  if (!key) throw new Error("cc-input requires --key.");
  return { key, timeoutSec };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => { data += chunk; });
    input.on("end", () => resolve(data));
    input.on("error", reject);
  });
}

function positiveInteger(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function isBridgeInputKey(value: string): value is BridgeInputKey {
  return (BRIDGE_INPUT_KEYS as readonly string[]).includes(value);
}

function writeStatusFooter(result: BridgeCommandResult): void {
  stdout.write(`\n<<<CODEX_LEAD_CC_STATUS>>>\n${JSON.stringify(result)}\n<<<CODEX_LEAD_CC_STATUS_END>>>\n`);
}

function ccSendHelp(): string {
  return `codex_lead_cc cc-send - Send a prompt to the current Claude Code bridge
Usage:
  codex_lead_cc cc-send [--timeout-sec 120] "prompt"
  codex_lead_cc cc-send [--timeout-sec 120] < prompt.txt
`;
}

function ccInputHelp(): string {
  return `codex_lead_cc cc-input - Send a key to the current Claude Code bridge
Usage: codex_lead_cc cc-input --key <1|2|3|enter|escape|ctrl-c> [--timeout-sec 120]
`;
}
