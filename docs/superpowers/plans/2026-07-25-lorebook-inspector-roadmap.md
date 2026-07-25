# Lorebook Inspector — Full Roadmap

> **For agentic workers:** Execute plans **in order**. Each plan is independently testable. REQUIRED SUB-SKILL per plan: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

**Goal:** Cover the entire lorebook-inspector vision from the product spec: facts vs inferences, ST 1.18 engine events, prompt/segment diagnostics, optional console adapter, and upstream SillyTavern structured match API.

**Architecture:** Four sequential plans. ScenePulseN remains Together-only (`inline` + `sceneSourceTrace`). Evidence levels never lie. Do not mutate ST event payloads. Snapshot field remains `v` (not `schemaVersion`); current production is `v: 2`; Phase 1+ write/extend `v: 3` only (no `v: 4`).

**Tech Stack:** ScenePulseN Vanilla JS ES modules; SillyTavern 1.18.0+ (`D:\SillyTavern-Launcher\SillyTavern` for API reference); Node `node:test` via `node tests/run-all.mjs`.

## Global Constraints (all plans)

- `minimum_client_version`: `1.18.0`
- Together-only gates identical to current [`index.js`](../../../index.js) WI handler
- Never persist full lorebook `content` or full model prompt by default (hashes + ≤80 char excerpts)
- Never mutate `WORLDINFO_SCAN_DONE` args (ST re-reads listener mutations)
- Inferred data always labeled; diagnostic never overwrites engine
- Soft-trim with `TextEncoder` UTF-8 byte length, cap `65536` on lorebook JSON
- TDD + commit after each task

## Plan order

| Order | Plan file | Vision coverage | Ship criterion |
|------:|-----------|-----------------|----------------|
| 1 | [2026-07-25-lorebook-inspector-phase1.md](2026-07-25-lorebook-inspector-phase1.md) | §2.1–2.2, §4 evidence, §6 stages 0–8 (partial), §7.1–7.5 core, §8 storage | Causal inversion fixed; loops/provenance/force/timed/settings; inferred keys; timeline UI |
| 2 | [2026-07-25-lorebook-inspector-phase2.md](2026-07-25-lorebook-inspector-phase2.md) | §6 stages 9–10, §7 full UI, §9 perf, §10 tests; **Chat Completion + Text Completion** prompt capture | Inferred segments; insertion status for both API paths; grouping |
| 3 | [2026-07-25-lorebook-inspector-phase3.md](2026-07-25-lorebook-inspector-phase3.md) | §6 stage 11, diagnostic evidence | Optional console adapter; cannot break engine path |
| 4 | [2026-07-25-lorebook-inspector-phase4-upstream-st.md](2026-07-25-lorebook-inspector-phase4-upstream-st.md) | §6 stage 12; engine primary **and secondary**; `content_empty_after_regex` / `rendered` | ST PR + ScenePulseN engine-grade triggers + selectiveEvaluation |
| 5 | [2026-07-25-lorebook-inspector-phase5-engine-source.md](2026-07-25-lorebook-inspector-phase5-engine-source.md) | Engine-grade source segments | Separate ST `WorldInfoBuffer` segment-provenance PR (stub; execute after Phase 4) |

## Vision → plan coverage matrix

