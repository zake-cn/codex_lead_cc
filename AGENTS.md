# codex_lead_cc (project docs)

> Documentation only. The actual supervisor rules Codex loads are written to
> `CLAUDE.md` in supervisor_home by the wrapper on first launch.

## Architecture

```
codex_lead_cc wrapper
  -> captures terminal env
  -> creates session
  -> starts one local CC Bridge
  -> starts Codex Lead (cwd = supervisor_home, reads CLAUDE.md)
Codex Lead
  -> codex_lead_cc cc-send / cc-input / cc-status
  -> CC Bridge socket for this session only
  -> one long-lived Claude Code PTY (cwd = real project)
  -> streamed output + status footer
```

ALL runtime files (sessions, artifacts, env files, bridge sockets) live inside
supervisor_home under `.codex_lead_cc_runtime/`. Nothing is written outside
supervisor_home by Codex or the bridge runtime.

## Commands

The final bridge commands are:

```bash
codex_lead_cc cc-send "prompt"
codex_lead_cc cc-send <<'EOF'
multi-line prompt
EOF
codex_lead_cc cc-input --key 1
codex_lead_cc cc-status
```

Do not use MCP, subagents, delegate, submit, daemon, TaskContract,
OperationRequest, worker pools, queues, or multiple Claude Code instances.

## Session Isolation

`cc-send`, `cc-input`, and `cc-status` must locate the bridge only through:

```text
CODEX_LEAD_CC_BRIDGE_SOCKET
CODEX_LEAD_CC_SESSION_FILE
CODEX_LEAD_CC_SESSION_ID
```

If those variables are missing, fail with:

```text
No active codex_lead_cc bridge found in this process environment.
```

No global recent-session guessing.

## cc-send

`codex_lead_cc cc-send "prompt"` or stdin reads natural-language text, writes it
to the current long-lived Claude Code PTY, streams PTY output to stdout, and
stops only on:

- `completed`
- `needs_permission`
- `timeout`
- `interrupted`
- `exited`

`cc-send` ending does not mean Claude Code exited. The PTY stays alive.

## cc-input

`codex_lead_cc cc-input --key <key>` writes one key to the same PTY:

- `1` -> `1\r`
- `2` -> `2\r`
- `3` -> `3\r`
- `enter` -> `\r`
- `escape` -> `\x1b`
- `ctrl-c` -> `\x03`

Then it streams output and stops on the same result statuses. The PTY stays
alive.

## Completion

Do not primarily rely on `<<<CODEX_LEAD_CC_DONE>>>`. It is auxiliary only.

Main completion is based on terminal screen state:

```text
if seen_done_marker:
  completed
else if:
  now - last_output_at >= quiet_ms
  && no spinner/loading in bottom lines
  && no permission prompt
  && runtime >= min_run_ms:
    completed
```

Defaults:

```text
min_run_ms = 1500
quiet_ms = 2500
spinner_stable_ms = 1000
check_interval_ms = 100
```

Claude Code is basically always input-ready, so input readiness must not be used
as task completion.

## Permission Loop

Detect permission menus that show numbered choices (`1.`, `2.`, `3.`), Yes/No,
`don't ask again`, and command request text such as `wants to run`, `run
command`, or `execute command`.

When detected, append:

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"needs_permission","suggested_keys":["1","2","3"]}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

Then exit the current `cc-send` or `cc-input` client. The bridge state remains
`needs_permission`; the Claude Code PTY does not exit.

User option handling:

- option 1: run `codex_lead_cc cc-input --key 1`
- option 2: Codex records reusable policy for itself, but still runs
  `codex_lead_cc cc-input --key 1`
- option 3: run `codex_lead_cc cc-input --key 3`

Only send `--key 2` when the user explicitly asks Claude Code itself to stop
asking.

Human grants reusable policy to Codex. Codex grants one-shot approval to Claude
Code.
