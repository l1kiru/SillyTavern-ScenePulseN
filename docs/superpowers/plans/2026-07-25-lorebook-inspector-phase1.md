# Lorebook Inspector Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Roadmap:** [2026-07-25-lorebook-inspector-roadmap.md](2026-07-25-lorebook-inspector-roadmap.md)

**Goal:** Fix causal key inversion, introduce evidence-leveled `v:3` traces, capture ST 1.18 WI engine events (scan loops, lore provenance, force activate, timed effects, settings), and show honest inferred keys + timeline in the Lore drawer.

**Architecture:** Keep Together lifecycle `startSceneSourceTrace` → WI events → `finishSceneSourceTrace` → `_spMeta.sceneSourceTrace`. Split modules under `src/scene-source-trace/`. Store raw `events[]` + `loops[]` separately from aggregated `lorebook.entries`. Match keys only against pre-generation scan buffer; label `inferred`.

**Tech Stack:** Vanilla JS ES modules, SillyTavern 1.18 `eventSource`/`event_types`, Node `node:assert/strict` tests via `node tests/run-all.mjs`.

## Global Constraints

- ST floor: `1.18.0`
- Gates: `enabled && injectionMethod==='inline' && sceneSourceTrace===true && inlineGenStartMs>0 && inlineGenerationContext`
- No full lore `content` / prompt persistence; excerpts ≤ `MAX_MATCHED_KEY_LEN` (80)
- Do not mutate ST event payloads
- No console parsing (Phase 3); no ST core PR (Phase 4)
- Soft-trim lorebook JSON to `MAX_LOREBOOK_JSON_BYTES` (65536) using UTF-8 bytes
- Snapshot version field: `v` (write `3` after Task 3+)
- Local ST reference: `D:\SillyTavern-Launcher\SillyTavern\public\scripts\world-info.js`

## File Structure

| File | Responsibility |
|------|----------------|
| Create `src/scene-source-trace/hash.js` | Shared `fnv1aHex(str)` |
| Create `src/scene-source-trace/evidence.js` | `EvidenceLevel`, evidence helpers |
| Create `src/scene-source-trace/scan-context.js` | Pre-gen buffer + messageIds + hash |
| Create `src/scene-source-trace/event-adapters.js` | Immutable copies of ST WI events |
| Create `src/scene-source-trace/matcher.js` | Inferred primary/secondary matching |
| Create `src/scene-source-trace/migrate.js` | `v:2` → `v:3` view for UI/readers |
| Create `src/scene-source-trace/settings-snapshot.js` | Diagnostic WI settings subset |
| Modify `src/scene-source-trace.js` | Lifecycle facade + re-exports |
| Modify `index.js` | Subscribe 4 WI events with feature detect |
| Modify `src/generation/interceptor.js` | Pass `chat` into `startSceneSourceTrace` |
| Modify `src/ui/scene-source-trace-ui.js` | Evidence labels, timeline, attachment |
| Modify `css/scene-source-trace.css` | Legend + timeline |
| Modify `locales/_source.json` | New strings |
| Modify `tests/scene-source-trace.test.mjs` | Baseline + causal fix |
| Create `tests/scene-source-trace-migrate.test.mjs` | Migration |
| Create `tests/scene-source-trace-events.test.mjs` | Event adapters |
| Create `tests/scene-source-trace-matcher.test.mjs` | Matcher units |
| Create `tests/fixtures/wi-artoria-regex.json` | Compound regex fixture |

## Target `v: 3` contract (Phase 1)

```js
{
  v: 3,
  mode: 'inline',
  capturedAt: '',
  startedAt: '',
  settings: {
    scanDepth: 0,
    minActivations: 0,
    recursive: false,
    recursionLimit: 0,
    includeNames: false,
    matchWholeWords: false,
    caseSensitive: false,
    budget: 0,
    budgetCap: 0,
    characterStrategy: 0,
  },
  // owner mirrored from capture owner for swipe/chat identity (vision §5.1 subset)
  owner: { chatKey: '', messageId: null, swipeId: null },
  lorebooks: [{ id: '', name: '', attachmentSources: [] }],
  loadedEntryKeys: [], // all world::uid seen in ENTRIES_LOADED
  candidates: [], // loaded but not in final accepted list: [{ world, uid, title }] compact, no content
  lorebook: {
    count: 0,
    totalEvents: 0,
    omitted: undefined,
    entries: [{
      world: '', uid: '', title: '', tokens: 0,
      // NOTE: stages.*.evidence is a STRING; triggers[].evidence is an OBJECT
      stages: { accepted: { value: true, evidence: 'engine' } },
      firstSeenLoop: null,
      triggers: [{
        type: 'primary_key', // or constant|force_activate|sticky|unknown
        originalKey: '',
        matchedText: '',
        matchIndex: -1,
        groups: null,
        evidence: { type: 'inferred', confidence: 0.7 },
      }],
      timedEffects: { sticky: false, cooldown: false, delay: false },
      matchedKeys: [], // mirror of inferred matchedText for highlight
      matchKind: 'keys', // keys|constant|none|force|sticky
    }],
  },
  loops: [{
    loopCount: 0,
    state: 'INITIAL', // INITIAL|RECURSION|MIN_ACTIVATIONS
    nextState: 'NONE',
    budgetCurrent: 0,
    budgetOverflowed: false,
    acceptedEntryKeys: [], // 'World::uid' via entryKey() — NOT ST Map keys
    newAcceptedEntryKeys: [],
  }],
  events: [{ sequence: 0, timestamp: '', type: '', source: '', loop: null, entryKey: null, payload: {} }],
  summary: {
    loadedEntries: 0,
    acceptedEntries: 0,
    candidateEntries: 0,
    inferredTriggers: 0,
    recursionLoops: 0,
    budgetOverflowed: false,
    stickyCount: 0,
  },
}
```

