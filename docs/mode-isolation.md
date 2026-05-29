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

## Claude Code Runtime

`codex_lead_cc` only checks that the `claude` command is available and callable. It does not inspect or enforce Claude Code authentication, API keys, custom base URLs, proxies, enterprise settings, or any other runtime configuration. Those settings stay owned by the user's Claude Code environment.

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
```

Those overrides only apply to the launched session. Ordinary `codex` sessions remain unchanged.

## Verification

Use:

```bash
npm run smoke:wrapper
```
