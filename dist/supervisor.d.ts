export declare const SUPERVISOR_RULES_VERSION = 2;
export declare const SUPERVISOR_VERSION_FILE = ".codex_lead_cc_supervisor_version.json";
export interface SupervisorMigrationSummary {
    supervisor_home: string;
    version: number;
    created_files: string[];
    overwritten_files: string[];
    version_file: string;
    stale: boolean;
}
export declare function ensureSupervisorFiles(supervisorHome: string): SupervisorMigrationSummary;
export declare function migrateSupervisorFiles(supervisorHome: string): SupervisorMigrationSummary;
export declare function formatSupervisorMigrationSummary(summary: SupervisorMigrationSummary): string;
export declare function supervisorFiles(): Record<"CLAUDE.md" | "AGENTS.md" | "MEMORY.md", string>;
