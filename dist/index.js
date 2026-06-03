#!/usr/bin/env node
/**
 * codex_lead_cc — Codex-to-Claude-Code Interactive Bridge
 *
 *   codex_lead_cc [codex args...]     Start supervisor session
 *   codex_lead_cc cc-send ...         Send prompt to the current CC Bridge
 *   codex_lead_cc cc-input ...        Send key input to the current CC Bridge
 *   codex_lead_cc cc-status           Read current CC Bridge status
 *   codex_lead_cc migrate-supervisor  Rewrite supervisor rules
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
if (args[0] === "cc-send") {
    const { ccSendMain } = await import("./bridge/cc_client.js");
    await ccSendMain(args.slice(1));
}
else if (args[0] === "cc-input") {
    const { ccInputMain } = await import("./bridge/cc_client.js");
    await ccInputMain(args.slice(1));
}
else if (args[0] === "cc-status") {
    const { ccStatusMain } = await import("./bridge/cc_client.js");
    await ccStatusMain(args.slice(1));
}
else if (args[0] === "delegate" || args[0] === "submit" || args[0] === "daemon") {
    process.stderr.write("Unsupported command. Use only cc-send, cc-input, and cc-status for the CC Bridge.\n");
    process.exitCode = 1;
}
else {
    // All other commands → CLI wrapper
    const child = spawnSync(process.execPath, [cliEntry, ...args], {
        stdio: "inherit",
        env: {
            ...process.env,
            CODEX_LEAD_CC_BIN: process.argv[1],
        },
    });
    if (child.status !== 0)
        process.exitCode = child.status ?? 1;
}
//# sourceMappingURL=index.js.map