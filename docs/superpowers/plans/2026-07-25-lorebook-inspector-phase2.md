# Lorebook Inspector Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** [Phase 1](2026-07-25-lorebook-inspector-phase1.md) shipped (`v:3` trace with loops/events/triggers/evidence).
>
> **Roadmap:** [2026-07-25-lorebook-inspector-roadmap.md](2026-07-25-lorebook-inspector-roadmap.md)

**Goal:** Add inferred source segments, prompt-insertion status, Vectors/force heuristics, advanced Lore UI (grouping, rich cards, chip extras, best-effort why-not), and performance guards from the vision doc.

**Architecture:** Extend Phase 1 modules. Capture lightweight per-entry `contentFingerprint` (hash + length only) at activation for insertion matching. Rebuild scanable segments from public `SillyTavern.getContext()` (chat + character/persona fields), never claiming engine segment truth. **Always extend `v: 3` in place** (no `v: 4` in this plan).

**Tech Stack:** Same as Phase 1; `CHAT_COMPLETION_PROMPT_READY` (Task 2) and `GENERATE_AFTER_COMBINE_PROMPTS` (Task 10) from ST `event_types`.

## Global Constraints

- All Phase 1 constraints still apply
- Segment/prompt results are `inferred` or `unknown` unless Phase 4 engine fields exist
- Do not store full prompt by default; setting `sceneSourceTraceDebugPrompt` (default `false`) may keep WI slot excerpts ≤ 200 chars
- Heavy segment rematch runs at finish (once), not per SCAN_DONE
- Why-not tab is best-effort from observable gaps only (no fake rejection reasons)

## File Structure

| File | Responsibility |
|------|----------------|
| Create `src/scene-source-trace/segments.js` | Build segment list + scan keys per segment |
| Create `src/scene-source-trace/prompt-insertion.js` | Fingerprint + match against prompt WI slots |
| Create `src/scene-source-trace/force-source.js` | Heuristic force provenance (vectors / unknown external) |
| Modify `src/scene-source-trace.js` | Wire segment/prompt capture into lifecycle |
| Modify `index.js` | Subscribe prompt-ready events |
| Modify `src/ui/scene-source-trace-ui.js` | Grouping modes, rich card, why-not, chip extras |
| Modify `css/scene-source-trace.css` | New drawer sections |
| Modify `locales/_source.json` | Strings |
| Modify `src/constants.js` | Add `sceneSourceTraceDebugPrompt: false` to `DEFAULTS` |
| Modify `src/settings-ui/create-settings.js`, `bind-ui.js` | Debug-prompt toggle |
| Test: `tests/scene-source-trace-segments.test.mjs` |
| Test: `tests/scene-source-trace-prompt.test.mjs` |
| Test: `tests/scene-source-trace-ui-advanced.test.mjs` |

## Extended entry fields (still `v: 3`)

```js
{
  // ...phase1 fields...
  stages: {
    accepted: { value: true, evidence: 'engine' },
    // rendered stays unknown through Phase 2; Phase 4 sets it from content_empty_after_regex decisions
    rendered: { value: null, evidence: 'unknown' },
    inserted: { value: 'yes'|'no'|'possibly'|'unknown', evidence: 'inferred'|'unknown' },
  },
  configuration: {
    constant: false,
    vectorized: false,
    selective: false,
    selectiveLogic: 0,
    probability: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
  },
  contentFingerprint: { hash: '', length: 0 }, // never store content
  promptInsertion: {
    status: 'unknown', // yes|no|possibly|unknown
    position: null, // worldInfoBefore|worldInfoAfter|depth|anBefore|anAfter|outlet|unknown
    evidence: { type: 'inferred', confidence: 0.5 },
  },
  triggers: [{
    // + optional:
    source: {
      type: 'chat_message'|'speaker_name'|'persona_description'|'character_description'|
            'character_personality'|'scenario'|'creator_notes'|'extension_prompt'|
            'recursive_wi'|'unknown',
      messageId: null,
      depth: null,
      evidence: { type: 'inferred', confidence: 0.65 },
    },
  }],
}
```

