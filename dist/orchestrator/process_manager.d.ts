export declare class ProcessManager {
    startTaskWorker(taskId: string, stateDir: string): number;
    stopPid(pid: number, signal?: NodeJS.Signals): {
        ok: boolean;
        message: string;
    };
    private stopSinglePid;
}
