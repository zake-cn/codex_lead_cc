# codex_lead_cc (project docs)

> Documentation only. The actual supervisor rules Codex loads are written to
> `CLAUDE.md`, `AGENTS.md`, and `MEMORY.md` in supervisor_home.

## Final Architecture

```text
User starts codex_lead_cc in a real project directory
  -> wrapper creates supervisor_home and session
  -> wrapper captures local Claude Code env
  -> wrapper starts one CC Bridge process
  -> bridge starts one long-lived Claude Code PTY with cwd = real project
  -> wrapper starts Codex with cwd = supervisor_home
  -> Codex uses cc-send / cc-input / cc-status
```

Claude Code is the only process that enters the real project directory.

## Main Commands

```bash
codex_lead_cc cc-send "prompt"
codex_lead_cc cc-send <<'EOF'
multi-line prompt
EOF
codex_lead_cc cc-input --key 1
codex_lead_cc cc-status
```

Do not use MCP, subagents, delegate, submit, daemon, workers, queues, TaskFile,
OperationRequest, TaskContract, or PermissionContract in the main path.

## File IPC

Each session owns:

```text
session_dir/
  bridge/
    inbox/
    streams/
    results/
    state.json
    bridge.log
```

`cc-send` and `cc-input` create request files in `bridge/inbox`, wait for
`bridge/results/<request_id>.json`, and then print the final clean output.
Intermediate PTY output is hidden by default; `--stream` tails the clean debug
stream when explicitly requested.

`cc-status` only reads `bridge/state.json`.

## Session Isolation

Bridge location comes from the current Codex process environment:

```text
CODEX_LEAD_CC_SESSION_ID
CODEX_LEAD_CC_SESSION_FILE
CODEX_LEAD_CC_BRIDGE_DIR
CODEX_LEAD_CC_BRIDGE_STATE
CODEX_LEAD_CC_BIN
```

No global recent-session guessing. No active_session main path.

## Completion

`<<<CODEX_LEAD_CC_DONE>>>` is auxiliary only.

Main completion:

```text
if seen_done_marker:
  completed
else if permission_prompt_detected:
  needs_permission
else if submitted_at + submit_grace_ms passed
  && effective_output_seen === false:
    not_submitted
else if:
  now - last_output_at >= quiet_ms
  && spinner_detected === false
  && permission_prompt_detected === false
  && now - round_started_at >= min_run_ms
  && effective_output_seen === true:
    completed
```

Defaults:

```text
min_run_ms = 1500
quiet_ms = 2500
spinner_stable_ms = 1000
check_interval_ms = 100
submit_grace_ms = 5000
```

Do not use whether Claude Code is input-ready as task completion.
Input echo alone is not effective output and must not be reported as completed.

## Permission Loop

Permission menu detection returns:

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"needs_permission","suggested_keys":["1","2","3"]}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

User option mapping:

- option 1: `codex_lead_cc cc-input --key 1`
- option 2: Codex records reusable policy for itself, but still runs
  `codex_lead_cc cc-input --key 1`
- option 3: `codex_lead_cc cc-input --key 3`

Only send `--key 2` when the user explicitly asks Claude Code itself to stop
asking.

Human grants reusable policy to Codex. Codex grants one-shot approval to Claude
Code.

## Supervisor Migration

Normal startup creates missing supervisor files but does not overwrite existing
ones. Stale rules produce:

```text
Supervisor rules are stale. Run: codex_lead_cc migrate-supervisor
```

`codex_lead_cc migrate-supervisor` force-overwrites `CLAUDE.md`, `AGENTS.md`,
and `MEMORY.md` in supervisor_home and writes
`.codex_lead_cc_supervisor_version.json`.