`summary` adds: `insertedEntries`, `possiblyInsertedEntries`.  
`promptInsertions[]` optional mirror for debugging (entryKey + status + position).

---

### Task 1: Content fingerprint at activation

**Files:**
- Create: `src/scene-source-trace/prompt-insertion.js` (hash helpers first)
- Modify: `src/scene-source-trace.js` `_entryLike` / record path
- Test: `tests/scene-source-trace-prompt.test.mjs`

**Interfaces:**
```js
export function fingerprintContent(content)
// → { hash: string, length: number }  // MUST use fnv1aHex from hash.js (Phase 1)
```

- [ ] **Step 1: Failing test**

```js
import assert from 'node:assert/strict';
import { fingerprintContent } from '../src/scene-source-trace/prompt-insertion.js';
import { fnv1aHex } from '../src/scene-source-trace/hash.js';

{
  const a = fingerprintContent('Hello Артория');
  const b = fingerprintContent('Hello Артория');
  const c = fingerprintContent('Hello Артория!');
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, fnv1aHex('Hello Артория'));
  assert.equal(a.length, 'Hello Артория'.length);
  assert.notEqual(a.hash, c.hash);
}
```

- [ ] **Step 2: Run — FAIL**

Run: `node --test tests/scene-source-trace-prompt.test.mjs`

- [ ] **Step 3: Implement + attach on normalize/record**

```js
import { fnv1aHex } from './hash.js';
export function fingerprintContent(content) {
  const s = String(content ?? '');
  return { hash: fnv1aHex(s), length: s.length };
}
```

Persist only fingerprint on in-memory entry; discard content string after hash.

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/prompt-insertion.js src/scene-source-trace.js tests/scene-source-trace-prompt.test.mjs
git commit -m "$(cat <<'EOF'
feat: fingerprint WI entry content for prompt insertion checks

EOF
)"
```

---

### Task 2: Prompt slot capture + insertion status

**Files:**
- Modify: `src/scene-source-trace/prompt-insertion.js`
- Modify: `src/scene-source-trace.js` — `recordPromptReady(eventData)`, finish merges statuses
- Modify: `index.js` — listen `CHAT_COMPLETION_PROMPT_READY` (Text Completion → Task 10)
- Test: `tests/scene-source-trace-prompt.test.mjs`

**Interfaces:**
```js
export function extractWiSlotsFromPromptChat(chatMessages)
// → { worldInfoBefore: string, worldInfoAfter: string, depthTexts: string[], otherWi: string[] }
// Match message.identifier === 'worldInfoBefore'|'worldInfoAfter' (ST openai.js)

export function matchFingerprintInSlots(fingerprint, slots, { contentHead = '' } = {})
// → { status: 'yes'|'possibly'|'no'|'unknown', position: string|null, confidence: number }
// yes: contentHead non-empty AND found as substring in exactly one slot family
// no: all WI slots empty
// possibly: contentHead missing/ambiguous OR multiple slots contain it
// unknown: no prompt-ready event was captured for this generation

