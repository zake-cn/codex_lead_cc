# Roadmap

## Phase 0: Synchronous Prototype

Completed.

- `cc_run_task`
- `claude -p`
- stdout/stderr/exit code capture
- structured JSON report

## Phase 1: MVP Orchestrator

Completed.

- MCP stdio server
- worker/task records
- async task execution
- status/report/stop tools
- logs and JSON persistence

## Phase 2: Engineering Controls

Completed.

- Permission requests and approval tools
- Event log and `cc_get_updates`
- `tester` and `reviewer` roles
- Basic queue and `max_concurrent_workers`
- Git worktree isolation for implementer workers
- Patch and diff summary artifacts
- Role-aware structured reports
- Demo flow: scout -> implementer -> tester -> reviewer

## Phase 3: GitHub-Showcase Local Runtime

Completed in this milestone.

- Plan versioning and change reasons
- Basic task DAG with blocked/ready/skipped transitions
- Worker session metadata, health checks, restart, and idle cleanup
- Claude Code adapter abstraction with CLI adapter and SDK fallback scaffold
- Metrics for runtime, raw logs, structured reports, compression ratio, permissions, and patches
- Benchmark task set and sample result
- Local status dashboard with `status --watch`
- Expanded README and architecture docs

## Phase 4: Supervisor Wait Mode

Completed in this milestone.

- Supervisor state tracking
- Supervisor inbox notifications
- Central wake policy
- `cc_wait_for_events` long polling
- Lightweight wake packets with lazy report loading
- `cc_get_report` summary/full/raw levels
- Status dashboard display for supervisor state and unread inbox
- Wait-mode smoke test

## Later Candidates

- Real Claude Code SDK runtime implementation
- Deeper command-level permission interception
- Patch apply/merge flow with supervisor approval
- Optional SQLite persistence
- More complete benchmark harness
- Optional read-only web dashboard
- PR creation as an explicit opt-in action

## Out Of Scope

- Cloud service
- Multi-user auth
- Distributed execution
- Model marketplace
- Enterprise permission system
- Automatic spending or API quota management
