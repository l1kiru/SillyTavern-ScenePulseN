# Vendored dependencies

Third-party libraries pinned in source. Used by ScenePulse internals only — never re-exported as a public API.

## jsonrepair

| | |
|---|---|
| **Files** | `jsonrepair.mjs`, `jsonrepair.bundle.mjs` |
| **Version** | 3.15.0 |
| **License** | ISC (see [`jsonrepair.LICENSE`](./jsonrepair.LICENSE)) |
| **Upstream** | https://github.com/josdejong/jsonrepair |
| **Source** | npm package `jsonrepair@3.15.0`, regular ESM build |
| **Vendored** | 2026-07-21 |
| **Local wrapper** | Retries duplicate trailing commas and leading-plus numbers after upstream rejects them |
| **Used by** | [`src/generation/extraction.js`](../generation/extraction.js) — `cleanJson()` repair pass for malformed inline tracker JSON |

### Why vendored

ScenePulse is a no-build SillyTavern extension loaded by the browser as a `<script type="module">`. There's no `package.json`, no bundler, no `npm install` step. Vendoring is the only way to pull in third-party ESM code while keeping installation a single `git clone`. Pinning the source also makes upgrades auditable — every byte that runs in user browsers is in this directory.

### Upgrading

```bash
npm pack jsonrepair@<NEW_VERSION>
npx esbuild package/lib/esm/index.js --bundle --format=esm --minify --legal-comments=none --outfile=src/vendor/jsonrepair.bundle.mjs
# Update the version + date in this README and the bundle header.
# Keep jsonrepair.mjs as the small ScenePulse fallback wrapper.
# Re-fetch the LICENSE file if upstream license text has changed:
curl -L https://raw.githubusercontent.com/josdejong/jsonrepair/main/LICENSE.md > src/vendor/jsonrepair.LICENSE
# Re-run the validation suite:
node tests/vendor/jsonrepair.test.mjs
node tests/vendor/compare.test.mjs
```

`jsonrepair.bundle.mjs` is the unmodified upstream logic bundled into one browser-loadable ESM file. `jsonrepair.mjs` keeps the stable ScenePulse import and adds two narrowly tested fallbacks.

### Validation

`jsonrepair` is validated against 106 test cases covering valid pass-through, unescaped quotes, trailing commas, missing commas, single quotes, smart quotes, Python literals, comments, markdown fences, number edge cases, brace/bracket issues, unicode, whitespace, mixed quote types, realistic ScenePulse-style tracker payloads, and edge cases. See [`tests/vendor/`](../../tests/vendor).
