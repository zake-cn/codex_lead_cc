# Benchmarks

Phase 3 keeps benchmarks local and reproducible. The benchmark set is designed to compare two operating modes:

- `codex_direct`: Codex reads, edits, and runs commands directly.
- `codex_lead_cc`: Codex acts as supervisor and delegates execution to Claude Code workers through this orchestrator.

The initial runner is intentionally lightweight. By default it prints the benchmark plan and a sample result shape without launching Claude Code. Use `--execute` when Claude Code is installed and you want to create a local plan and collect orchestrator metrics.

```bash
npm run benchmark
npm run benchmark -- --execute
```

Metrics captured by the orchestrator mode include runtime, worker count, permission requests, generated patches, raw log size, structured report size, and report compression ratio.
