export declare const DEFAULT_UPDATE_SOURCE = "git+https://github.com/zake-cn/codex_lead_cc.git";
export interface UpdateOptions {
    source: string;
    dryRun: boolean;
}
export interface InstallSourceInfo {
    type: "local_git_checkout" | "global_or_package_install" | "unknown";
    repo_root: string;
    detail: string;
}
export declare function parseUpdateArgs(args: string[]): UpdateOptions;
export declare function detectInstallSource(repoRoot: string): InstallSourceInfo;
export declare function runUpdate(options: UpdateOptions, repoRoot: string): number;
