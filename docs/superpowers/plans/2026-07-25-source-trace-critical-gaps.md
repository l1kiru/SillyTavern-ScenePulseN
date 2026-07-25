# Source-trace critical gaps — triage & remediation

Date: 2026-07-25  
Branch: `experimental`

## Triage (four claims)

| # | Claim | Verdict | Remediation |
|---|--------|---------|-------------|
| 1 | Key = all keys found in buffer, not engine decision | Partially true before this work | Inferred path uses ST `.find()` **first-hit** only; engine `primaryMatch` replaces `matchedKeys` / triggers; UI no longer dumps `entry.keys` |
| 2 | Finish pollutes buffer from assistant reply | Already false after freeze (`messages` + `buffer` at start) | Regression tests kept (append + regen rewrite) |
| 3 | Fallback ignores ST settings; depth 0 → 10 | Partially true | case / whole-words / selective already in matcher; **scanDepth 0** now empty haystack via `normalizeScanDepth` |
| 4 | Tests without v3 architecture | False on experimental | Export smoke asserts `recordWorldInfoScanDone`, `explainWhyNot`, `applyScanDecisions`, etc. |

## Out of scope (honest)

- Full ST scan-buffer parity (persona/character extras, recursive WI texts, vectors) as authoritative — consume engine `decisions` / timed / force instead.
- Upstream SillyTavern patch lives outside this repo; without `WORLDINFO_SCAN_DONE.decisions`, UI shows **Inferred key** + first-hit only.