ST enums to copy verbatim:

```js
export const WI_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };
export const WI_SCAN_STATE = { NONE: 0, INITIAL: 1, RECURSION: 2, MIN_ACTIVATIONS: 3 };
```

---

### Task 1: Baseline regression for current `v: 2`

**Files:**
- Create: `tests/fixtures/wi-artoria-regex.json`
- Modify: `tests/scene-source-trace.test.mjs`
- Test: `tests/scene-source-trace.test.mjs`

**Interfaces:**
- Consumes: existing `normalizeWorldInfoEvent`, `matchEntryKeys`, `buildWiScanBuffer`, `startSceneSourceTrace`, `recordWorldInfoActivation`, `finishSceneSourceTrace`, `rebindSceneSourceTraceOwner`, `trimLorebookForStorage`, UI formatters
- Produces: locked baseline expectations (including documented causal bug)

- [ ] **Step 1: Write the fixture**

```json
{
  "key": "/(?:artoria lancer|lion king|артори(?:я|и|ю|ей) лансер|артори(?:я|и|ю|ей) пендрагон)/i",
  "positives": ["artoria lancer", "lion king", "Арторией Пендрагон", "артория лансер"],
  "negatives": ["xyzzy", "artoriax lancer"]
}
```

- [ ] **Step 2: Add characterization tests** (keep production unchanged)

```js
import assert from 'node:assert/strict';
import fixture from './fixtures/wi-artoria-regex.json' with { type: 'json' };
// ... existing imports ...

// multi-world, constant, swipe rebind, empty, trim — extend existing file

{
  // BASELINE BUG: post-gen chat includes assistant reply → false key attribution
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, { enabled: true });
  recordWorldInfoActivation([{ world: 'W', uid: 1, comment: 'E', key: ['SecretKey'], content: 'x' }]);
  globalThis.SillyTavern.getContext = () => ({
    extensionSettings: { scenepulse: {} },
    chatMetadata: {},
    chat: [
      { mes: 'hello' },
      { mes: 'SecretKey appears only in the new reply', is_user: false },
    ],
    power_user: { world_info_depth: 10 },
  });
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.v, 2);
  assert.deepEqual(trace.lorebook.entries[0].matchedKeys, ['SecretKey']);
}

{
  const { matchedKeys } = matchEntryKeys({ keys: [fixture.key] }, 'She saw Арторией Пендрагон yesterday');
  assert.ok(matchedKeys.some(k => /пендрагон/i.test(k)));
}
```

- [ ] **Step 3: Run test to verify baseline passes**

Run: `node --test tests/scene-source-trace.test.mjs`  
Expected: PASS (characterization of current behavior)

- [ ] **Step 4: Commit**

```bash
git add tests/scene-source-trace.test.mjs tests/fixtures/wi-artoria-regex.json
git commit -m "$(cat <<'EOF'
test: lock scene source trace v2 baseline

EOF
)"
```

---

### Task 2: Evidence constants + migrate view + module folder

**Files:**
- Create: `src/scene-source-trace/evidence.js`
- Create: `src/scene-source-trace/migrate.js`
- Modify: `src/scene-source-trace.js` (re-export; no finish shape change yet)
- Test: `tests/scene-source-trace-migrate.test.mjs`

**Interfaces:**
- Produces:
```js
export const EvidenceLevel = {
  ENGINE: 'engine',
  DIAGNOSTIC: 'diagnostic',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
};
export function evidence(type, confidence) {
  const out = { type };
  if (typeof confidence === 'number') out.confidence = confidence;
  return out;
}
/** @returns {object} v3-shaped view; never invents loops for v2 */
export function migrateTraceToV3View(trace)
```

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import { migrateTraceToV3View, EvidenceLevel } from '../src/scene-source-trace/migrate.js';
// evidence may be imported from evidence.js via migrate re-export or direct

