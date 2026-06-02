# codex_lead_cc

`codex_lead_cc` is a minimal Codex Lead + Claude Code Bridge runtime.

It is not an MCP orchestrator, subagent system, delegate daemon, worker pool, or queue. Codex plans from `supervisor_home`; one long-lived Claude Code PTY, owned by the current bridge, touches the real project.

```
codex_lead_cc wrapper
  -> captures terminal env
  -> creates session inside supervisor_home
  -> starts one local CC Bridge socket
  -> starts Codex Lead (cwd = supervisor_home)

Codex Lead
  -> codex_lead_cc cc-send / cc-input / cc-status
  -> CC Bridge
  -> one long-lived Claude Code PTY (cwd = real project)
```

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
codex_lead_cc "analyze this project"   # Start supervisor session
codex_lead_cc --doctor                 # Environment diagnostics
codex_lead_cc config show              # Show user config (secrets redacted)
codex_lead_cc update                   # Self-update
```

Inside an active Codex session, these bridge commands are available through the session environment:

```bash
codex_lead_cc cc-send "prompt"
codex_lead_cc cc-send <<'EOF'
multi-line prompt
EOF
codex_lead_cc cc-input --key 1
codex_lead_cc cc-status
```

`cc-send` and `cc-input` stream Claude Code PTY output to stdout. They stop when the bridge reports `completed`, `needs_permission`, `timeout`, `interrupted`, or `exited`; the Claude Code PTY remains alive for the next interaction.

`cc-status` only reads bridge state.

## Completion

The bridge does not primarily depend on an LLM finish marker. `<<<CODEX_LEAD_CC_DONE>>>` is accepted as an auxiliary signal, but the main completion decision is screen based:

- recent output has been quiet for `quiet_ms`
- bottom screen lines do not show loading or spinner activity
- no permission menu is visible
- runtime is at least `min_run_ms`

Default detector values:

```json
{
  "min_run_ms": 1500,
  "quiet_ms": 2500,
  "spinner_stable_ms": 1000,
  "check_interval_ms": 100
}
```

## Permission Loop

When Claude Code shows a permission menu, `cc-send` or `cc-input` appends:

```text
<<<CODEX_LEAD_CC_STATUS>>>
{"status":"needs_permission","suggested_keys":["1","2","3"]}
<<<CODEX_LEAD_CC_STATUS_END>>>
```

Then Codex asks the human which option to grant.

- Option 1: Codex runs `codex_lead_cc cc-input --key 1`
- Option 2: Codex records reusable policy for itself, but still runs `codex_lead_cc cc-input --key 1`
- Option 3: Codex runs `codex_lead_cc cc-input --key 3`

Codex only sends `--key 2` when the human explicitly asks Claude Code itself to stop asking.

Human grants reusable policy to Codex. Codex grants one-shot approval to Claude Code.

## Session Isolation

`cc-send`, `cc-input`, and `cc-status` locate the active bridge only through:

```text
CODEX_LEAD_CC_BRIDGE_SOCKET
CODEX_LEAD_CC_SESSION_FILE
CODEX_LEAD_CC_SESSION_ID
```

If those variables are missing or do not match the session file, the command fails with:

```text
No active codex_lead_cc bridge found in this process environment.
```

No global "latest session" lookup is used.

## Requirements

- Node.js >= 20
- `codex` on PATH
- `claude` on PATH, or configured via `claude_runtime.command`
- `git` on PATH
- `script` on PATH for the fallback PTY implementation when optional `node-pty` is unavailable

## Config

```json
{
  "version": 3,
  "supervisor_home": "~/.codex_lead_cc/supervisor",
  "runtime_home": "~/.codex_lead_cc/supervisor/.codex_lead_cc_runtime",
  "claude_runtime": {
    "command": "claude",
    "args_prefix": [],
    "env_passthrough": ["ANTHROPIC_API_KEY", "..."]
  }
}
```

`config show` redacts `*_KEY`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD` values.

## Architecture

```
src/
├── index.ts                       # CLI dispatch
├── types.ts                       # Shared bridge/session types
├── cli/
│   ├── codex_lead_cc.ts           # Supervisor wrapper + session/bridge launch
│   └── update.ts                  # Self-update
├── bridge/
│   ├── cc_bridge.ts               # One bridge process, one Claude Code PTY
│   ├── cc_client.ts               # cc-send / cc-input / cc-status clients
│   ├── completion_detector.ts     # quiet/screen/permission completion logic
│   ├── protocol.ts                # Socket frames
│   ├── pty.ts                     # node-pty optional, script fallback
│   └── terminal_screen.ts         # TerminalScreenSnapshot abstraction
├── claude/
│   └── claude_runtime_env.ts      # Environment variable bridge
└── config/
    └── user_config.ts             # User configuration
```
