# MCP Tools

The MCP surface is intentionally managerial. It does not expose direct file reads, shell commands, or edit operations to Codex.

## Task And Worker Tools

- `cc_run_task`
- `cc_create_worker`
- `cc_assign_task`
- `cc_get_status`
- `cc_get_report`
- `cc_stop_task`
- `cc_stop_worker`
- `cc_delete_worker`
- `cc_list_workers`
- `cc_list_tasks`

## Permission And Event Tools

- `cc_get_updates`
- `cc_get_pending_permissions`
- `cc_approve_permission`
- `cc_reject_permission`

## Patch Tools

- `cc_get_diff_summary`
- `cc_get_diff_detail`
- `cc_cleanup_worktree`

## Phase 3 Tools

- `cc_create_plan`
- `cc_get_plan`
- `cc_update_plan`
- `cc_list_plans`
- `cc_get_metrics`
- `cc_restart_worker`
- `cc_get_worker_health`
- `cc_cleanup_idle_workers`

## Design Rule

Every tool returns management state or structured artifacts. Codex reviews reports and diffs, but Claude Code remains responsible for tactical project interaction.
