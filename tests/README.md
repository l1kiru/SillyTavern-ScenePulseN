# Tests

Dependency-free Node regression scripts. The SillyTavern extension loader does not load anything in this directory.

Run every top-level and nested test with:

```bash
node tests/run-all.mjs
```

Each test remains a standalone Node ES module and can also be run directly.

Add new manual tests as `tests/<area>/<name>.test.mjs`. Keep them dependency-free so `node tests/<...>.test.mjs` always works without `npm install`.
