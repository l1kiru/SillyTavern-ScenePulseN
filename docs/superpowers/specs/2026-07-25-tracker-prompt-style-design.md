# Tracker Prompt Style (Compatible / Full) — Design Spec

**Date:** 2026-07-25  
**Branch:** `experimental`  
**Status:** Approved by user (2026-07-25). Implementation gated on explicit execute request.

## Problem

Together-mode tracker framing in ScenePulseN is a short “append JSON after narrative” instruction. It lacks Marinara/FF-style priority rules, anti-omniscient discipline, anti-repetition, and a clean OUTPUT FORMAT contract. Separate-mode `criticalRules` are thin. Heavy jailbreak presets compete with tracker instructions; a single verbose prompt style would make that worse.

## Goals

- Improve tracker JSON discipline (evidence-based updates, delta hygiene, clean markers).
- Ship two Together styles: **Compatible** (default, short) and **Full** (VAD + silent reasoning).
- Strengthen Separate JSON-only defaults without turning Separate into narrative+JSON dual-write.
- Preserve markers, dynamic field specs, quest rules, always-include behavior, and model-preset role jailbreaks.

## Non-goals

- Rewriting built-in preset `promptOverrides.role` strings.
- Weakening interceptor always-include / mandatoryHints behavior.
- A third prompt style.
- Translating new UI strings into all 30+ locale files.
- Silently rewriting legacy `profile.systemPrompt` full overrides.

## Architecture

Two prompt contours:

1. **Together (`injectionMethod: 'inline'`)**  
   New module `src/prompts/together-framing.js` supplies Compatible/Full rule blocks + shared OUTPUT FORMAT.  
   `buildInlineTrackerPrompt()` in `src/generation/interceptor.js` composes: framing → existing delta/mandatory/fieldSpecs → language/`prevState` → output format. Head/tail anchors updated to match.

2. **Separate (`injectionMethod: 'separate'`)**  
   Remains JSON-only via `src/prompts/slots.js` + assembler. Default `criticalRules` (and light `deltaMode` addition) get Full-intensity anti-rules. No `<tracker_instructions>` narrative dual-write.

```text
profile.trackerPromptStyle
        │
        ├─ Together ──► together-framing.js (compatible|full)
        │                    └─► interceptor.buildInlineTrackerPrompt
        │                              (+ slots fieldSpecs strip)
        │
        └─ Separate ──► (style ignored for framing)
                         slots criticalRules (always Full-intensity defaults)
                         └─► engine.generateTracker / getActivePrompt
```

Continuation recovery (`engine.js`, quiet call when Together omits JSON) stays JSON-only; its user prompt is tightened with the same dual-rule / no-fence / no-commentary constraints. System prompt continues to use `getActivePrompt()` (inherits strengthened slots).

## Locked decisions

| Topic | Decision |
|-------|----------|
| Approach | Keep architecture; fix wording/coverage (not minimal split PR, not full preset rewrite) |
| End-on-question / handover | **Hard ban** in Compatible and Full before tracker block |
| Anti-omniscient vs `prevState` | **Dual-rule:** `prevState` = continuity only (names/aliases/unchanged durable facts); new facts and meter/relationship/physical changes only from THIS response; no invention from cards/WI/unreferenced history |
| Always-include / mandatoryHints | **Explicit carve-out** in framing; do not weaken interceptor lists |
| Continuation recovery | **In scope** — tighten recovery prompt text |
| Locales | English `t()` / `_source.json` + `locales/russian.json` only |
| Default style | `compatible` |
| VAD | Full Together + Separate `criticalRules`; not Compatible Together |

## Data model

```js
// on profile (PROFILE_FIELDS + makeProfile)
trackerPromptStyle: 'compatible' | 'full'  // default 'compatible'
```

`normalizeTrackerPromptStyle(value)` maps anything else → `'compatible'`.  
Field is included in profile export/import via `PROFILE_FIELDS`.

## UI

Prompts tab, under Profile controls:

