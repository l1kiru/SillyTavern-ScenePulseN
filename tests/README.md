# Tests

Dependency-free Node regression scripts. The SillyTavern extension loader does not load this directory.

Run all tests:

```bash
npm test
```

Run an individual test with `node tests/<name>.test.mjs`.
Keep new tests dependency-free and name them `*.test.mjs`.

Local tests do not call a real LLM. For manual compatibility checks, record the
SillyTavern version, extension commit, browser, provider/model, scenario and result
in a local report. Do not commit reports, credentials or private chat content.
