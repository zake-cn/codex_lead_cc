# Mode Isolation

Phase 5 separates ordinary Codex from `codex_lead_cc` Supervisor Mode at the command boundary.

## Commands

```bash
codex
```

Runs ordinary Codex. `codex_lead_cc` does not modify the default Codex config and does not register persistent MCP servers.

```bash
codex_lead_cc
```

Runs the real `codex` binary with transient `-c` config overrides. The overrides attach the local `codex_lead_cc` MCP server with compact exposure.

## Supervisor Home

Phase 6 runs the Codex Supervisor from a dedicated home directory instead of the caller project:

```text
~/.codex_lead_cc/supervisor
```

When the user starts:

```bash
cd my_project
codex_lead_cc
```

the wrapper records `my_project` as the active worker project in runtime state, then starts Codex with `cwd=supervisor_home`. The MCP server receives only a session ID and project ID. Claude Code workers resolve that session internally and run in the original project directory.

The Supervisor-facing identifier is a stable local ID such as `proj_001`; the real project path is internal orchestration state.

## User Configuration

The wrapper creates `~/.codex_lead_cc/config.json` on first launch.

```bash
codex_lead_cc config show
codex_lead_cc config reset
codex_lead_cc config path
```

Key settings:

- `supervisor_home`: Codex cwd for Supervisor Mode.
- `runtime_home`: state, logs, reports, patches, worktrees, and project session mappings.
- `default_mcp_exposure`: compact by default.
- `worker_mode`: `caller_directory`, meaning workers inherit the directory where `codex_lead_cc` was invoked.
- `claude_runtime`: configured Claude command, prefix args, env allowlist, and optional env provider.

## Claude Code Runtime

`codex_lead_cc` checks that the configured Claude command is available and callable. It does not inspect or enforce Claude Code authentication, API keys, custom base URLs, proxies, enterprise settings, or any other runtime configuration. Those settings stay owned by the user's Claude Code environment.

The wrapper writes allowlisted runtime variables to a per-session env file and passes only `CODEX_LEAD_CC_ENV_FILE` to the MCP server. This keeps tokens out of `codex -c` arguments while still letting workers inherit `ANTHROPIC`, `CLAUDE_CODE`, `OPENAI`, `DEEPSEEK`, and proxy settings from the launching shell. See [claude-runtime-env.md](claude-runtime-env.md).

## Wrapper Modes

- `supervisor`: default; compact MCP exposure and Supervisor Mode instructions.
- `dev`: full MCP exposure for local debugging and compatibility tools.
- `off`: no MCP injection; useful for comparing wrapper behavior.

Examples:

```bash
codex_lead_cc --doctor
codex_lead_cc --dry-run
codex_lead_cc --print-config
codex_lead_cc --mode supervisor --mcp-exposure compact
codex_lead_cc --mode dev --mcp-exposure full
```

## Isolation Strategy

The wrapper does not run `codex mcp add` and does not edit `~/.codex/config.toml`.

Instead it launches:

```text
codex -c mcp_servers.codex_lead_cc.command=...
      -c mcp_servers.codex_lead_cc.args=[..., "mcp", "--exposure", "compact"]
      -c mcp_servers.codex_lead_cc.env.AGENTFOREMAN_HOME=...
      -c mcp_servers.codex_lead_cc.env.CODEX_LEAD_CC_SESSION_ID=...
      -c mcp_servers.codex_lead_cc.env.CODEX_LEAD_CC_PROJECT_ID=...
      -c mcp_servers.codex_lead_cc.env.CODEX_LEAD_CC_ENV_FILE=...
```

Those overrides only apply to the launched session. Ordinary `codex` sessions remain unchanged.

## Verification

Use:

```bash
npm run smoke:wrapper
npm run smoke:isolation
```
