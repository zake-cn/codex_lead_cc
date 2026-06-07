#!/usr/bin/env node
import type { BridgeInputKey, SessionFile } from "../types.js";
import { type ClaudePty } from "./pty.js";
export declare class CcBridge {
    private readonly sessionFile;
    private readonly session;
    private readonly pty;
    private state;
    private readonly screen;
    private readonly detector;
    private lastOutputAt;
    private lastOutput;
    private spinnerDetected;
    private permissionPromptDetected;
    private suggestedKeys;
    private active;
    private inboxTimer;
    private recoveryTimer;
    private disposingForTest;
    private readonly inboxDir;
    private readonly streamsDir;
    private readonly resultsDir;
    private readonly rawOutputLog;
    constructor(sessionFile: string, session: SessionFile, pty: ClaudePty);
    start(): void;
    private processInbox;
    private handleRequest;
    private handleSend;
    private handleInput;
    private startInteraction;
    private sendPromptToClaude;
    private onPtyOutput;
    private onPtyExit;
    private checkCompletion;
    private finishActive;
    private writeImmediateResult;
    private buildFinalOutput;
    private buildImmediateOutput;
    private updateActiveOutputDetection;
    private inputBoxStillContainsPrompt;
    private writeDebugFinish;
    private writeImmediateDebug;
    private decisionPayload;
    private refreshScreenDetection;
    private statusPayload;
    private writeState;
    private nextRequestFile;
    private parseRequest;
    private startRecoveryTimer;
    tickRecovery(now?: number): void;
    private cancelRecoveryTimer;
    /**
     * TEST-ONLY.  Cancel all timers, drop the active interaction silently,
     * and stop the PTY so the test harness can safely remove the temp
     * session directory.  Does NOT call finishActive / writeState /
     * writeJsonAtomic — no result files are created or overwritten.
     *
     * Callers MUST `await` a short event-loop tick after this returns
     * before rmSync'ing the session directory, so any in-flight PTY exit
     * event (which is a no-op thanks to the disposingForTest gate) has
     * time to settle.
     */
    disposeForTest(): void;
    private shutdown;
}
export declare function bridgeMain(rawArgs: string[]): Promise<void>;
export declare function inputKeyToBytes(key: BridgeInputKey): string;
export declare function isInputEcho(sentText: string, plainOutput: string): boolean;
export declare function cleanFinalText(value: string, sentText: string): string;
