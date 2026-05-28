# codex_lead_cc

`codex_lead_cc` is a local Supervisor-Worker orchestration runtime for coding agents.

Codex acts as the supervisor: it plans, creates workers, assigns tasks, watches events, approves permissions, reviews reports and diffs, and decides next steps. Claude Code acts as the worker: it reads, implements, tests, and reviews inside boundaries managed by `codex_lead_cc`.

## Status

Phase 0 proved a synchronous local loop:

```text
Codex -> cc_run_task -> claude -p -> JSON report
```

Phase 1 added worker/task management, async execution, status polling, reports, logs, stopping tasks, and an MCP stdio server.

Phase 2 adds engineering controls:

- Permission requests, approvals, rejections, and remembered allow rules.
- Default deny/ask rules for dangerous or environment-changing actions.
- Append-only event log with `cc_get_updates`.
- Basic multi-worker concurrency with `max_concurrent_workers`.
- `scout`, `implementer`, `tester`, and `reviewer` worker roles.
- Git worktree isolation for implementer tasks when the project is a git repository.
- Direct-mode fallback for non-git projects with an explicit event.
- Diff summary and patch artifacts for implementer tasks.
- Per-file diff detail without exposing full source files.
- Structured role-aware reports for implementation, test, and review work.

## Install

```bash
npm install
npm run build
```

Requirements:

- Node.js 20 or newer.
- npm.
- Claude Code CLI available as `claude` on `PATH`.
- Claude Code logged in before assigning tasks.

## Start MCP

```bash
node dist/index.js mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "codex_lead_cc": {
      "command": "node",
      "args": ["/home/hs/code/codex_lead_cc/dist/index.js", "mcp"],
      "cwd": "/home/hs/code/codex_lead_cc"
    }
  }
}
```

## Tools

Phase 1 tools:

- `cc_create_worker`
- `cc_assign_task`
- `cc_get_status`
- `cc_get_report`
- `cc_stop_task`
- `cc_stop_worker`
- `cc_delete_worker`

Phase 2 tools:

- `cc_get_updates`
- `cc_get_pending_permissions`
- `cc_approve_permission`
- `cc_reject_permission`
- `cc_get_diff_summary`
- `cc_get_diff_detail`
- `cc_list_workers`
- `cc_list_tasks`
- `cc_cleanup_worktree`

The tool surface is intentionally managerial. It does not expose `read_file`, `run_shell`, or `edit_file` to Codex.

## CLI Examples

The demo project intentionally starts with failing tests so the Phase 2 flow has a real bug to fix:

```bash
npm run demo:test
```

That baseline failure is expected before an implementer worker repairs `normalize_name()`.

Create a scout:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --role scout
```

Assign a task:

```bash
node dist/index.js cc_assign_task \
  --worker-id ccw_001 \
  --task "Read this project and summarize structure and entry points." \
  --timeout-sec 300
```

Poll events:

```bash
node dist/index.js cc_get_updates --since-event-id 0
```

Create an implementer:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --role implementer
```

Assign implementation work:

```bash
node dist/index.js cc_assign_task \
  --worker-id ccw_002 \
  --task "Fix normalize_name so it title-cases words and keeps greet behavior correct." \
  --timeout-sec 300
```

Get diff summary:

```bash
node dist/index.js cc_get_diff_summary --task-id task_002
```

Get one file diff:

```bash
node dist/index.js cc_get_diff_detail \
  --task-id task_002 \
  --file src/hello.py
```

Create a tester and assign tests:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --role tester

node dist/index.js cc_assign_task \
  --worker-id ccw_003 \
  --target-task-id task_002 \
  --task "Run python3 -m unittest discover -s tests and report commands_run and test_result." \
  --timeout-sec 300
```

Tester tasks create a permission request. Approve it:

```bash
node dist/index.js cc_get_pending_permissions

node dist/index.js cc_approve_permission \
  --request-id perm_001 \
  --decision allow_for_task
```

Create a reviewer:

```bash
node dist/index.js cc_create_worker \
  --project-path examples/demo-project \
  --role reviewer

node dist/index.js cc_assign_task \
  --worker-id ccw_004 \
  --target-task-id task_002 \
  --task "Review the patch from task_002 and return decision, findings, and risks." \
  --timeout-sec 300
```

## Local State

Runtime files are under `.agentforeman/` by default:

```text
.agentforeman/
├─ state.json
├─ logs/
├─ reports/
├─ patches/
├─ worktrees/
└─ tmp/
```

Set `AGENTFOREMAN_HOME` to use a different runtime directory.

Optional config file:

```json
{
  "max_concurrent_workers": 3,
  "permission_rules": []
}
```

Config is loaded from `AGENTFOREMAN_CONFIG`, `<project>/.agentforeman.json`, and `./.agentforeman.json` when present.

## Reports

Reports include common task fields plus role-specific fields:

- Implementer: `files_modified`, `diff_summary`, `patch_path`, `worktree_path`.
- Tester: `commands_run`, `test_result`, `failures`.
- Reviewer: `review_target`, `decision`, `findings`.

## Worktree Behavior

Implementer workers default to isolated worktrees:

```text
.agentforeman/worktrees/task_004_impl/
```

If the project is not a git repository, `codex_lead_cc` records a `worktree_fallback` event and runs in direct mode. Phase 2 recommends using git repositories for implementation tasks so patch artifacts are reliable.

## Phase 0 Compatibility

The synchronous command remains available:

```bash
node dist/index.js cc_run_task \
  --project-path examples/demo-project \
  --task "Read this project and identify the entry file." \
  --timeout-sec 300
```

## Current Limits

- JSON state is still used instead of SQLite.
- Permission gating is modeled at the orchestrator layer; deeper Claude Code permission hooks are reserved for Phase 3.
- Worktree isolation requires git. Non-git projects fall back to direct mode.
- Patch merge and PR creation are not implemented.
- No dashboard, DAG engine, cloud service, or long-lived Claude session pool.
