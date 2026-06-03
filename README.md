# codex_lead_cc

`codex_lead_cc` is a Codex-to-Claude-Code Interactive Bridge.

It runs one Codex Lead, one local CC Bridge, and one long-lived Claude Code PTY. Codex starts in `supervisor_home`; Claude Code is the only process that enters the real project directory.

```
User starts codex_lead_cc in a real project
  -> wrapper creates supervisor_home and a session
  -> wrapper captures local Claude Code env
  -> wrapper starts one long-lived Claude Code PTY
  -> wrapper starts Codex with cwd = supervisor_home
  -> Codex uses cc-send / cc-input / cc-status
  -> Claude Code performs all real project work
```

This project does not use MCP, subagents, TaskFiles, delegate, submit, daemon, workers, queues, OperationRequest, TaskContract, or PermissionContract in the main path.

## Install

```bash
npm install -g --install-links=true git+https://github.com/zake-cn/codex_lead_cc.git
codex_lead_cc --doctor
```

## Development

```bash
git clone https://github.com/zake-cn/codex_lead_cc.git
cd codex_lead_cc
npm install
npm run build
npm link
codex_lead_cc --doctor
```

## Usage

```bash
codex_lead_cc [codex args...]
codex_lead_cc cc-send [--timeout-sec 120] "prompt"
codex_lead_cc cc-input --key <1|2|3|enter|escape|ctrl-c>
codex_lead_cc cc-status
codex_lead_cc migrate-supervisor
codex_lead_cc update
codex_lead_cc config show | reset | path
codex_lead_cc --doctor
```

`cc-send`, `cc-input`, and `cc-status` must run inside a Codex session launched by `codex_lead_cc`.

## File IPC

Each session owns a bridge directory:

```text
session_dir/
  bridge/
    inbox/
    streams/
    results/
    state.json
    bridge.log
```

`cc-send` writes `bridge/inbox/<request_id>.json`, tails `bridge/streams/<request_id>.log`, waits for `bridge/results/<request_id>.json`, then prints the status footer.

`cc-input` does the same, but sends one key to the PTY.

`cc-status` only reads `bridge/state.json`; it does not drive Claude Code execution.

## Status Footer

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"completed"}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

Permission request:

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"needs_permission","suggested_keys":["1","2","3"]}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

No effective output after submit:

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"not_submitted","error":"Prompt appears to remain in Claude Code input box; no effective output was observed."}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

## Completion

`<<<CODEX_LEAD_CC_DONE>>>` is only an auxiliary marker. The main completion decision uses PTY screen state:

- no new output for `quiet_ms`
- no loading or spinner in bottom lines
- no permission menu
- runtime is at least `min_run_ms`
- effective output was observed after submit

Defaults:

```json
{
  "min_run_ms": 1500,
  "quiet_ms": 2500,
  "spinner_stable_ms": 1000,
  "check_interval_ms": 100,
  "submit_grace_ms": 5000
}
```

Claude Code is usually input-ready, so input readiness is not used as task completion.
Input echo alone is not effective output; it returns `not_submitted` instead of `completed`.

## Permission Loop

When Claude Code asks for permission, Codex asks the human which option to grant.

- option 1: Codex runs `codex_lead_cc cc-input --key 1`
- option 2: Codex records reusable policy for itself, but still runs `codex_lead_cc cc-input --key 1`
- option 3: Codex runs `codex_lead_cc cc-input --key 3`

Only send `--key 2` when the human explicitly asks Claude Code itself to stop asking.

Human grants reusable policy to Codex. Codex grants one-shot approval to Claude Code.

## Supervisor Migration

Normal `codex_lead_cc` startup creates missing `CLAUDE.md`, `AGENTS.md`, and `MEMORY.md` in `supervisor_home`, but it does not overwrite existing files. If the supervisor rules are stale, startup prints:

```text
Supervisor rules are stale. Run: codex_lead_cc migrate-supervisor
```

Run this to force migration:

```bash
codex_lead_cc migrate-supervisor
```

`update` runs supervisor migration after a successful install/build.

## Session Schema

Session files use version 2:

```json
{
  "version": 2,
  "session_id": "...",
  "project_path": "...",
  "supervisor_home": "...",
  "session_dir": "...",
  "artifact_root": "...",
  "bridge_dir": "...",
  "bridge_state_file": "...",
  "claude_env_file": "...",
  "bridge_pid": 123,
  "cc_pid": 456,
  "created_at": "..."
}
```

## Requirements

- Node.js >= 20
- `codex` on PATH
- `claude` on PATH, or configured via `claude_runtime.command`
- `git` on PATH
- `node-pty` is a runtime dependency and required for the interactive Claude Code bridge
- `script` on PATH only for explicit debug fallback with `CODEX_LEAD_CC_ALLOW_PTY_FALLBACK=1`

## Architecture

```text
src/
  cli/codex_lead_cc.ts      supervisor wrapper, session launch, migrate-supervisor
  bridge/cc_bridge.ts       one bridge process, one Claude Code PTY, file IPC
  bridge/cc_client.ts       cc-send / cc-input / cc-status
  bridge/completion_detector.ts
  bridge/terminal_screen.ts
  bridge/pty.ts
  claude/claude_runtime_env.ts
  config/user_config.ts
  supervisor.ts             supervisor file defaults and migrations
```