- Select: **Tracker Prompt Style** — Compatible / Full
- Hint: Together only; Compatible default for heavy presets; Full adds VAD + silent reasoning; Separate always uses detailed JSON analysis rules

Legacy prompt editor: if `profile.systemPrompt` is set, extend banner — Compatible/Full Together framing and updated Separate slot defaults apply only after clearing legacy system prompt.

## Prompt content (normative summary)

### Together Compatible

`<tracker_instructions>` with strict priority (narrative first, then tracker), no leak of tracker into prose, invisible tracker, hard handover/question ban, dual-rule anti-omniscient/delta, anti-reskin, realistic completed changes only, always-include carve-out. No INTERNAL REASONING. No VAD.

### Together Full

Compatible plus: anti-repeat across last 3–4 responses, prefer visible over unspoken for meters, VAD for mood/tension, silent INTERNAL REASONING checklist.

### Shared OUTPUT FORMAT

Exact `<!--SP_TRACKER_START-->` / `<!--SP_TRACKER_END-->` block; no markdown fences; no commentary before/after markers; tracker block does not count toward response length limits. Delta/full examples remain driven by existing interceptor variables (`deltaAlways`, `deltaExample`, `fieldList`).

### Separate `criticalRules`

Keep JSON-only role. Expand rules with dual-rule anti-omniscient, anti-reskin, realistic changes, VAD, no markdown/commentary. Append one anti-repeat bullet to `deltaMode`.

### Continuation user prompt

Keep “Output ONLY the tracker JSON…”. Relabel `prevState` to continuity dual-rule. Add short bullets: evidence from this narrative for new facts/meters; no fences; no commentary.

## Error handling / edge cases

- Unknown `trackerPromptStyle` → `compatible`.
- Legacy `systemPrompt` → assembler short-circuit unchanged; Together framing still wraps stripped fieldSpecs when interceptor uses `getActivePrompt()` — document that full legacy override replaces slot body; banner tells user to clear legacy for slot defaults. Implementers must not rewrite stored legacy text.
- User `promptOverrides.criticalRules` → not overwritten; user keeps their override.
- Marker extraction / streaming hider → unchanged contract.

## Testing

- `tests/together-framing.test.mjs` — normalize + Compatible vs Full phrase presence.
- Extend `tests/inline-thought-prompt.test.mjs` — style switches INTERNAL REASONING; markers still present; existing thought/delta contracts.
- Extend `tests/prompt-assembler.test.mjs` — ANTI-OMNISCIENT / Valence in defaults.
- Continuation phrasing test (extract helper if needed for testability).
- Regression: `issue-16-prompt-role`, `preset-registry`.
- Manual (post-merge on `experimental`): Together + Marinara-like heavy preset, Compatible vs Full; Separate one turn; force continuation recovery once.

## Project impact

- Medium PR on `experimental`.
- Together mid-context prompt grows modestly; Compatible default mitigates jailbreak conflict.
- Tracker behavior shifts toward less omniscient drift / less semantic re-skin; narratives may end with fewer questions (accepted trade-off).
- Rollback: git revert + `docs/superpowers/backups/2026-07-25-tracker-prompts/`.

## Implementation plan

After this spec is approved, use the existing implementation plan (writing-plans), updated with brainstorming decisions:

- Cursor plan: Tracker Prompt Style  
- Workspace copy target: `docs/superpowers/plans/2026-07-25-tracker-prompt-style.md`

Tasks: backup → framing module → interceptor → Separate slots → continuation → profile/UI/locales → legacy banner + test sweep.

## Spec self-review

1. **Placeholders:** None intentional; prompt bodies live in the implementation plan as exact constants.  
2. **Consistency:** Dual-rule applies to Together, Separate, and continuation; VAD not in Compatible; carve-out preserves always-include.  
3. **Scope:** Single subsystem (tracker prompts + one profile setting).  
4. **Ambiguity:** Legacy + Together interaction noted — framing module still used by interceptor around fieldSpecs from `getActivePrompt()`; legacy full override affects assembled slot text content, not the outer Together framing wrapper.