export function recordPromptReady(eventData) // stores slot texts (truncated) on _activeTrace
```

**Locked heuristic (YAGNI):**
1. At activation, store `contentHead = content.slice(0, 64)` **in memory only** (not in snapshot).
2. On prompt ready, for each accepted entry: if `contentHead` found in a single slot → `inserted: yes` + position; else if all WI slots empty → `no`; else `possibly`.
3. Persist only status/position/evidence in snapshot, never `contentHead`.
4. This task covers **Chat Completion only** via `CHAT_COMPLETION_PROMPT_READY`.
5. If neither Chat Completion nor Text Completion prompt events fire, status stays `unknown` (not `no`). Text Completion path is **Task 10**.

- [ ] **Step 1: Failing test**

```js
{
  const slots = extractWiSlotsFromPromptChat([
    { role: 'system', identifier: 'worldInfoBefore', content: 'AAA unique lore head BBB' },
    { role: 'system', identifier: 'worldInfoAfter', content: '' },
  ]);
  assert.match(slots.worldInfoBefore, /unique lore head/);
  const r = matchFingerprintInSlots(
    { hash: 'x', length: 100 },
    slots,
    { contentHead: 'unique lore head' },
  );
  assert.equal(r.status, 'yes');
  assert.equal(r.position, 'worldInfoBefore');
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement + wire**

```js
if (event_types.CHAT_COMPLETION_PROMPT_READY) {
  eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
    try {
      // same Together gates; skip dryRun
      if (eventData?.dryRun) return;
      recordPromptReady(eventData);
    } catch {}
  });
}
```

UI later shows `Вставлена в prompt: да/нет/возможно/неизвестно`.

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/prompt-insertion.js src/scene-source-trace.js index.js tests/scene-source-trace-prompt.test.mjs
git commit -m "$(cat <<'EOF'
feat: detect WI prompt insertion status from chat completion prompts

EOF
)"
```

---

### Task 3: Source segments model (inferred)

**Files:**
- Create: `src/scene-source-trace/segments.js`
- Modify: finish path to call segment-aware matcher
- Modify: `src/scene-source-trace/matcher.js` — accept segment list
- Test: `tests/scene-source-trace-segments.test.mjs`

**Interfaces:**
```js
export function buildInferredSegments({ chat, depth, includeNames, character, persona, recurseTexts })
// → [{ type, messageId?, depth?, text }]
// types from vision; text used only in-memory during finish

export function inferTriggerSources(entry, segments, settings)
// → triggers[] with source { type, messageId, depth, evidence: inferred }
```

Segment construction (public context only):
- chat messages in depth window → `chat_message` (+ optional `speaker_name` line scanned separately if includeNames)
- `character.description` → `character_description`
- `character.personality` → `character_personality`
- `character.scenario` → `scenario`
- `character.data?.creator_notes` / available creator notes field → `creator_notes`
- persona description from context if present → `persona_description`
- recurseTexts from SCAN_DONE activated text deltas (short) → `recursive_wi`

Never mark source evidence as `engine`.

- [ ] **Step 1: Failing test**

```js
{
  const segs = buildInferredSegments({
    chat: [{ mes: 'Hello', name: 'User' }, { mes: 'Hi', name: 'Bot' }],
    depth: 2,
    includeNames: true,
    character: { description: 'Knight Artoria', personality: 'Proud', scenario: 'Camelot' },
    persona: { description: 'Traveler' },
    recurseTexts: ['Rhongomyniad lore'],
  });
  assert.ok(segs.some(s => s.type === 'character_description' && /Artoria/.test(s.text)));
  assert.ok(segs.some(s => s.type === 'recursive_wi'));
}

{
  const triggers = inferTriggerSources(
    { key: ['Artoria'], constant: false },
    [{ type: 'character_description', text: 'Knight Artoria lives', messageId: null, depth: null }],
    { caseSensitive: false, matchWholeWords: false },
  );
  assert.equal(triggers[0].source.type, 'character_description');
  assert.equal(triggers[0].evidence.type, 'inferred');
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**; at `start`/`finish`, pass character/persona from `getContext()` into segment builder; prefer segment hit over flat buffer for `source` field (still keep matchedText)

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/segments.js src/scene-source-trace/matcher.js src/scene-source-trace.js tests/scene-source-trace-segments.test.mjs
git commit -m "$(cat <<'EOF'
feat: infer WI trigger source segments from public context

EOF
)"
```

---

### Task 4: Force-source heuristics (Vectors / external)

**Files:**
- Create: `src/scene-source-trace/force-source.js`
- Modify: `recordWorldInfoForceActivate` path
- Test: `tests/scene-source-trace-events.test.mjs`

**Interfaces:**
```js
export function classifyForceEntries(entries)
// → { source: 'vectors'|'wi_function_call'|'external', confidence: number }
// Only checkable signals, e.g. entry.vectorized === true, decorators, or known fields
// Default: 'external'
```

- [ ] **Step 1: Failing test**

```js
{
  assert.equal(classifyForceEntries([{ world: 'W', uid: 1, vectorized: true }]).source, 'vectors');
  assert.equal(classifyForceEntries([{ world: 'W', uid: 2 }]).source, 'external');
}
```

- [ ] **Step 2–4: Implement, wire trigger metadata `forceSource`, commit

```bash
git commit -m "$(cat <<'EOF'
feat: classify force-activated WI entries with safe heuristics

