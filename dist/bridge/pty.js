import { spawn, spawnSync } from "node:child_process";
export async function startClaudePty(options) {
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
            write(data) { pty.write(data); },
            kill(signal) { pty.kill(signal); },
            onData(listener) { pty.onData(listener); },
            onExit(listener) {
                pty.onExit((event) => listener(event.exitCode, String(event.signal ?? "")));
            },
        };
    }
    return startScriptPty(options);
}
async function loadNodePty() {
    try {
        const loaded = await import("node-pty");
        const candidate = (typeof loaded === "object" && loaded && "default" in loaded
            ? loaded.default
            : loaded);
        return typeof candidate.spawn === "function" ? candidate : undefined;
    }
    catch {
        return undefined;
    }
}
function startScriptPty(options) {
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
function wrapChildProcess(child) {
    const dataListeners = new Set();
    const exitListeners = new Set();
    child.stdout.on("data", (chunk) => {
        for (const listener of dataListeners)
            listener(chunk);
    });
    child.stderr.on("data", (chunk) => {
        for (const listener of dataListeners)
            listener(chunk);
    });
    child.on("error", (error) => {
        for (const listener of dataListeners)
            listener(`\nClaude Code PTY error: ${error.message}\n`);
    });
    child.on("close", (code, signal) => {
        for (const listener of exitListeners)
            listener(code, signal ?? undefined);
    });
    return {
        pid: child.pid,
        write(data) { child.stdin.write(data); },
        kill(signal) { child.kill(signal); },
        onData(listener) { dataListeners.add(listener); },
        onExit(listener) { exitListeners.add(listener); },
    };
}
function stringEnv(env) {
    const out = {};
    for (const [key, value] of Object.entries(env)) {
        if (typeof value === "string")
            out[key] = value;
    }
    return out;
}
function shellJoin(values) {
    return values.map(shellQuote).join(" ");
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
//# sourceMappingURL=pty.js.map