{
  const view = migrateTraceToV3View({
    v: 2,
    mode: 'inline',
    capturedAt: 't',
    startedAt: 's',
    lorebook: {
      count: 1,
      totalEvents: 1,
      entries: [{
        world: 'Fate', uid: '42', title: 'Artoria',
        matchedKeys: ['Artoria'], matchKind: 'keys', tokens: 3,
      }],
    },
  });
  assert.equal(view.v, 3);
  assert.equal(view.lorebook.entries[0].stages.accepted.evidence, EvidenceLevel.ENGINE);
  assert.equal(view.lorebook.entries[0].triggers[0].evidence.type, EvidenceLevel.INFERRED);
  assert.deepEqual(view.loops, []);
  assert.equal(view.summary.acceptedEntries, 1);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scene-source-trace-migrate.test.mjs`  
Expected: FAIL with module not found / function not defined

- [ ] **Step 3: Write minimal implementation**

```js
// src/scene-source-trace/evidence.js
export const EvidenceLevel = {
  ENGINE: 'engine',
  DIAGNOSTIC: 'diagnostic',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
};
export function evidence(type, confidence) {
  const out = { type };
  if (Number.isFinite(confidence)) out.confidence = confidence;
  return out;
}

// src/scene-source-trace/migrate.js
import { EvidenceLevel, evidence } from './evidence.js';

export { EvidenceLevel, evidence };

export function migrateTraceToV3View(trace) {
  if (!trace || typeof trace !== 'object') return null;
  if (trace.v === 3) return trace;
  const entries = Array.isArray(trace.lorebook?.entries) ? trace.lorebook.entries : [];
  const mapped = entries.map(e => {
    const matchKind = e.matchKind || (e.constant ? 'constant' : 'none');
    const triggers = [];
    if (matchKind === 'constant') {
      triggers.push({ type: 'constant', evidence: evidence(EvidenceLevel.ENGINE) });
    } else if (Array.isArray(e.matchedKeys) && e.matchedKeys.length) {
      for (const k of e.matchedKeys) {
        triggers.push({
          type: 'primary_key',
          matchedText: String(k),
          evidence: evidence(EvidenceLevel.INFERRED, 0.6),
        });
      }
    } else {
      triggers.push({ type: 'unknown', evidence: evidence(EvidenceLevel.UNKNOWN) });
    }
    return {
      world: e.world || '',
      uid: e.uid || '',
      title: e.title || '',
      tokens: Number.isFinite(e.tokens) ? e.tokens : 0,
      stages: { accepted: { value: true, evidence: EvidenceLevel.ENGINE } },
      firstSeenLoop: null,
      triggers,
      timedEffects: {},
      matchedKeys: Array.isArray(e.matchedKeys) ? e.matchedKeys.slice() : [],
      matchKind,
    };
  });
  return {
    v: 3,
    mode: trace.mode || 'inline',
    capturedAt: trace.capturedAt || '',
    startedAt: trace.startedAt || '',
    settings: {},
    lorebooks: [],
    lorebook: {
      count: mapped.length,
      totalEvents: trace.lorebook?.totalEvents || 0,
      entries: mapped,
      ...(trace.lorebook?.omitted ? { omitted: trace.lorebook.omitted } : {}),
    },
    loops: [],
    events: [],
    summary: {
      loadedEntries: 0,
      acceptedEntries: mapped.length,
      inferredTriggers: mapped.reduce((n, e) => n + e.triggers.filter(t => t.evidence?.type === EvidenceLevel.INFERRED).length, 0),
      recursionLoops: 0,
      budgetOverflowed: false,
      stickyCount: 0,
    },
  };
}
```

Re-export from `src/scene-source-trace.js`:

```js
export { EvidenceLevel, evidence, migrateTraceToV3View } from './scene-source-trace/migrate.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scene-source-trace-migrate.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace/evidence.js src/scene-source-trace/migrate.js src/scene-source-trace.js tests/scene-source-trace-migrate.test.mjs
git commit -m "$(cat <<'EOF'
refactor: add source-trace evidence levels and v2→v3 migrate view

EOF
)"
```

---

### Task 3: Pre-generation scan context (fix causal inversion)

**Files:**
- Create: `src/scene-source-trace/scan-context.js`
- Modify: `src/scene-source-trace.js` (`startSceneSourceTrace`, `finishSceneSourceTrace`)
- Modify: `src/generation/interceptor.js` (~L318)
- Test: `tests/scene-source-trace.test.mjs`

**Interfaces:**
```js
export function capturePreGenScanContext(chat, { depth = 10, includeNames = false } = {})
// → {
//   depth: number,
//   includeNames: boolean,
//   messageIds: number[], // indices into chat at capture time
//   buffer: string,       // joined mes (+ optional name) for matching only; kept in memory during capture
//   bufferHash: string,   // persisted; buffer itself may be dropped after finish match
// }
```
- `startSceneSourceTrace(owner, { enabled, chat, depth, includeNames } = {})`
- Finish **must not** read live chat for matching

- [ ] **Step 1: Write the failing test** (replace BASELINE BUG expectation)

```js
{
  _resetSceneSourceTraceForTests();
  const chatBefore = [{ mes: 'hello there' }];
  startSceneSourceTrace(
    { chatKey: 'c', targetMessageId: 1, swipeId: 0 },
    { enabled: true, chat: chatBefore, depth: 10 },
  );
  recordWorldInfoActivation([{ world: 'W', uid: 1, comment: 'E', key: ['SecretKey'], content: 'x' }]);
  // Poison global chat with post-gen assistant text — finish must ignore it
  globalThis.SillyTavern.getContext = () => ({
    chat: [{ mes: 'hello there' }, { mes: 'SecretKey in assistant reply' }],
    power_user: { world_info_depth: 10 },
  });
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.deepEqual(trace.lorebook.entries[0].matchedKeys, []);
  assert.equal(trace.lorebook.entries[0].matchKind, 'none');
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scene-source-trace.test.mjs`  
Expected: FAIL (still matches SecretKey from live chat)

- [ ] **Step 3: Write minimal implementation**

```js
// src/scene-source-trace/scan-context.js
export function capturePreGenScanContext(chat, { depth = 10, includeNames = false } = {}) {
  const list = Array.isArray(chat) ? chat : [];
  const n = Math.max(1, Number(depth) || 10);
  const slice = list.slice(-n);
  const startIdx = Math.max(0, list.length - slice.length);
  const messageIds = slice.map((_, i) => startIdx + i);
  const parts = slice.map(m => {
    const mes = String(m?.mes ?? '');
    if (!includeNames) return mes;
    const name = String(m?.name ?? '').trim();
    return name ? `${name}: ${mes}` : mes;
  });
  const buffer = parts.join('\n');
  let bufferHash = '';
  try {
    // lightweight stable hash without crypto dependency
    let h = 2166136261;
    for (let i = 0; i < buffer.length; i++) {
      h ^= buffer.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    bufferHash = (h >>> 0).toString(16);
  } catch { bufferHash = ''; }
  return { depth: n, includeNames: !!includeNames, messageIds, buffer, bufferHash };
}
```

In `startSceneSourceTrace`, store `scanContext` on `_activeTrace`.  
In `finishSceneSourceTrace`, call `applyMatchedKeysToEntries(trace.entries, trace.scanContext?.buffer || '')`.  
In interceptor:

```js
const ctx = SillyTavern.getContext();
startSceneSourceTrace(_owner, {
  enabled: s.sceneSourceTrace === true,
  chat: ctx.chat,
  depth: /* resolveScanDepth() */,
});
```

Also start writing `v: 3` from finish (fill `triggers` with inferred from matchedKeys; empty loops/events ok for now).  
**Must update Task 1 baseline:** delete or rewrite the assertion `assert.equal(trace.v, 2)` — after this task finish always returns `v: 3`. Keep a separate migrate test for legacy `v: 2` snapshots.

Use shared hash:

```js
// src/scene-source-trace/hash.js
export function fnv1aHex(str) {
  const s = String(str ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/scene-source-trace.test.mjs tests/scene-source-trace-migrate.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace/hash.js src/scene-source-trace/scan-context.js src/scene-source-trace.js src/generation/interceptor.js tests/scene-source-trace.test.mjs
git commit -m "$(cat <<'EOF'
fix: match WI keys against pre-generation scan context

EOF
)"
```

---

### Task 4: `WORLDINFO_SCAN_DONE` → loops + raw events

**Files:**
- Create: `src/scene-source-trace/event-adapters.js`
- Modify: `src/scene-source-trace.js` — `recordWorldInfoScanDone(args)`
- Modify: `index.js` — subscribe when `event_types.WORLDINFO_SCAN_DONE`
- Test: `tests/scene-source-trace-events.test.mjs`

**Interfaces:**
```js
export function entryKey(world, uid) // `${world}::${uid}`
export function scanStateName(n) // 1→INITIAL, 2→RECURSION, 3→MIN_ACTIVATIONS, else NONE
export function snapshotScanDone(args)
// → { loopCount, state, nextState, budgetCurrent, budgetOverflowed,
//     acceptedEntryKeys: string[], timedEffectsActive: Map-like plain object by entryKey }
export function recordWorldInfoScanDone(args) // on active trace; must not mutate args
```

- [ ] **Step 1: Write the failing test**

```js
import assert from 'node:assert/strict';
import {
  snapshotScanDone, entryKey,
} from '../src/scene-source-trace/event-adapters.js';
import {
  startSceneSourceTrace,
  recordWorldInfoScanDone,
  recordWorldInfoActivation,
  finishSceneSourceTrace,
  _resetSceneSourceTraceForTests,
} from '../src/scene-source-trace.js';

{
  const e1 = { world: 'Fate', uid: 42, comment: 'Artoria', key: ['a'], content: 'x' };
  const map1 = new Map([['Fate.42', e1]]);
  const args1 = {
    state: { current: 1, next: 2, loopCount: 0 },
    new: { all: [e1], successful: [e1] },
    activated: { entries: map1, text: 'x' },
    budget: { current: 100, overflowed: false },
    timedEffects: { isEffectActive: () => false },
    recursionDelay: { availableLevels: [], currentLevel: 0 },
    sortedEntries: [e1],
  };
  const snap = snapshotScanDone(args1);
  assert.equal(snap.state, 'INITIAL');
  assert.deepEqual(snap.acceptedEntryKeys, [entryKey('Fate', 42)]);
  // mutation guard: mutating our snapshot must not shrink ST Map
  snap.acceptedEntryKeys.push('nope');
  assert.equal(args1.activated.entries.size, 1);
}

{
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, { enabled: true, chat: [{ mes: 'a' }] });
  const e1 = { world: 'Fate', uid: 42, comment: 'Artoria', key: ['a'], content: 'x' };
  const e2 = { world: 'Fate', uid: 7, comment: 'Camelot', key: ['c'], content: 'y' };
  recordWorldInfoScanDone({
    state: { current: 1, next: 2, loopCount: 0 },
    new: { all: [e1], successful: [e1] },
    activated: { entries: new Map([['Fate.42', e1]]), text: 'x' },
    budget: { current: 50, overflowed: false },
    timedEffects: { isEffectActive: () => false },
  });
  recordWorldInfoScanDone({
    state: { current: 2, next: 0, loopCount: 1 },
    new: { all: [e2], successful: [e2] },
    activated: { entries: new Map([['Fate.42', e1], ['Fate.7', e2]]), text: 'y\nx' },
    budget: { current: 20, overflowed: true },
    timedEffects: { isEffectActive: (type, entry) => type === 'sticky' && entry.uid === 42 },
  });
  recordWorldInfoActivation([e1, e2]);
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.v, 3);
  assert.equal(trace.loops.length, 2);
  assert.deepEqual(trace.loops[1].newAcceptedEntryKeys, [entryKey('Fate', 7)]);
  assert.equal(trace.summary.budgetOverflowed, true);
  const art = trace.lorebook.entries.find(e => String(e.uid) === '42');
  assert.equal(art.firstSeenLoop, 0);
  assert.equal(art.timedEffects.sticky, true);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scene-source-trace-events.test.mjs`  
Expected: FAIL module/function missing

- [ ] **Step 3: Write minimal implementation**

```js
// event-adapters.js (core)
export function entryKey(world, uid) {
  return `${String(world ?? '')}::${String(uid ?? '')}`;
}
export function scanStateName(n) {
  if (n === 1) return 'INITIAL';
  if (n === 2) return 'RECURSION';
  if (n === 3) return 'MIN_ACTIVATIONS';
  return 'NONE';
}
export function snapshotScanDone(args) {
  const map = args?.activated?.entries;
  const accepted = [];
  if (map instanceof Map) {
    for (const entry of map.values()) {
      accepted.push(entryKey(entry?.world, entry?.uid));
    }
  }
  return {
    loopCount: Number(args?.state?.loopCount) || 0,
    state: scanStateName(args?.state?.current),
    nextState: scanStateName(args?.state?.next),
    budgetCurrent: Number(args?.budget?.current) || 0,
    budgetOverflowed: !!args?.budget?.overflowed,
    acceptedEntryKeys: accepted.slice(),
    // caller computes newAccepted vs previous
  };
}
```

`recordWorldInfoScanDone`: push immutable event; compute `newAcceptedEntryKeys` vs last loop; store sticky flags via try/catch `timedEffects.isEffectActive`.  
`index.js`:

```js
if (event_types.WORLDINFO_SCAN_DONE) {
  eventSource.on(event_types.WORLDINFO_SCAN_DONE, args => {
    try {
      const s = getSettings();
      if (!s.enabled || s.injectionMethod !== 'inline' || s.sceneSourceTrace !== true || inlineGenStartMs <= 0 || !inlineGenerationContext) return;
      recordWorldInfoScanDone(args);
    } catch {}
  });
}
```

- [ ] **Step 4: Run tests — pass**

Run: `node --test tests/scene-source-trace-events.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace/event-adapters.js src/scene-source-trace.js index.js tests/scene-source-trace-events.test.mjs
git commit -m "$(cat <<'EOF'
feat: capture WORLDINFO_SCAN_DONE loops into source trace

EOF
)"
```

---

### Task 5: `WORLDINFO_ENTRIES_LOADED` + `WORLDINFO_FORCE_ACTIVATE`

**Files:**
- Modify: `src/scene-source-trace/event-adapters.js`
- Modify: `src/scene-source-trace.js` — `recordWorldInfoEntriesLoaded`, `recordWorldInfoForceActivate`
- Modify: `index.js`
- Test: `tests/scene-source-trace-events.test.mjs`

**Interfaces:**
```js
export function snapshotEntriesLoaded(payload)
// → { lorebooks: [{id,name,attachmentSources}], loadedEntryKeys: string[], loadedCount }
export function recordWorldInfoEntriesLoaded(payload)
export function recordWorldInfoForceActivate(entries) // array
// On finish: if entry was force-listed and accepted → trigger { type:'force_activate', evidence: engine }
```

- [ ] **Step 1: Write the failing test**

```js
{
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, { enabled: true, chat: [{ mes: 'x' }] });
  recordWorldInfoEntriesLoaded({
    globalLore: [{ world: 'GlobalBook', uid: 1, key: ['g'], content: 'a' }],
    characterLore: [{ world: 'Fate', uid: 42, key: ['a'], content: 'b' }],
    chatLore: [{ world: 'Fate', uid: 99, key: ['c'], content: 'd' }],
    personaLore: [],
  });
  const forced = [{ world: 'Fate', uid: 42, key: ['a'], comment: 'Artoria', content: 'b' }];
  recordWorldInfoForceActivate(forced);
  recordWorldInfoActivation(forced);
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  const fate = trace.lorebooks.find(l => l.name === 'Fate' || l.id === 'Fate');
  assert.ok(fate.attachmentSources.includes('character'));
  assert.ok(fate.attachmentSources.includes('chat'));
  const art = trace.lorebook.entries.find(e => String(e.uid) === '42');
  assert.ok(art.triggers.some(t => t.type === 'force_activate' && t.evidence.type === 'engine'));
  assert.equal(art.matchKind, 'force');
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/scene-source-trace-events.test.mjs`  
Expected: FAIL missing recorders

- [ ] **Step 3: Implement + wire index.js**

```js
if (event_types.WORLDINFO_ENTRIES_LOADED) {
  eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, payload => { /* same gates */ recordWorldInfoEntriesLoaded(payload); });
}
if (event_types.WORLDINFO_FORCE_ACTIVATE) {
  eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, entries => { /* same gates */ recordWorldInfoForceActivate(entries); });
}
```

Build lorebook attachmentSources by unioning source bucket names: `global`, `character`, `chat`, `persona`.  
Do not label force as vector unless Phase 2 heuristics apply.

**Integrity lock for Phase 2 why-not:** on `ENTRIES_LOADED`, persist:
- `loadedEntryKeys: string[]` (`entryKey` for every loaded entry)
- `candidates: [{ world, uid, title }]` = loaded keys **minus** final accepted set (computed at finish)

Without this, Phase 2 `explainWhyNot` cannot observe “loaded but not accepted”.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace/event-adapters.js src/scene-source-trace.js index.js tests/scene-source-trace-events.test.mjs
git commit -m "$(cat <<'EOF'
feat: WI entries-loaded provenance and force-activate triggers

EOF
)"
```

