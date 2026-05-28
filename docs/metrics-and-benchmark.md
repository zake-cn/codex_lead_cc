# Metrics And Benchmark

Phase 3 adds lightweight metrics to show why the Supervisor-Worker split is useful.

## Metrics

`cc_get_metrics` reports:

- task totals and success rate
- total runtime
- raw log bytes
- structured report bytes
- compression ratio
- worker runtime counts
- permission request count
- patch count
- estimated supervisor context saved

The values are engineering estimates, not platform billing records.

## Benchmark

The `benchmarks/` directory contains reproducible task definitions:

- project scan
- CSV-style bug fix
- add tests
- docs update

Run a dry-run:

```bash
npm run benchmark
```

Run the local orchestrator setup path:

```bash
npm run benchmark -- --execute
```

The first benchmark implementation is intentionally lightweight. It creates plan state and collects orchestrator metrics; full automatic Codex-direct comparison is a later extension.