| Vision item | Plan |
|-------------|------|
| §1 current strengths (keep message/swipe bind) | Phase 1 (preserve lifecycle) |
| §2.1 fact vs key guess | Phase 1 |
| §2.2 causal inversion | Phase 1 |
| §2.3 do not reimplement full WI engine | All plans (constraint) |
| §2.4 compound regex limits | Phase 1 matcher + Phase 4 engine match |
| §2.5 raw events vs dedupe | Phase 1 |
| §2.6 processing stages | Phase 1 (accepted/engine) + Phase 2 (rendered/inserted) |
| §3 product questions | Phases 1–4 collectively |
| §4.1–4.2 evidence model | Phase 1 |
| §5 data model (full) | Phase 1 `v:3` core; Phase 2 extends stages/promptInsertions/segments |
| §6.0 baseline | Phase 1 Task 1 |
| §6.1 pre-gen context | Phase 1 |
| §6.2 evidence split | Phase 1 |
| §6.3 SCAN_DONE | Phase 1 |
| §6.4 ENTRIES_LOADED | Phase 1 |
| §6.5 FORCE_ACTIVATE + Vectors adapters | Phase 1 base force; Phase 2 Vectors/WI-FC heuristics |
| §6.6 timed effects | Phase 1 |
| §6.7 settings snapshot | Phase 1 |
| §6.8 fallback matcher | Phase 1 + Phase 2 segment scan |
| §6.9 source segments | Phase 2 (**inferred only**); engine-grade → **Phase 5 / separate ST buffer-provenance PR** |
| §6.10 prompt insertion | Phase 2 Task 2 (Chat Completion) + Task 10 (Text Completion) |
| §6.11 diagnostic adapter | Phase 3 |
| §6.12 upstream ST API | Phase 4 (incl. secondaryMatches, prompt-regex empty content → `rendered`) |
| §7.1–7.5 UI | Phase 1 core + Phase 2 advanced |
| §7.6 why-not tab | Phase 2 best-effort; Phase 4 engine reasons |
| §8 storage/migration/privacy | Phase 1 (`v:3` + migrate); Phase 2 extends `v:3` (no `v:4`) |
| §9 performance | Phase 2 |
| §10 test strategy | Distributed across plans |
| §10.7 ST version matrix / feature detect | All plans |

## Locked cross-plan contracts

These must stay identical across Phase 1–4 (integrity locks):

| Contract | Value |
|----------|--------|
| Snapshot version field | `v` (never `schemaVersion`) |
| Phase 1+ write version | `v: 3` (Phase 2–4 extend `v: 3` in place; **no `v: 4`**) |
| Entry identity | `` `${world}::${uid}` `` via `entryKey()` — not ST Map key `world.uid` |
| `stages.*.evidence` | **string** (`'engine'\|'diagnostic'\|'inferred'\|'unknown'`) |
| `triggers[].evidence` | **object** `{ type, confidence? }` |
| Accepted list source of truth | `WORLD_INFO_ACTIVATED` (+ SCAN_DONE for loops/deltas only) |
| Loaded-but-not-accepted | Persist `loadedEntryKeys[]` + compact `candidates[]` from Phase 1 Task 5 (needed by Phase 2 why-not) |
| WI settings read path | **Not** `power_user.*` (absent in ST 1.18 context). Use `snapshotWorldInfoSettings` helper: prefer injectable `readWiSettings()`; in browser read ST DOM `#world_info_depth` etc. / mirrored counters; tests inject plain object. Upstream may later expose `getWorldInfoSettings` on context (Phase 4 note). |
| Hash helper | Single `src/scene-source-trace/hash.js` `fnv1aHex(str)` shared by scan-context + fingerprints |

### Source segments — honesty lock

| Level | Status in this roadmap |
|-------|------------------------|
| Inferred segments (chat / character / persona / recurse texts) | **Phase 2** — only level shipped |
| Engine-grade `source: { type, messageId, depth }` on matches | **Not in Phases 1–4.** Requires Phase 5 / separate SillyTavern PR that stops collapsing segments inside `WorldInfoBuffer` |

Phase 4 Task 3 explicitly cuts engine `source` from the ST PR. Do not claim “точный источник совпадения” as engine-confirmed after Phases 1–4.

### Explicitly out of scope (even after Phases 1–4)

- Full visual/a11y suite from vision §10.6 (keyboard/screen-reader matrix) — not tasked
- True recursion parent edge (`вызвала запись X`) without engine decisions — UI shows “parent unknown”
- Faithful clone of full WI engine (probability/group scoring/vector search internals)
- Persisting full prompt / full entry content
- Engine-grade source segment provenance (Phase 5)

## Integrity errata (resolved in plan text)

See Phase 1 Task 5/6, Phase 2 Task 2/7, Phase 4 Task 3 locks below in those files. Do not implement settings via `power_user.world_info_*`.

## Execution handoff

Start with **Phase 1**. After it ships, run Phase 2, then 3, then 4 (4 may proceed in parallel as a SillyTavern PR once Phase 1 data model is stable).

**Two execution options for the active plan:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + review
2. **Inline Execution** — `executing-plans` in this session

Which approach for Phase 1?
