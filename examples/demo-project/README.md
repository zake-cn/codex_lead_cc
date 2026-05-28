# Demo Project

This is a tiny project used by `codex_lead_cc` Phase 0 to verify that Claude Code can read a project and report back through the local orchestration CLI.

Phase 2 also uses it as a small repair demo. `src/hello.py` intentionally leaves `normalize_name()` incomplete; the tests in `tests/test_hello.py` describe the expected behavior.

## Structure

- `src/hello.py` contains a small Python entry point.
- `tests/test_hello.py` contains stdlib `unittest` coverage for the demo bug.

## Run

```bash
python3 src/hello.py
```

Run tests:

```bash
python3 -m unittest discover -s tests
```
