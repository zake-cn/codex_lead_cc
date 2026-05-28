import { readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_CONFIG } from "./default_config.js";
import type { AgentForemanConfig } from "../types.js";

export async function loadConfig(projectPath?: string): Promise<AgentForemanConfig> {
  const configPaths = [
    process.env.AGENTFOREMAN_CONFIG,
    projectPath ? path.join(projectPath, ".agentforeman.json") : undefined,
    path.resolve(process.cwd(), ".agentforeman.json"),
  ].filter((value): value is string => Boolean(value));

  let merged: AgentForemanConfig = {
    max_concurrent_workers: DEFAULT_CONFIG.max_concurrent_workers,
    runtime: { ...DEFAULT_CONFIG.runtime },
    worker_idle_timeout_sec: DEFAULT_CONFIG.worker_idle_timeout_sec,
    permission_rules: [...DEFAULT_CONFIG.permission_rules],
  };

  for (const configPath of configPaths) {
    const raw = await readFile(configPath, "utf8").catch(() => undefined);
    if (!raw) {
      continue;
    }
    const parsed = JSON.parse(raw) as Partial<AgentForemanConfig>;
    merged = {
      max_concurrent_workers:
        parsed.max_concurrent_workers ?? merged.max_concurrent_workers,
      runtime: {
        ...merged.runtime,
        ...(parsed.runtime ?? {}),
      },
      worker_idle_timeout_sec:
        parsed.worker_idle_timeout_sec ?? merged.worker_idle_timeout_sec,
      permission_rules: parsed.permission_rules
        ? [...merged.permission_rules, ...parsed.permission_rules]
        : merged.permission_rules,
    };
  }

  if (!Number.isInteger(merged.max_concurrent_workers) || merged.max_concurrent_workers < 1) {
    throw new Error("max_concurrent_workers must be a positive integer.");
  }
  if (!Number.isInteger(merged.worker_idle_timeout_sec) || merged.worker_idle_timeout_sec < 1) {
    throw new Error("worker_idle_timeout_sec must be a positive integer.");
  }

  return merged;
}
