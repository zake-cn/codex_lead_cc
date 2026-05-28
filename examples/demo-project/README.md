# Demo Project

This is a tiny project used by `codex_lead_cc` to verify the full local orchestration loop.

Phase 3 uses it as the scout -> implementer -> tester -> reviewer demo. `src/hello.py` intentionally leaves `normalize_name()` incomplete; the tests in `tests/test_hello.py` describe the expected behavior.

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
