# Worktree And Patch

Implementer workers default to isolated git worktrees.

## Worktree Path

```text
.agentforeman/worktrees/task_004_impl/
```

If the target project is not a git repository, the orchestrator records `worktree_fallback` and uses direct mode. Git repositories are recommended for implementation tasks so patches are reviewable and isolated.

## Patch Artifacts

After an implementer task completes, `codex_lead_cc` runs git diff in the execution path and writes:

```text
.agentforeman/patches/task_004.patch
.agentforeman/patches/task_004.diff-summary.json
```

Codex can inspect these through:

- `cc_get_diff_summary`
- `cc_get_diff_detail`

`cc_get_diff_detail` returns only diff text for a selected file, not the full source file.

Phase 3 keeps patch merge out of scope. Codex can review patch artifacts and decide the next action, but `codex_lead_cc` does not auto-merge or open pull requests.
