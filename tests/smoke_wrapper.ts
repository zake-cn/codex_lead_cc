import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const wrapperPath = path.resolve("dist/cli/codex_lead_cc.js");
assert.ok(existsSync(wrapperPath), "wrapper must be built before running smoke:wrapper");

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  bin: Record<string, string>;
  scripts: Record<string, string>;
};
const removedDashedCommand = ["codex", "lead", "cc"].join("-");
const loggedPhrase = ["logged", "in"].join(" ");
const apiKeyPhrase = ["api", "key"].join(" ");
assert.deepEqual(Object.keys(packageJson.bin), ["codex_lead_cc"]);
assert.equal(packageJson.bin.codex_lead_cc, "dist/cli/codex_lead_cc.js");
assert.ok(!(removedDashedCommand in packageJson.bin));
assert.ok(!("prepare" in packageJson.scripts), "Git URL install must not run a prepare build");
assert.ok(!("prepack" in packageJson.scripts), "Git URL install must not run a prepack build");
assert.equal(packageJson.scripts.build, "tsc -p tsconfig.json");

const readme = readFileSync("README.md", "utf8");
assert.ok(!readme.includes(removedDashedCommand));
assert.ok(!new RegExp(loggedPhrase, "i").test(readme));

const codexConfig = path.join(os.homedir(), ".codex", "config.toml");
const beforeMtime = existsSync(codexConfig) ? statSync(codexConfig).mtimeMs : undefined;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "codex_lead_cc_wrapper_"));

try {
  const dryRun = runWrapper(["--dry-run"], tempHome);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const parsed = JSON.parse(dryRun.stdout) as {
    command: string;
    mode: string;
    exposure: string;
    args: string[];
    notes: string[];
  };
  assert.equal(parsed.command, "codex");
  assert.equal(parsed.mode, "supervisor");
  assert.equal(parsed.exposure, "compact");
  assert.ok(parsed.args.includes("mcp_servers.codex_lead_cc.command=" + JSON.stringify(process.execPath)));
  assert.ok(parsed.args.some((arg) => arg.includes("--exposure") || arg.includes("compact")));
  assert.ok(parsed.notes.some((note) => /does not edit/i.test(note)));

  const devDryRun = runWrapper(["--mode", "dev", "--dry-run"], tempHome);
  assert.equal(devDryRun.status, 0, devDryRun.stderr);
  assert.equal((JSON.parse(devDryRun.stdout) as { exposure: string }).exposure, "full");

  const config = runWrapper(["--print-config"], tempHome);
  assert.equal(config.status, 0, config.stderr);
  assert.match(config.stdout, /\[mcp_servers\.codex_lead_cc\]/);
  assert.match(config.stdout, /--exposure", "compact"/);

  const doctor = runWrapper(["--doctor"], tempHome);
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorJson = JSON.parse(doctor.stdout) as { checks: Array<{ name: string; ok: boolean }> };
  assert.ok(doctorJson.checks.some((check) => check.name === "config_isolation" && check.ok));
  assert.ok(doctorJson.checks.some((check) => check.name === "claude_available"));
  assert.ok(doctorJson.checks.some((check) => check.name === "claude_launchable"));
  assert.ok(!new RegExp(`${loggedPhrase}|login required|${apiKeyPhrase}`, "i").test(doctor.stdout));

  const help = runWrapper(["--help"], tempHome);
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes("codex_lead_cc update"));
  assert.ok(!help.stdout.includes(removedDashedCommand));

  const update = runWrapper(["update", "--dry-run"], tempHome);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /Dry run only/);
  assert.match(update.stdout, /npm install -g --install-links=true git\+https:\/\/github\.com\/zake-cn\/codex_lead_cc\.git|git pull/);

  const afterMtime = existsSync(codexConfig) ? statSync(codexConfig).mtimeMs : undefined;
  assert.equal(afterMtime, beforeMtime, "wrapper smoke must not modify default Codex config");

  process.stdout.write("smoke:wrapper passed\n");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function runWrapper(args: string[], tempHome: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [wrapperPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_LEAD_CC_HOME: path.join(tempHome, ".codex_lead_cc"),
    },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
