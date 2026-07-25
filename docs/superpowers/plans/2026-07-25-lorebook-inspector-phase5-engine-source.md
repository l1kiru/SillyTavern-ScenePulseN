# Lorebook Inspector Phase 5 — Engine-Grade Source Segments (Future)

> **Status:** Spec stub only. **Do not execute** until Phase 4 has shipped and a SillyTavern buffer-provenance design is agreed.
>
> **Roadmap:** [2026-07-25-lorebook-inspector-roadmap.md](2026-07-25-lorebook-inspector-roadmap.md)

**Goal:** Make match `source` (chat message / persona / character field / recurse buffer) an **engine** fact instead of ScenePulseN inference.

**Why separate:** ST 1.18 `WorldInfoBuffer.get()` joins segments into one haystack before `matchKeys`. Returning `{ matched, text, index }` without redesign cannot identify which segment produced the hit. Phase 4 deliberately omits `source` on decisions.

## Required ST work (outline)

1. Track segment boundaries or scan segments separately while preserving current match semantics.
2. On successful match, attach:
   ```js
   source: {
     type: 'chat'|'speaker_name'|'persona_description'|'character_description'|
           'character_personality'|'scenario'|'creator_notes'|'extension_prompt'|'recursive_wi',
     messageId: number | null,
     depth: number | null,
   }
   ```
3. Emit on decision `primaryMatch` / `secondaryMatches`.
4. Backward compatible; no default console logging of segment text.
5. Tests for chat-only, character-description-only, recurse-only hits.

## Required ScenePulseN work (outline)

1. When `decision.primaryMatch.source` present → `triggers[].source.evidence.type = 'engine'`.
2. Keep Phase 2 inferred source as fallback when field absent.
3. UI: show “Подтверждено движком” vs “Предположительно” for source line.

## Explicit non-goals until this phase

- Claiming engine-grade source after Phases 1–4
- Re-implementing `WorldInfoBuffer` inside ScenePulseN
