# Supervisor-Worker Model

`codex_lead_cc` separates strategic supervision from tactical execution.

## Codex Supervisor

Codex owns:

- user intent interpretation
- plan creation and updates
- task decomposition
- worker selection
- permission approval or rejection
- report and diff review
- final user-facing summary

Codex does not own direct source reading, shell execution, or file editing.

## Claude Code Worker

Claude Code owns:

- project inspection
- implementation inside assigned boundaries
- test execution after permission approval
- patch review
- structured reporting

## Orchestrator

`codex_lead_cc` owns:

- worker records and session metadata
- task records and DAG readiness
- permissions and rules
- event log
- worktree isolation
- diff/patch artifacts
- reports and metrics

This keeps Codex focused on management decisions instead of raw tactical context.
