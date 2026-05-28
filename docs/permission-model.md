# Permission Model

Phase 2 introduced permissions in `codex_lead_cc`; Phase 3 keeps that model and wires it into the DAG scheduler. Ready tasks are checked before execution, and tasks that need approval move to `waiting_permission`.

## Effects

- `allow`: task may proceed.
- `ask`: task waits for supervisor approval.
- `deny`: task is blocked by policy.

## Risk Levels

- `read`: project inspection.
- `safe_write`: implementation inside managed worktree.
- `test`: test commands such as `pytest`, `npm test`, or `python3 -m unittest`.
- `environment`: dependency or environment changes such as `npm install` or `pip install`.
- `danger`: destructive or sensitive actions such as `rm -rf`, `sudo`, `curl`, `.env`, `~/.ssh`, or `.git` modification.

## Tools

- `cc_get_pending_permissions`
- `cc_approve_permission`
- `cc_reject_permission`

Approvals can be one-time, task-scoped, or project-scoped.

The model is still orchestrator-level. A deeper Claude Code permission hook adapter remains a future extension.