---

### Task 6: Settings snapshot + timedEffects on finish

**Files:**
- Create: `src/scene-source-trace/settings-snapshot.js`
- Modify: `src/scene-source-trace.js` (capture settings at start or finish-from-active)
- Test: `tests/scene-source-trace-events.test.mjs`

**Interfaces:**
```js
export function snapshotWorldInfoSettings(raw)
// raw = plain object OR return value of readWiSettingsFromDom()
// Map ST names → v3 settings keys (see below). Missing → 0/false.

export function readWiSettingsFromDom(doc = globalThis.document)
// ST 1.18 does NOT put WI settings on getContext()/power_user.
// getWorldInfoSettings() exists in world-info.js but is not on context.
// Browser path: read the same inputs ST binds in world-info.js:
//   #world_info_depth, #world_info_min_activations, #world_info_budget,
//   #world_info_include_names, #world_info_recursive, #world_info_case_sensitive,
//   #world_info_match_whole_words, #world_info_budget_cap,
//   #world_info_character_strategy, #world_info_max_recursion_steps
// (use .val() via jQuery if `$` present, else .value / .checked)
// Tests never use DOM — call snapshotWorldInfoSettings(plainObject) directly.
```

Field map (ST → v3):
- `world_info_depth` → `scanDepth`
- `world_info_min_activations` → `minActivations`
- `world_info_recursive` → `recursive`
- `world_info_max_recursion_steps` → `recursionLimit`
- `world_info_include_names` → `includeNames`
- `world_info_match_whole_words` → `matchWholeWords`
- `world_info_case_sensitive` → `caseSensitive`
- `world_info_budget` → `budget`
- `world_info_budget_cap` → `budgetCap`
- `world_info_character_strategy` → `characterStrategy`