EOF
)"
```

---

### Task 5: Persist `configuration` snapshot per accepted entry

**Files:**
- Modify: `_entryLike` / finish mapping
- Test: `tests/scene-source-trace.test.mjs`

Copy from activation payload when present: `constant`, `vectorized`, `selective`, `selectiveLogic`, `probability`, `scanDepth`, `caseSensitive`, `matchWholeWords`.

- [ ] **Step 1: Failing test** — activated entry with `selectiveLogic: 3` appears in finished `configuration.selectiveLogic`
- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: store WI entry configuration snapshot on source trace

EOF
)"
```

---

### Task 6: Advanced UI — chip extras, grouping, rich card

**Files:**
- Modify: `src/ui/scene-source-trace-ui.js`
- Modify: `css/scene-source-trace.css`
- Modify: `locales/_source.json`
- Test: `tests/scene-source-trace-ui-advanced.test.mjs`

**Interfaces:**
```js
export function formatLoreChipLabel({ settings, meta, trace } = {})
// Lore 7
// optional title/subtitle: recursionLoops, stickyCount, budgetOverflowed

export function buildTraceDrawerModel({ settings, meta, trace, groupBy = 'world' } = {})
// groupBy: 'world' | 'loop' | 'activationType' | 'insertion' | 'evidence'
// default 'world'

export function formatRichEntryCard(entry)
// returns model fields for status, activation, key, matchedText, source, evidence, insertion
```

Grouping rules:
- `loop`: bucket by `firstSeenLoop` (`unknown` if null)
- `activationType`: constant / force / sticky / primary_key / unknown
- `insertion`: yes / possibly / no / unknown
- `evidence`: best trigger evidence type

- [ ] **Step 1: Failing tests** for each groupBy + chip title warning + rich card fields
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement drawer toolbar select for groupBy (local UI state only, not settings persistence)
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: advanced lore drawer grouping and rich entry cards

EOF
)"
```

---

### Task 7: Best-effort «Why not» panel

**Files:**
- Modify: `src/ui/scene-source-trace-ui.js`
- Create helper `src/scene-source-trace/why-not.js`
- Test: `tests/scene-source-trace-ui-advanced.test.mjs`

**Interfaces:**
```js
export function explainWhyNot(candidateOrEntry, { trace } = {})
// Returns { lines: string[], evidence: 'inferred'|'unknown' }
// Inputs come from:
//   - trace.candidates[] (Phase 1 Task 5) for loaded-but-not-accepted
//   - OR accepted entries when showing success path (caller uses different formatter)
// Allowed explanations only from observables:
// - candidate in loadedEntryKeys, not in lorebook.entries, summary.budgetOverflowed → budget suspicion
// - accepted entry with matchKind none and no force/sticky → 'no inferred primary key in pre-gen context'
// Never invent secondary_failed / probability_failed without engine/diagnostic data (Phase 3/4)
```

UI: separate drawer section listing `trace.candidates` with why-not lines; accepted entries show success path, not why-not.

- [ ] **Step 1: Failing test**

```js
{
  const r = explainWhyNot(
    { world: 'W', uid: '1', title: 'Skipped' },
    {
      trace: {
        summary: { budgetOverflowed: true },
        loadedEntryKeys: ['W::1'],
        lorebook: { entries: [] },
        candidates: [{ world: 'W', uid: '1', title: 'Skipped' }],
      },
    },
  );
  assert.ok(r.lines.some(l => /budget/i.test(l)));
  assert.equal(r.evidence, 'inferred');
}
```

- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: best-effort why-not explanations for lore entries

EOF
)"
```

---

### Task 8: Performance guards

