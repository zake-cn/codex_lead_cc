# Dashboard

Phase 3 provides a local status dashboard through the CLI.

```bash
node dist/index.js status --project-id demo-project
node dist/index.js status --project-id demo-project --watch
```

The dashboard shows:

- active plan
- workers and session runtime
- task statuses and dependency hints
- pending permissions
- recent events

This is a read-only display layer. It does not replace MCP tools and does not own orchestration logic.