Also update `resolveScanDepth()` to use the same helper (current `power_user.world_info_depth` path is ineffective on stock ST 1.18).

Sticky already from Task 4 — finish merges last known timedEffects per **accepted** entry only (cooldown/delay on accepted). Do not invent a rejected/suppressed list in Phase 1.

- [ ] **Step 1: Failing test**

```js
{
  const settings = snapshotWorldInfoSettings({
    world_info_depth: 4,
    world_info_budget: 25,
    world_info_include_names: true,
    world_info_case_sensitive: false,
    world_info_match_whole_words: true,
    world_info_max_recursion_steps: 3,
  });
  assert.equal(settings.scanDepth, 4);
  assert.equal(settings.matchWholeWords, true);
  assert.equal(settings.recursionLimit, 3);
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement** — map fields above; DOM reader separate; tests inject plain object

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/settings-snapshot.js src/scene-source-trace.js tests/scene-source-trace-events.test.mjs
git commit -m "$(cat <<'EOF'
feat: snapshot World Info settings and timed effects on trace

EOF
)"
```

---

### Task 7: Inferred matcher upgrade

**Files:**
- Create: `src/scene-source-trace/matcher.js`
- Modify: `src/scene-source-trace.js` — use matcher on finish; keep `matchEntryKeys` as thin wrapper or re-export
- Test: `tests/scene-source-trace-matcher.test.mjs` + Artoria fixture

