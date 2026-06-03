import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface ClaudePty {
  pid: number | undefined;
  write(data: string): void;
  kill(signal?: NodeJS.Signals): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (exitCode: number | null, signal?: string) => void): void;
}

export interface ClaudePtyOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

interface NodePtyProcess {
  pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

interface NodePtyModule {
  spawn(
    command: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): NodePtyProcess;
}

export async function startClaudePty(options: ClaudePtyOptions): Promise<ClaudePty> {
  const nodePty = await loadNodePty();
  if (nodePty) {
    const pty = nodePty.spawn(options.command, options.args, {
      name: "xterm-256color",
      cols: options.cols ?? 120,
      rows: options.rows ?? 40,
      cwd: options.cwd,
      env: stringEnv({ ...options.env, TERM: "xterm-256color" }),
    });
    return {
      pid: pty.pid,
      write(data: string) { pty.write(data); },
      kill(signal?: NodeJS.Signals) { pty.kill(signal); },
      onData(listener) { pty.onData(listener); },
      onExit(listener) {
        pty.onExit((event) => listener(event.exitCode, String(event.signal ?? "")));
      },
    };
  }

  if (process.env.CODEX_LEAD_CC_ALLOW_PTY_FALLBACK !== "1") {
    throw new Error("node-pty is required for interactive Claude Code bridge.");
  }
  return startScriptPty(options);
}

async function loadNodePty(): Promise<NodePtyModule | undefined> {
  try {
    const loaded = await import("node-pty") as unknown;
    const candidate = (
      typeof loaded === "object" && loaded && "default" in loaded
        ? (loaded as { default: unknown }).default
        : loaded
    ) as Partial<NodePtyModule>;
    return typeof candidate.spawn === "function" ? candidate as NodePtyModule : undefined;
  } catch {
    return undefined;
  }
}

function startScriptPty(options: ClaudePtyOptions): ClaudePty {
  const scriptAvailable = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;
  const child = scriptAvailable
    ? spawn("script", ["-qfec", shellJoin([options.command, ...options.args]), "/dev/null"], {
        cwd: options.cwd,
        env: { ...options.env, TERM: "xterm-256color" },
        stdio: ["pipe", "pipe", "pipe"],
      })
    : spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  return wrapChildProcess(child);
}

function wrapChildProcess(child: ChildProcessWithoutNullStreams): ClaudePty {
  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(exitCode: number | null, signal?: string) => void>();

  child.stdout.on("data", (chunk: string) => {
    for (const listener of dataListeners) listener(chunk);
  });
  child.stderr.on("data", (chunk: string) => {
    for (const listener of dataListeners) listener(chunk);
  });
  child.on("error", (error) => {
    for (const listener of dataListeners) listener(`\nClaude Code PTY error: ${error.message}\n`);
  });
  child.on("close", (code, signal) => {
    for (const listener of exitListeners) listener(code, signal ?? undefined);
  });

  return {
    pid: child.pid,
    write(data: string) { child.stdin.write(data); },
    kill(signal?: NodeJS.Signals) { child.kill(signal); },
    onData(listener) { dataListeners.add(listener); },
    onExit(listener) { exitListeners.add(listener); },
  };
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function shellJoin(values: string[]): string {
  return values.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
