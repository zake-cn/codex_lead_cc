# Roadmap

## Phase 0: Synchronous Prototype

Completed.

- `cc_run_task`
- `claude -p`
- stdout/stderr/exit code capture
- JSON report

## Phase 1: MVP Orchestrator

Completed.

- MCP stdio server
- worker/task records
- async task execution
- status/report/stop tools
- logs and JSON persistence

## Phase 2: Engineering Controls

Current phase.

- Permission requests and approval tools
- Event log and `cc_get_updates`
- `tester` and `reviewer` roles
- Basic queue and max concurrent workers
- Git worktree isolation for implementer workers
- Patch and diff summary artifacts
- Role-aware structured reports
- Demo flow: scout -> implementer -> tester -> reviewer

## Phase 3: Deeper Agent Runtime

- Claude Code permission hook adapter
- More reliable command-level permission interception
- Safer merge/apply flow for patches
- Better stale process recovery
- Optional SQLite persistence
- Optional PR creation

## Not Planned For Phase 2

- Web dashboard
- Distributed execution
- Long-lived Claude session pool
- Complex DAG scheduler
- Cost accounting
- Cloud service
