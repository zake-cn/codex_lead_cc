# Supervisor Mode

Supervisor Mode is launched with:

```bash
codex_lead_cc
```

It starts the real `codex` command from `supervisor_home` with compact MCP exposure, a Supervisor Mode instruction prompt, and transient config overrides.

The caller directory is registered as the active worker project. Supervisor Mode receives a `project_id` such as `proj_001`; Claude Code workers resolve that ID internally to run in the original project directory.

## Supervisor Rules

The injected instruction is stored at:

```text
codex-plugin/skills/codex_lead_cc_supervisor/SKILL.md
```

Core rules:

- Do not directly read project source.
- Do not directly run shell commands for project work.
- Do not directly edit project files.
- Treat `project_id` as the project handle; do not ask for or rely on real project paths in compact gateway mode.
- Delegate reading, implementation, testing, patch generation, and review to Claude Code workers.
- Use only `cc_dispatch`, `cc_wait`, `cc_inspect`, and `cc_decide`.
- Prefer summary reports and diff summaries.
- Use `cc_wait` after dispatching ready work when there is no immediate decision.

## Typical Flow

```text
cc_dispatch(create_plan)
cc_dispatch(create_scout_task)
cc_wait
cc_inspect(get_report, level=summary)
cc_dispatch(create_implementer_task)
cc_wait
cc_inspect(get_diff_summary)
cc_dispatch(create_tester_task)
cc_decide(approve_permission)
cc_wait
cc_dispatch(create_reviewer_task)
cc_inspect(get_metrics)
```

Ordinary `codex` sessions are not affected by these rules.
