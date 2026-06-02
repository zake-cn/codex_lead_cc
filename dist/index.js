#!/usr/bin/env node
/**
 * codex_lead_cc — Codex Lead Supervisor Launcher
 *
 *   codex_lead_cc [codex args...]     Start supervisor session
 *   codex_lead_cc delegate ...        Execute delegated task (subagent only)
 *   codex_lead_cc --doctor            Environment diagnostics
 *   codex_lead_cc update [...]        Self-update
 *   codex_lead_cc config <action>     Manage user config
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const wrapperDir = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.join(wrapperDir, "cli", "codex_lead_cc.js");
const args = process.argv.slice(2);
if (args[0] === "delegate") {
    // Handle delegate inline (no subprocess overhead)
    const { delegateMain } = await import("./delegate/delegate_runner.js");
    await delegateMain(args.slice(1));
}
else {
    // All other commands → CLI wrapper
    const child = spawnSync(process.execPath, [cliEntry, ...args], {
        stdio: "inherit",
        env: process.env,
    });
    if (child.status !== 0)
        process.exitCode = child.status ?? 1;
}
//# sourceMappingURL=index.js.map