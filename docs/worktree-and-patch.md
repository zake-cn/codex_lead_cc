# Worktree And Patch

Implementer workers default to isolated git worktrees.

## Worktree Path

```text
.agentforeman/worktrees/task_004_impl/
```

If the target project is not a git repository, Phase 2 records `worktree_fallback` and uses direct mode.

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
