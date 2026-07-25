# Source-trace stock capabilities + P1/P2 fixes

Date: 2026-07-26  
Branch: `experimental`

## Problem

Engine decision layer expects `WORLDINFO_SCAN_DONE.decisions` / `prompt_build`. Stock SillyTavern emits scan-done without that field. ScenePulseN must advertise **capability** (field observed), not “had decisions this loop”.

## Capabilities (telemetry → finish)

| Flag | Meaning |
|------|---------|
| `scanDone` | `telemetry.scanDoneObserved` — `recordWorldInfoScanDone` ran |
| `engineDecisions` | `decisions` **field** present and is an array (even `[]`) |
| `promptBuildDecisions` | `args.phase === 'prompt_build'` observed |

Upstream ST PR (separate): extend scan-done with `decisions[]` and/or add `WORLDINFO_ENTRY_EVALUATED` / `WORLDINFO_PROMPT_ENTRY_RENDERED`.

## Other fixes in this work

- UI `getBestEvidence` + display keys filtered by best evidence rank
- Diagnostics: end-of-capture status `ok` / `disabled_unknown_format`; `lastEntryContext` for world; no uid-only reconcile
- Settings: missing numeric → `null` (depth `0` remains valid)
- Configuration: real/`null` fields including `useProbability`
