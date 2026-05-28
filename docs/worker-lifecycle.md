# Worker Lifecycle

Workers are local orchestration records with session metadata. Phase 3 does not require a permanent Claude Code process for every worker, but it records enough session state for health checks, restart, and idle cleanup.

## States

- `idle`: ready for a task.
- `pending`: assigned task is queued or waiting for dependencies/permission.
- `running`: task runner has started Claude Code.
- `busy`: reserved session state for longer-running adapters.
- `stopped`: worker was stopped by the supervisor.
- `crashed`: reserved state for failed adapter/session health.

## Roles

- `scout`: read-only project analysis.
- `implementer`: modifies code, defaulting to git worktree isolation.
- `tester`: runs test commands after permission approval.
- `reviewer`: reviews patch and diff artifacts.

## Sessions

Each worker has:

- `session_id`
- `runtime`: `claude_cli` or `claude_sdk`
- `last_active_at`
- `idle_timeout_sec`

The CLI runtime still uses per-task Claude Code processes. The session abstraction is intentionally metadata-first so the SDK adapter can later attach stronger context reuse.

## Health Tools

```bash
node dist/index.js cc_get_worker_health --worker-id ccw_001
node dist/index.js cc_restart_worker --worker-id ccw_001
node dist/index.js cc_cleanup_idle_workers --project-id demo-project --dry-run true
```
