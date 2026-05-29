# Compact MCP Gateway

Phase 5 reduces the default Supervisor Mode MCP surface to four high-level tools.

## Compact Tools

- `cc_dispatch`: planning, worker creation, task assignment, and scheduler actions.
- `cc_wait`: Supervisor Wait Mode and wake packets.
- `cc_inspect`: status, plans, inbox, report summaries, diff summaries, permissions, metrics, and health.
- `cc_decide`: approvals, rejections, stop/restart actions, notification reads, and supervisor state changes.

Compact mode intentionally hides fine-grained tools such as `cc_create_worker`, `cc_assign_task`, and `cc_get_report`.

## Full Tools

Full exposure is for dev mode and backwards compatibility:

```bash
node dist/index.js mcp --exposure full
```

It exposes the gateway tools plus the existing Phase 0-4 `cc_*` tools and `cc_admin`.

## Gateway Envelope

Success:

```json
{
  "ok": true,
  "action": "get_status",
  "data": {},
  "warnings": []
}
```

Failure:

```json
{
  "ok": false,
  "action": "get_report",
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task task_001 not found.",
    "recoverable": true
  },
  "warnings": []
}
```

`cc_inspect` defaults report reads to `level: "summary"`. Full reports, raw logs, and diff detail require explicit action arguments.

## Verification

```bash
npm run smoke:gateway
```
