# Worker Lifecycle

Workers are lightweight records, not long-lived Claude sessions.

## States

- `idle`: ready for a task.
- `pending`: assigned task is queued or waiting for permission.
- `running`: task runner has started Claude Code.
- `stopped`: worker was stopped by supervisor.

## Roles

- `scout`: read-only project analysis.
- `implementer`: modifies code, defaulting to git worktree isolation.
- `tester`: runs test commands after permission approval.
- `reviewer`: reviews patch and diff artifacts.

Each task starts a fresh Claude Code CLI process.