**Interfaces:**
```js
export const WI_LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

export function inferTriggersForEntry(entry, buffer, settings)
// entry: { keys|key, keysecondary, selectiveLogic, constant, caseSensitive, matchWholeWords, ... }
// → { triggers, matchedKeys, matchKind }
// All key triggers use evidence.type = 'inferred'
```

Literal rules mirrored from ST `WorldInfoBuffer.matchKeys`:
- regex key (`/pat/flags`) → `exec`, reset `lastIndex` if `g`/`y`, invalid → skip
- else transform case via entry/global; whole words → `(?:^|\W)(${escape})(?:$|\W)` for single token; multi-word → `includes`

Secondary: evaluate selectiveLogic; if secondary fails, do not emit primary_key trigger (matchKind `none`) even if primary text found — still accepted entry may exist via constant/force/sticky.

- [ ] **Step 1: Write failing tests**

```js
import assert from 'node:assert/strict';
import { inferTriggersForEntry } from '../src/scene-source-trace/matcher.js';
import fixture from './fixtures/wi-artoria-regex.json' with { type: 'json' };

{
  const r = inferTriggersForEntry(
    { key: ['Cat'], matchWholeWords: true, caseSensitive: false },
    'Category has Cat inside',
    { matchWholeWords: true, caseSensitive: false },
  );
  // whole-word Cat should match the standalone Cat, not only Category — assert ST-like:
  assert.ok(r.matchedKeys.includes('Cat') || r.matchedKeys.some(k => k.toLowerCase() === 'cat'));
}

{
  const r = inferTriggersForEntry(
    { key: ['ion'], matchWholeWords: true },
    'lion',
    { matchWholeWords: true },
  );
  assert.deepEqual(r.matchedKeys, []); // substring false positive blocked
}

{
  const r = inferTriggersForEntry(
    { key: [fixture.key], selectiveLogic: 0, keysecondary: [] },
    'met Арторией Пендрагон',
    {},
  );
  assert.ok(r.triggers[0].matchedText);
  assert.equal(r.triggers[0].evidence.type, 'inferred');
  assert.ok(Number.isInteger(r.triggers[0].matchIndex));
}

{
  const r = inferTriggersForEntry(
    { key: ['Artoria'], keysecondary: ['Camelot'], selectiveLogic: 0 /* AND_ANY */ },
    'Artoria walks alone',
    {},
  );
  assert.equal(r.matchKind, 'none');
}
```

