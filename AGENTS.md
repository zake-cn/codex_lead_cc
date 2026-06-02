# codex_lead_cc (project docs)

> Documentation only. The actual supervisor rules are written to `CLAUDE.md`
> in supervisor_home by the `codex_lead_cc` wrapper on first launch.

## Architecture

```
Codex Lead (supervisor_home, reads CLAUDE.md)
  → Bash: write TaskFile
  → Bash: CODEX_CLAUDE_CHILD_THREAD=1 codex_lead_cc delegate
  → Delegate spawns Claude Code (cwd = real project)
  → JSON result → Codex Lead decides next step
```

## Delegate command (must be ONE line, inline env var)

```bash
CODEX_CLAUDE_CHILD_THREAD=1 codex_lead_cc delegate \
  --task-file "/absolute/path/to/task.md" \
  --session-file "$CODEX_LEAD_CC_SESSION_FILE" \
  --timeout-sec 120
```

Progress goes to stderr. Result JSON goes to stdout.

## TaskFile format

```markdown
# codex_lead_cc Task

TaskId: task_NNN
WorkerType: readonly

## Goal
...

## Allowed Scope
- README*
- package.json
- src/**

## Forbidden Actions
- Do not modify files
- Do not delete files
- Do not run destructive commands

## Acceptance Criteria
- ...

## Verification
- ...

## Report Requirements
Status
Summary
Changed Files
Verification
Findings
Final Result
Risks Or Follow-ups
```

WorkerType: `readonly` (inspect only) or `write` (may modify within Allowed Scope).
