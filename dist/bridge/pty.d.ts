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
export declare function startClaudePty(options: ClaudePtyOptions): Promise<ClaudePty>;