**Files:**
- Modify: `src/scene-source-trace.js`, `matcher.js`, `segments.js`
- Test: `tests/scene-source-trace-matcher.test.mjs`

Guards to implement (concrete):
1. Compile regex cache `Map(pattern+flags → RegExp)` per finish call
2. Skip inferred key scan for `constant` / `force_activate`-only entries
3. Cap segments text scanned per entry at 100k chars total
4. Cap `events` array at 500 (drop oldest payload bodies, keep type/sequence)
5. Do not JSON-serialize trace until `finishSceneSourceTrace`

- [ ] **Step 1: Test** — 200 identical regex keys share one compile (expose `_regexCacheSizeForTests` or spy)
- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
perf: cap source-trace event volume and cache inferred regexes

EOF
)"
```

---

### Task 9: Expanded integration tests from vision §10

**Files:**
- Modify/create tests covering: secondary AND ANY/ALL, NOT ANY/ALL, constant, force, recursive loop parent unknown message, sticky flag, budget overflow, causal inversion still holds with segments, swipe rebind, Chat Completion prompt insertion yes/possibly

- [ ] **Step 1: Add tests** (no placeholders — each case asserts concrete fields)
- [ ] **Step 2: `node tests/run-all.mjs` PASS**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: expand lore inspector phase2 integration coverage

EOF
)"
```

---

### Task 10: Text Completion prompt capture

**Files:**
- Modify: `src/scene-source-trace/prompt-insertion.js`
- Modify: `src/scene-source-trace.js` — `recordTextCompletionPrompt(eventData)`
- Modify: `index.js` — subscribe `GENERATE_AFTER_COMBINE_PROMPTS`
- Test: `tests/scene-source-trace-prompt.test.mjs`

**ST 1.18 payloads (from `script.js`):**
- `GENERATE_BEFORE_COMBINE_PROMPTS` — `{ …, combinedPrompt }`; subscribers may flatten early. **Do not use as insertion source of truth** (prompt may still change).
- `GENERATE_AFTER_COMBINE_PROMPTS` — `{ prompt: string, dryRun: boolean }` (also emitted in some Chat Completion paths with array `prompt` — ignore arrays here; those are handled by Task 2 / `CHAT_COMPLETION_PROMPT_READY`).

**Interfaces:**
```js
export function extractTextCompletionSlots(eventData)
// → { textCompletionPrompt: string } | null
// null when: missing eventData, dryRun===true, prompt is Array (chat-completion shape),
//            or prompt is not a non-empty string

export function recordTextCompletionPrompt(eventData)
// stores slots on _activeTrace.promptSlotsTc; no-op if extract returns null

// matchFingerprintInSlots already used at finish — extend slot family:
// position 'text_completion_prompt' when contentHead found in textCompletionPrompt
```

**Locked merge at finish:**
1. If Chat Completion slots were captured (Task 2) → prefer those for matching (modern CC path).
2. Else if Text Completion string slot captured → match `contentHead` against `textCompletionPrompt`.
3. Else → `promptInsertion.status = 'unknown'` (payload insufficient / wrong API event missing).
4. Never treat “no TC event” as `no` when the generation might have been Chat Completion only (and vice versa: if TC string empty after a real TC event → `no`).

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict';
import {
  extractTextCompletionSlots,
  matchFingerprintInSlots,
  extractWiSlotsFromPromptChat,
} from '../src/scene-source-trace/prompt-insertion.js';
import {
  startSceneSourceTrace,
  recordWorldInfoActivation,
  recordPromptReady,
  recordTextCompletionPrompt,
  finishSceneSourceTrace,
  _resetSceneSourceTraceForTests,
} from '../src/scene-source-trace.js';

{
  assert.equal(extractTextCompletionSlots({ dryRun: true, prompt: 'x' }), null);
  assert.equal(extractTextCompletionSlots({ prompt: [{ role: 'system', content: 'x' }] }), null);
  assert.equal(extractTextCompletionSlots({ prompt: '' }), null);
  const slots = extractTextCompletionSlots({ prompt: 'PREFIX unique lore head SUFFIX', dryRun: false });
  assert.match(slots.textCompletionPrompt, /unique lore head/);
  const r = matchFingerprintInSlots(
    { hash: 'x', length: 10 },
    slots,
    { contentHead: 'unique lore head' },
  );
  assert.equal(r.status, 'yes');
  assert.equal(r.position, 'text_completion_prompt');
}

