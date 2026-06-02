import type { BridgeCommandResult, BridgeInputKey, BridgeStatusPayload } from "../types.js";
export type BridgeRequest = {
    type: "send";
    prompt: string;
    timeout_sec: number;
} | {
    type: "input";
    key: BridgeInputKey;
    timeout_sec: number;
} | {
    type: "status";
};
export type BridgeResponse = {
    type: "output";
    data: string;
} | {
    type: "result";
    result: BridgeCommandResult;
} | {
    type: "status";
    status: BridgeStatusPayload;
} | {
    type: "error";
    error: string;
};
export declare function encodeFrame(frame: BridgeRequest | BridgeResponse): string;
export declare function parseFrame(raw: string): BridgeRequest | BridgeResponse;
