import type {
  BridgeCommandResult,
  BridgeInputKey,
  BridgeStatusPayload,
} from "../types.js";

export type BridgeRequest =
  | { type: "send"; prompt: string; timeout_sec: number }
  | { type: "input"; key: BridgeInputKey; timeout_sec: number }
  | { type: "status" };

export type BridgeResponse =
  | { type: "output"; data: string }
  | { type: "result"; result: BridgeCommandResult }
  | { type: "status"; status: BridgeStatusPayload }
  | { type: "error"; error: string };

export function encodeFrame(frame: BridgeRequest | BridgeResponse): string {
  return `${JSON.stringify(frame)}\n`;
}

export function parseFrame(raw: string): BridgeRequest | BridgeResponse {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bridge frame must be a JSON object.");
  }
  return parsed as BridgeRequest | BridgeResponse;
}
