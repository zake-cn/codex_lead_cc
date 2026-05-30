# Claude Runtime Environment

`codex_lead_cc` treats Claude Code runtime configuration as user-owned local state. It does not check login status, inspect API keys, require a vendor, or decide whether Claude Code uses login state, API keys, a custom base URL, DeepSeek, a proxy, enterprise configuration, or another setup.

The only runtime expectation is that the configured Claude command is callable from the environment used to start `codex_lead_cc`.

## Env Bridge

When the wrapper starts, it builds a per-session Claude runtime env file:

```text
~/.codex_lead_cc/runtime/sessions/<session_id>/claude_env.json
```

The file is written with owner-only permissions where the platform allows it. The generated Codex MCP config receives only:

```text
CODEX_LEAD_CC_ENV_FILE
```

It does not embed token values in `codex -c` arguments or in `--print-config` output. The MCP server reads the env file at startup and merges those variables into the worker runtime environment before spawning Claude Code.

## Default Allowlist

The default allowlist includes common variables for Anthropic-compatible, Claude Code, OpenAI-compatible, DeepSeek-compatible, and proxy-based setups:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `ANTHROPIC_SMALL_FAST_MODEL`
- `CLAUDE_CODE_SUBAGENT_MODEL`
- `CLAUDE_CODE_EFFORT_LEVEL`
- `CLAUDE_CONFIG_DIR`
- `CLAUDE_CODE_USE_BEDROCK`
- `CLAUDE_CODE_USE_VERTEX`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `HTTP_PROXY`
- `HTTPS_PROXY`
- `ALL_PROXY`
- `NO_PROXY`
- `http_proxy`
- `https_proxy`
- `all_proxy`
- `no_proxy`

Edit `~/.codex_lead_cc/config.json` if your Claude runtime needs additional variables.

## Env Provider

Some users switch Claude runtime through shell tooling. `codex_lead_cc` does not hard-code any such tool, but it can run an env provider command that prints `KEY=VALUE` lines:

```json
{
  "claude_runtime": {
    "env_provider": {
      "enabled": true,
      "command": "bash",
      "args": ["-lc", "cc-switch use deepseek >/dev/null 2>&1; env"]
    }
  }
}
```

Provider output is merged over the wrapper process environment and then filtered through `env_passthrough`. If the provider fails, the wrapper records a warning and continues unless `strict` is enabled for the provider.

## Custom Command

The default worker command is:

```text
claude -p <task>
```

You can change the command and add fixed prefix arguments in `config.json`:

```json
{
  "claude_runtime": {
    "command": "/home/you/.local/bin/claude-custom",
    "args_prefix": []
  }
}
```

Worker task text is still passed as separate process arguments, not shell-concatenated strings.

## Redaction

`codex_lead_cc --doctor`, `codex_lead_cc --print-config`, and `codex_lead_cc config show` do not print captured values. They show env file paths, variable names, or redacted placeholders.

Do not share AUTH_TOKEN, API_KEY, proxy credentials, session env file contents, or screenshots that include those values.
