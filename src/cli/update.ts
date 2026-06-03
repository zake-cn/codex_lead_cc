import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const DEFAULT_UPDATE_SOURCE = "git+https://github.com/zake-cn/codex_lead_cc.git";
const GIT_INSTALL_ARGS = ["install", "-g", "--install-links=true"];

export interface UpdateOptions {
  source: string;
  dryRun: boolean;
}

export interface InstallSourceInfo {
  type: "local_git_checkout" | "global_or_package_install" | "unknown";
  repo_root: string;
  detail: string;
}

export function parseUpdateArgs(args: string[]): UpdateOptions {
  let source = DEFAULT_UPDATE_SOURCE;
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--from") {
      if (!next) {
        throw new Error("--from requires a Git URL.");
      }
      source = next;
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown update argument: ${arg}`);
  }

  return { source, dryRun };
}

export function detectInstallSource(repoRoot: string): InstallSourceInfo {
  const resolved = path.resolve(repoRoot);
  if (existsSync(path.join(resolved, ".git"))) {
    return {
      type: "local_git_checkout",
      repo_root: resolved,
      detail: "Detected a local git checkout.",
    };
  }
  if (existsSync(path.join(resolved, "package.json"))) {
    return {
      type: "global_or_package_install",
      repo_root: resolved,
      detail: "Detected an installed package directory without a local .git checkout.",
    };
  }
  return {
    type: "unknown",
    repo_root: resolved,
    detail: "Unable to determine installation type.",
  };
}

export function runUpdate(options: UpdateOptions, repoRoot: string): number {
  const installSource = detectInstallSource(repoRoot);
  const commands = commandsForUpdate(installSource, options.source);

  printUpdatePlan(installSource, commands, options.dryRun);
  if (options.dryRun) {
    return 0;
  }

  if (commands.length === 0) {
    printManualUpdateHelp(options.source);
    return 1;
  }

  for (const command of commands) {
    const result = spawnSync(command.command, command.args, {
      cwd: command.cwd,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  process.stdout.write("Update completed.\nMigrating supervisor files with: codex_lead_cc migrate-supervisor\n");
  return 0;
}

function commandsForUpdate(
  installSource: InstallSourceInfo,
  source: string,
): Array<{ command: string; args: string[]; cwd?: string }> {
  if (installSource.type === "local_git_checkout") {
    return [
      { command: "git", args: ["pull"], cwd: installSource.repo_root },
      { command: "npm", args: ["install"], cwd: installSource.repo_root },
      { command: "npm", args: ["run", "build"], cwd: installSource.repo_root },
      { command: "npm", args: ["link"], cwd: installSource.repo_root },
    ];
  }
  if (installSource.type === "global_or_package_install") {
    return [
      { command: "npm", args: [...GIT_INSTALL_ARGS, source] },
    ];
  }
  return [];
}

function printUpdatePlan(
  installSource: InstallSourceInfo,
  commands: Array<{ command: string; args: string[]; cwd?: string }>,
  dryRun: boolean,
): void {
  process.stdout.write(`${installSource.detail}\n`);
  if (dryRun) {
    process.stdout.write("Dry run only. No commands will be executed.\n");
  }
  if (commands.length === 0) {
    return;
  }
  process.stdout.write("Planned update commands:\n");
  for (const command of commands) {
    const cwd = command.cwd ? ` (cwd: ${command.cwd})` : "";
    process.stdout.write(`  ${command.command} ${command.args.join(" ")}${cwd}\n`);
  }
}

function printManualUpdateHelp(source: string): void {
  process.stdout.write(`Unable to determine installation type.
You can update manually with one of:

npm install -g --install-links=true ${source}

or, for a local clone:

git pull
npm install
npm run build
npm link
`);
}