{
  // Integration: Text Completion path
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true,
    chat: [{ mes: 'hi' }],
  });
  recordWorldInfoActivation([{
    world: 'W', uid: 1, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
  }]);
  recordTextCompletionPrompt({ prompt: 'sys\nunique lore head and more text here\nuser', dryRun: false });
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'yes');
  assert.equal(trace.lorebook.entries[0].promptInsertion.position, 'text_completion_prompt');
}

{
  // Integration: Chat Completion path still works (Task 2)
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true,
    chat: [{ mes: 'hi' }],
  });
  recordWorldInfoActivation([{
    world: 'W', uid: 2, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
  }]);
  recordPromptReady({
    dryRun: false,
    chat: [{ role: 'system', identifier: 'worldInfoBefore', content: 'unique lore head and more text here' }],
  });
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'yes');
  assert.equal(trace.lorebook.entries[0].promptInsertion.position, 'worldInfoBefore');
}

{
  // Insufficient payload → unknown (not no)
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true,
    chat: [{ mes: 'hi' }],
  });
  recordWorldInfoActivation([{
    world: 'W', uid: 3, comment: 'E', key: ['k'], content: 'unique lore head and more text here',
  }]);
  // no prompt events
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.lorebook.entries[0].promptInsertion.status, 'unknown');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scene-source-trace-prompt.test.mjs`  
Expected: FAIL — `recordTextCompletionPrompt` / `extractTextCompletionSlots` missing

- [ ] **Step 3: Write minimal implementation**

```js
export function extractTextCompletionSlots(eventData) {
  if (!eventData || eventData.dryRun === true) return null;
  const p = eventData.prompt;
  if (Array.isArray(p)) return null; // chat-completion shape — Task 2
  if (typeof p !== 'string' || !p) return null;
  return { textCompletionPrompt: p };
}

// index.js
if (event_types.GENERATE_AFTER_COMBINE_PROMPTS) {
  eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (eventData) => {
    try {
      const s = getSettings();
      if (!s.enabled || s.injectionMethod !== 'inline' || s.sceneSourceTrace !== true || inlineGenStartMs <= 0 || !inlineGenerationContext) return;
      if (Array.isArray(eventData?.prompt)) return; // CC path handled elsewhere
      recordTextCompletionPrompt(eventData);
    } catch {}
  });
}
```

Extend `matchFingerprintInSlots` to accept `{ textCompletionPrompt }` and set `position: 'text_completion_prompt'`.

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/scene-source-trace-prompt.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace/prompt-insertion.js src/scene-source-trace.js index.js tests/scene-source-trace-prompt.test.mjs
git commit -m "$(cat <<'EOF'
feat: capture Text Completion prompts for WI insertion status

EOF
)"
```

---

## Self-review (Phase 2)

| Vision | Task |
|--------|------|
| Source segments §6.9 / §5 triggers.source | 3 (**inferred only**; engine → Phase 5) |
| Prompt insertion §6.10 Chat Completion | 1–2 |
| Prompt insertion §6.10 Text Completion | **10** |
| Vectors/external force §6.5 adapters | 4 |
| Entry configuration | 5 |
| UI §7.1–7.5 advanced | 6 |
| Why-not §7.6 best-effort | 7 |
| Performance §9 | 8 |
| Broader tests §10 | 9–10 |
| `rendered` / prompt-regex empty | **Phase 4** (stays unknown here) |
| Console adapter | Phase 3 |
| Engine rejection / secondary / structured match | Phase 4 |

## Execution handoff

After Phase 1 is done, execute Phase 2, then [Phase 3](2026-07-25-lorebook-inspector-phase3.md).

1. Subagent-Driven (recommended)  
2. Inline Execution
