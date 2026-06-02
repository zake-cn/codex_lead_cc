# codex_lead_cc

`codex_lead_cc` is a minimal Codex Lead + SubAgent shell + Claude Code delegate runtime.

It is not an MCP orchestrator. It is a thin delegation layer: Codex plans and dispatches — only Claude Code touches the project.

```
Codex Lead (supervisor_home)
  → Codex SubAgent (cc_delegate shell)
  → codex_lead_cc submit
  → local delegate daemon
  → Claude Code CLI (real project directory)
```

## Install

```bash
npm install -g --install-links=true git+https://github.com/zake-cn/codex_lead_cc.git
codex_lead_cc --doctor
```

### Development

```bash
git clone https://github.com/zake-cn/codex_lead_cc.git
cd codex_lead_cc
npm install && npm run build && npm link
codex_lead_cc --doctor
```

## Usage

```bash
codex_lead_cc "analyze this project"   # Start supervisor session
codex_lead_cc --doctor                 # Environment diagnostics
codex_lead_cc config show              # Show user config (secrets redacted)
codex_lead_cc update                   # Self-update
```

## How It Works

1. `codex_lead_cc` captures the terminal env, creates a session, and starts a local delegate daemon.
2. `codex_lead_cc` starts Codex from `~/.codex_lead_cc/supervisor/` (supervisor home).
3. When work is needed, Codex creates a TaskFile and spawns a subagent.
4. The subagent runs `codex_lead_cc submit --task-file ... --session-file ...`.
5. `submit` writes a session-local queue request and waits for a compact JSON result.
6. The daemon launches Claude Code in the **real project directory** with the TaskFile.
7. Claude Code does the work and produces artifacts.
8. Results flow back to Codex Lead for approval and next steps.

## Requirements

- Node.js ≥ 20
- `codex` on PATH
- `claude` on PATH (or configured via `claude_runtime.command`)
- `git` on PATH

## Config

```json
{
  "version": 2,
  "supervisor_home": "~/.codex_lead_cc/supervisor",
  "runtime_home": "~/.codex_lead_cc/runtime",
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
├── types.ts                       # Shared types
├── cli/
│   ├── codex_lead_cc.ts           # Supervisor wrapper + session generation
│   └── update.ts                  # Self-update
├── claude/
│   ├── claude_cli_runner.ts       # Claude CLI process spawner
│   └── claude_runtime_env.ts      # Environment variable bridge
├── delegate/
│   ├── delegate_runner.ts         # Core delegate logic
│   ├── task_file.ts               # TaskFile parser & validator
│   ├── session.ts                 # Session file reader
│   └── artifacts.ts               # Artifact writer
├── daemon/
│   └── delegate_daemon.ts         # Local file-queue daemon + submit client
└── config/
    └── user_config.ts             # User configuration
```

Zero runtime dependencies. Node.js built-ins only.
