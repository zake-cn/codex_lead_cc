# Architecture

`codex_lead_cc` is a local Supervisor-Worker runtime.

## Control Boundary

Codex does not directly read project source, run shell commands, or edit files. It calls management tools:

- create/list workers
- assign/stop tasks
- poll events
- approve/reject permissions
- read reports
- read diff summaries/details

Claude Code performs tactical work inside a project directory or managed worktree.

## Phase 2 Components

- `mcp/server.ts`: MCP stdio tool surface.
- `tools/*`: stable tool wrappers.
- `orchestrator/task_manager.ts`: task records, assignment, reports, stopping.
- `orchestrator/worker_manager.ts`: worker lifecycle.
- `orchestrator/scheduler.ts`: simple queue and `max_concurrent_workers`.
- `orchestrator/permission_engine.ts`: allow/ask/deny rules and approval state.
- `orchestrator/event_log.ts`: event polling.
- `orchestrator/worktree_manager.ts`: git worktree isolation.
- `orchestrator/diff_manager.ts`: patch and diff artifacts.
- `orchestrator/state_store.ts`: JSON state with a lightweight lock.
- `orchestrator/task_worker_entry.ts`: detached background runner.

## Runtime Flow

```text
Codex -> MCP tool -> TaskManager
                 -> PermissionEngine
                 -> Scheduler
                 -> detached task_worker_entry
                 -> WorktreeManager
                 -> Claude Code CLI
                 -> DiffManager
                 -> report/events/state
```

## State

Phase 2 keeps JSON state for simplicity:

```text
.agentforeman/state.json
```

The state includes workers, tasks, events, permission requests, permission rules, and artifacts.

SQLite remains a possible future upgrade.