- [ ] **Step 2: Run — FAIL**

Run: `node --test tests/scene-source-trace-matcher.test.mjs`

- [ ] **Step 3: Implement matcher + wire finish**

Keep legacy `parseWiRegexKey` or move it into matcher. Confidence: `0.75` literal, `0.7` regex, `0.55` if only secondary inferred.

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/matcher.js src/scene-source-trace.js tests/scene-source-trace-matcher.test.mjs
git commit -m "$(cat <<'EOF'
feat: ST-like inferred WI key matcher with selective logic

EOF
)"
```

---

### Task 8: UTF-8 trim + UI evidence, attachment, timeline

**Files:**
- Modify: `src/scene-source-trace.js` — `trimLorebookForStorage` uses `TextEncoder`
- Modify: `src/ui/scene-source-trace-ui.js`
- Modify: `css/scene-source-trace.css`
- Modify: `locales/_source.json`
- Test: `tests/scene-source-trace.test.mjs` (UI assertions)

**Interfaces (UI):**
```js
export function formatTraceEntryKeyLine(entry)
// inferred → uses t('Inferred key') / "предполагаемый ключ - { … }"
// constant → key - { constant }
// force → activation - { external }
// sticky → activation - { sticky }

export function buildTraceDrawerModel(...)
// adds: lorebooks attachmentSources on groups; loops timeline; evidenceLegend: true
```

Locale keys to add to `_source.json` (English source keys):
- `Inferred key`
- `External activation`
- `Sticky activation`
- `Attachment: Character Lore` / Global / Chat / Persona (or one template `Attachment: {{source}}`)
- `Scan loop {{n}} · {{state}}`
- `Evidence: engine` / `Evidence: inferred` / `Evidence: unknown`
- `Budget overflowed`

- [ ] **Step 1: Failing UI + trim tests**

```js
{
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).byteLength;
  // craft entries that fit char length but exceed bytes with multibyte — assert omitted increases
}

