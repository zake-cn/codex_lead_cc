# codex_lead_cc (project docs)

> Documentation only. The actual supervisor rules Codex loads are written to
> `CLAUDE.md` in supervisor_home by the wrapper on first launch.

## Architecture

```
codex_lead_cc wrapper
  → captures terminal env
  → creates session
  → starts local delegate daemon
  → starts Codex Lead (cwd = supervisor_home, reads CLAUDE.md)
Codex Lead
  → Bash: write TaskFile into $CODEX_LEAD_CC_TASK_DIR
  → Bash: CODEX_CLAUDE_CHILD_THREAD=1 codex_lead_cc submit
  → submit writes queue request and waits for result
  → Delegate daemon spawns Claude Code (cwd = real project)
  → JSON result → next step
```

ALL runtime files (sessions, tasks, artifacts, env files) live inside
supervisor_home under `.codex_lead_cc_runtime/`. Nothing is written outside
supervisor_home by Codex or subagents.

## Submit command

MUST be ONE line with inline env var:

```bash
CODEX_CLAUDE_CHILD_THREAD=1 codex_lead_cc submit \
  --task-file "/absolute/path/in/supervisor_home/task.md" \
  --session-file "/absolute/path/in/supervisor_home/session.json" \
  --timeout-sec 120
```

- Use ABSOLUTE paths only. Never literal placeholders.
- The subagent must not run `delegate` directly.
- The subagent must not launch Claude Code.
- The subagent only submits the task to the local delegate daemon.
- JSON result → stdout.

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
