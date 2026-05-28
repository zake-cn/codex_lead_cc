# Dashboard

Phase 3 introduced a local status dashboard through the CLI. Phase 4 adds supervisor state and inbox visibility.

```bash
node dist/index.js status --project-id demo-project
node dist/index.js status --project-id demo-project --watch
```

The dashboard shows:

- active plan
- supervisor state
- unread supervisor inbox notifications
- recent wake events
- workers and session runtime
- task statuses and dependency hints
- pending permissions
- recent events

This is a read-only display layer. It does not replace MCP tools and does not own orchestration logic.