{
  const model = buildTraceDrawerModel({
    settings: { sceneSourceTrace: true, injectionMethod: 'inline' },
    meta: { injectionMethod: 'inline' },
    trace: migrateTraceToV3View({ /* v3 with loops + inferred trigger */ }),
  });
  assert.match(model.groups[0].items[0].keyLine, /предполагаемый|Inferred/i);
  assert.ok(Array.isArray(model.timeline));
  assert.equal(model.timeline[0].state, 'INITIAL');
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement trim + UI**

```js
function jsonUtf8Bytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
// while (entries.length && jsonUtf8Bytes(lb) > MAX) pop
```

Drawer: after world groups, render `.sp-source-trace-timeline` from `trace.loops`.  
Chip title attribute includes budget warning when `summary.budgetOverflowed`.  
Always run `migrateTraceToV3View(trace)` inside `buildTraceDrawerModel`.

- [ ] **Step 4: PASS**

Run: `node tests/run-all.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scene-source-trace.js src/ui/scene-source-trace-ui.js css/scene-source-trace.css locales/_source.json tests/scene-source-trace.test.mjs
git commit -m "$(cat <<'EOF'
feat: lore drawer evidence labels, timeline, UTF-8 trim

EOF
)"
```

---

### Task 9: Full capture-sequence integration test

**Files:**
- Modify: `tests/scene-source-trace-events.test.mjs`
- Modify: settings hint in `locales/_source.json` if wording still claims keys are definitive facts

**Interfaces:** none new — exercises public lifecycle API end-to-end

- [ ] **Step 1: Write integration test**

Sequence: `start` → `entriesLoaded` → `forceActivate` → `scanDone`×2 → `WORLD_INFO_ACTIVATED` → `finish`  
Assert: `v===3`, lorebooks sources, force trigger, firstSeenLoop, pre-gen causal safety, summary counts.

- [ ] **Step 2: Run full suite**

Run: `node tests/run-all.mjs`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/scene-source-trace-events.test.mjs locales/_source.json
git commit -m "$(cat <<'EOF'
test: lore inspector phase1 full capture sequence

EOF
)"
```

---

## Self-review (Phase 1)

| Vision | Task |
|--------|------|
| Baseline / fixture / causal doc | 1 |
| Evidence + migration | 2 |
| Pre-gen context | 3 |
| SCAN_DONE loops | 4 |
| ENTRIES_LOADED + FORCE | 5 |
| Settings + timedEffects | 6 |
| Inferred matcher | 7 |
| UI + UTF-8 | 8 |
| Integration | 9 |
| Segments / prompt insert / console / upstream / why-not / grouping modes | **Phase 2–4** |

## Execution handoff

Phase 1 plan saved. Next: execute this plan, then [Phase 2](2026-07-25-lorebook-inspector-phase2.md).

1. Subagent-Driven (recommended)  
2. Inline Execution  

Which approach?
