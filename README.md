# codex_lead_cc

`codex_lead_cc` is a minimal Codex Lead + SubAgent shell + Claude Code delegate runtime.

It is not an MCP orchestrator. It is a thin delegation layer: Codex plans and dispatches — only Claude Code touches the project.

```
Codex Lead (supervisor_home)
  → Codex SubAgent (cc_delegate shell)
  → codex_lead_cc delegate
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

1. `codex_lead_cc` starts Codex from `~/.codex_lead_cc/supervisor/` (supervisor home).
2. Codex runs with `AGENTS.md` rules — it never touches the real project directory.
3. When work is needed, Codex creates a TaskFile and spawns a subagent.
4. The subagent runs `codex_lead_cc delegate --task-file ... --session-file ...`.
5. `delegate` launches Claude Code in the **real project directory** with the TaskFile.
6. Claude Code does the work and produces artifacts.
7. Results flow back to Codex Lead for approval and next steps.

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
└── config/
    └── user_config.ts             # User configuration
```

Zero runtime dependencies. Node.js built-ins only.
