# Lorebook Inspector Phase 4 — Upstream SillyTavern Structured Match API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repos:** This plan spans **two repositories**:
> 1. SillyTavern core — `D:\SillyTavern-Launcher\SillyTavern` (or upstream fork)
> 2. ScenePulseN — this repo
>
> **Depends on:** Phase 1 data model (`triggers`, `evidence`, `loops`) so ScenePulseN can consume new fields without another schema break.
>
> **Roadmap:** [2026-07-25-lorebook-inspector-roadmap.md](2026-07-25-lorebook-inspector-roadmap.md)

**Goal:** Add backward-compatible structured match/rejection data to SillyTavern World Info events so ScenePulseN can consume engine-grade primary **and secondary** matches, selective evaluation, and `content_empty_after_regex` → `rendered`, while keeping inferred/diagnostic fallbacks for older hosts. Engine-grade source segments are **out of scope** (Phase 5).

**Architecture:** Change ST `WorldInfoBuffer.matchKeys` (or adjacent helper) to return a match object instead of boolean; thread results into per-entry decisions emitted on `WORLDINFO_SCAN_DONE` (extend payload) and/or final `WORLD_INFO_ACTIVATED` enrichment. ScenePulseN feature-detects `decision.primaryMatch` / `entry._spMatch` and upgrades trigger evidence to `engine`.

**Tech Stack:** SillyTavern frontend JS (`public/scripts/world-info.js`, tests if present); ScenePulseN event adapters.

## Global Constraints

- Backward compatible: existing listeners that ignore new fields keep working
- `WORLDINFO_SCAN_DONE` remains mutable only for fields ST already documents as mutable (`state.next`, `activated.text`, recursion delay, budget) — **new `decisions` array must be treated as read-only by ST after emit** (ScenePulseN copies immediately)
- No extra production console logging of match text by default
- Do not expose hidden lorebook content to users lacking access (respect ST visibility rules)
- Performance: allocate match objects only on successful matches / explicit decision records; avoid stringify of full buffer
- ScenePulseN minimum stays `1.18.0`; new fields optional via feature detect

## File Structure (SillyTavern)

| File | Responsibility |
|------|----------------|
| Modify `public/scripts/world-info.js` | Match result object; decision records; emit |
| Modify/create ST unit tests for WI matching if test harness exists |
| Docs note in ST PR description (lifecycle) |

## File Structure (ScenePulseN)

| File | Responsibility |
|------|----------------|
| Modify `src/scene-source-trace/event-adapters.js` | Read `decisions` / structured matches |
| Modify `src/scene-source-trace.js` | Prefer engine triggers when present |
| Modify `src/scene-source-trace/migrate.js` | Passthrough |
| Test: `tests/scene-source-trace-engine-match.test.mjs` |
| Update README/CHANGELOG compatibility note |

## Proposed ST payloads

### Match result (replace boolean internally)

```js
/**
 * @typedef {object} WIKeyMatchResult
 * @property {boolean} matched
 * @property {string} [text]
 * @property {number} [index]
 * @property {Object<string,string>} [groups]
 * @property {string} [originalKey]
 * @property {string} [substitutedKey]
 */
```

`matchKeys` becomes:

```js
matchKeys(haystack, needle, entry) {
  const keyRegex = parseRegexFromString(needle);
  if (keyRegex) {
    keyRegex.lastIndex = 0;
    const m = keyRegex.exec(haystack);
    if (!m) return { matched: false, originalKey: needle };
    return {
      matched: true,
      text: m[0],
      index: m.index,
      groups: m.groups || {},
      originalKey: needle,
      substitutedKey: needle,
    };
  }
  // literal branch: on success return { matched:true, text, index, originalKey }
  // on failure { matched:false, originalKey: needle }
}
```

All current call sites that expect boolean must use `result.matched` (mechanical update in `world-info.js` only).

### Decision record on each SCAN_DONE

```js
args.decisions = [
  {
    entry: { world: 'Fate Characters', uid: 42 },
    loop: 1,
    scanState: 'RECURSION', // or numeric + name
    status: 'accepted', // accepted|rejected|suppressed
    reason: 'primary_key', // see list below
            primaryMatch: { /* WIKeyMatchResult */ },
            secondaryMatches: [
              { matched: true, text: 'Camelot', index: 10, originalKey: 'Camelot', polarity: 'positive' },
            ],
            selectiveLogic: 0,
            selectivePassed: true,
            // source: omitted in this PR — Phase 5
  },
];
```

### Rejection / status reasons (exact set)

```js
export const WI_DECISION_REASON = {
  PRIMARY_KEY: 'primary_key',
  SECONDARY_FAILED: 'secondary_failed',
  PROBABILITY_FAILED: 'probability_failed',
  BUDGET_REJECTED: 'budget_rejected',
  COOLDOWN: 'cooldown',
  DELAYED: 'delay',
  GROUP_LOSER: 'group_loser',
  GENERATION_TRIGGER_MISMATCH: 'generation_trigger_mismatch',
  RECURSION_EXCLUDED: 'recursion_excluded',
  DISABLED: 'disabled',
  CONTENT_EMPTY_AFTER_REGEX: 'content_empty_after_regex',
  CONSTANT: 'constant',
  FORCE_ACTIVATE: 'force_activate',
  STICKY: 'sticky',
  VECTOR: 'vector',
  NO_PRIMARY_MATCH: 'no_primary_match',
};
```

### Optional FORCE_ACTIVATE provenance (small additive change)

Encourage emitters to send:

```js
eventSource.emit(WORLDINFO_FORCE_ACTIVATE, { source: 'vectors', entries: [...] })
```

Keep accepting bare arrays for compatibility; ST listener normalizes:

```js
const list = Array.isArray(payload) ? payload : payload?.entries;
const source = Array.isArray(payload) ? undefined : payload?.source;
```

---

### Task 1 (ST): Match result helper + boolean call-site update

**Files (ST):**
- Modify: `public/scripts/world-info.js` (`WorldInfoBuffer.matchKeys` + callers)

**Interfaces:**
- Produces: `WIKeyMatchResult`; callers use `.matched`

- [ ] **Step 1: Write ST-side unit test** (if ST has WI tests; otherwise add a minimal Node-exported pure helper test in a new `dynamic-import`able pure function extracted next to matcher)

Prefer extracting pure functions:

```js
export function matchWorldInfoKey(haystack, needle, { caseSensitive, matchWholeWords, transform }) 
```

tested without browser.

- [ ] **Step 2: Run ST tests / manual dry-run WI scan**
- [ ] **Step 3: Implement match object + update all `.matchKeys` usages in file**
- [ ] **Step 4: Verify no behavior change on boolean outcomes**
- [ ] **Step 5: Commit on ST branch**

```bash
git commit -m "$(cat <<'EOF'
feat(world-info): return structured key match results from matcher

EOF
)"
```

---

### Task 2 (ST): Emit `decisions` on scan loops **and** prompt-build (prompt-regex)

**Files (ST):**
- Modify: `public/scripts/world-info.js`
  - Scan loop emit ~5050 (`WORLDINFO_SCAN_DONE`)
  - Prompt build ~5084–5091 (`getRegexedString` / empty content skip)

**Interfaces:**
- Produces: `args.decisions` on each `WORLDINFO_SCAN_DONE` (accepted + rejected-when-known during scan)
- Additionally produces **prompt-build decisions** after regex (see below)

#### 2A — Scan-loop decisions

Include accepted decisions with `primaryMatch` / `secondaryMatches` / selective outcome when known.

Each decision may include:

```js
{
  entry: { world, uid },
  loop: number,
  scanState: 'INITIAL'|'RECURSION'|'MIN_ACTIVATIONS',
  status: 'accepted'|'rejected'|'suppressed',
  reason: string, // WI_DECISION_REASON.*
  primaryMatch: WIKeyMatchResult | null,
  secondaryMatches: Array<WIKeyMatchResult & { polarity: 'positive'|'negative' }>,
  selectiveLogic: number, // world_info_logic enum
  selectivePassed: boolean | null,
  // source: OMITTED in this PR (Phase 5)
}
```

#### 2B — Prompt-regex empty content (required — not optional)

**Exact site** in ST 1.18 `world-info.js` (BUILDING PROMPT):

```js
const content = getRegexedString(entry.content, regex_placement.WORLD_INFO, {
  depth: regexDepth, isMarkdown: false, isPrompt: true,
});
if (!content) {
  console.debug(`[WI] Entry ${entry.uid}`, 'skipped adding to prompt due to empty content', entry);
  // ← record decision HERE, then return
  return;
}
```

For every activated entry that fails this check, push:

```js
{
  entry: { world: entry.world, uid: entry.uid },
  loop: null,
  scanState: 'NONE',
  phase: 'prompt_build',
  status: 'suppressed', // still in allActivatedEntries, but not written into WI strings
  reason: 'content_empty_after_regex',
  primaryMatch: null,
  secondaryMatches: [],
  selectiveLogic: entry.selectiveLogic ?? 0,
  selectivePassed: null,
}
```

**Emit strategy (locked, backward compatible):**
After the BUILDING PROMPT `forEach` completes (and before `return { worldInfoBefore, … }`), if `!isDryRun` and `promptBuildDecisions.length > 0`:

```js
await eventSource.emit(event_types.WORLDINFO_SCAN_DONE, {
  state: { current: scan_state.NONE, next: scan_state.NONE, loopCount: -1 },
  phase: 'prompt_build',
  new: { all: [], successful: [] },
  activated: { entries: allActivatedEntries, text: allActivatedText },
  sortedEntries,
  recursionDelay: { availableLevels: [], currentLevel: currentRecursionDelayLevel },
  budget: { current: budget, overflowed: token_budget_overflowed },
  timedEffects,
  decisions: promptBuildDecisions,
});
```

ScenePulseN must treat `phase === 'prompt_build'` / `loopCount === -1` as **not a scan loop** (do not append to `loops[]`; only apply decisions → `rendered` / why-not).

- [ ] **Step 1: Add fixture-driven tests**
  1. Accepted primary_key decision with `primaryMatch.text`
  2. Entry activated with non-empty `content` that `getRegexedString` turns into `''` → decision `reason: 'content_empty_after_regex'`, `status: 'suppressed'`, `phase: 'prompt_build'`
- [ ] **Step 2: FAIL then implement scan decisions + prompt-build decisions**
- [ ] **Step 3: Ensure listeners mutating old mutable SCAN_DONE fields still work; `decisions` ignored by core after emit**
- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(world-info): emit scan and prompt-build WI decisions including empty regex content

EOF
)"
```

---

### Task 3 (ST): Source segment metadata — **cut from this PR**

**Locked decision:** Do **not** add `source` segment metadata in the SillyTavern PR.  
Reason: `WorldInfoBuffer` builds a joined haystack; exposing segment provenance needs buffer redesign → **Phase 5 / separate ST buffer-provenance PR**. ScenePulseN keeps Phase 2 **inferred** `triggers[].source` only. Decision records omit `source`.

- [ ] **Step 1: Document in ST PR body** that engine `source` is deferred to a follow-up PR; ScenePulseN uses inferred segments
- [ ] **Step 2: No code change for this task** (checklist only — prevents scope creep)

---

### Task 4 (ST): FORCE_ACTIVATE payload normalization + docs

**Files (ST):**
- Modify FORCE_ACTIVATE listener (~1020)
- PR description documents event lifecycle

**Locked behavior:**
```js
// accept both:
//   entriesArray
//   { source: string, entries: entriesArray }
const list = Array.isArray(payload) ? payload : (payload?.entries || []);
const forceSource = Array.isArray(payload) ? '' : String(payload?.source || '');
// store forceSource on each external activation record for the current scan
// (module-level Map world.uid → source string, cleared in resetExternalEffects)
```

- [ ] **Step 1: Test** array form still works; object form `{source:'vectors', entries}` activates identically and records source `'vectors'`
- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat(world-info): accept optional source on WORLDINFO_FORCE_ACTIVATE

EOF
)"
```

---

### Task 5 (ST): Open upstream PR

**Files:** none in ScenePulseN

PR requirements (from vision):
1. Backward compatible
2. No meaningful perf regression on large lorebooks
3. No default production console dump of match text
4. Extensions receive copies / must copy Maps themselves (document)
5. Hidden lorebooks not newly exposed
6. Tests: literal, regex, selective, recursion, vector/force
7. Document lifecycle of WI events in PR body

- [ ] **Step 1: Push branch + `gh pr create` against SillyTavern upstream/fork**
- [ ] **Step 2: Link PR URL in ScenePulseN CHANGELOG under Unreleased**

---

### Task 6 (ScenePulseN): Consume `decisions` — primary, secondary, selective, rendered

**Files:**
- Modify: `src/scene-source-trace/event-adapters.js`
- Modify: `src/scene-source-trace.js` — `recordWorldInfoScanDone` recognizes `phase: 'prompt_build'`
- Test: `tests/scene-source-trace-engine-match.test.mjs`

**Interfaces:**
```js
export function applyScanDecisions(traceState, decisions, { phase = 'scan' } = {})

// Logic map (ST world_info_logic → name):
// 0 AND_ANY, 1 NOT_ALL, 2 NOT_ANY, 3 AND_ALL
```

**Required behavior:**

1. **Primary (scan phase):** for accepted decision with `primaryMatch.matched`:
   ```js
   {
     type: 'primary_key',
     originalKey: primaryMatch.originalKey,
     matchedText: primaryMatch.text,
     matchIndex: primaryMatch.index ?? -1,
     groups: primaryMatch.groups ?? null,
     evidence: { type: 'engine', confidence: 1 },
   }
   ```
   Remove/skip inferred `primary_key` triggers for that `entryKey`.

2. **Secondary (scan phase):** for each item in `secondaryMatches[]`:
   ```js
   {
     type: 'secondary_key',
     originalKey,
     matchedText: text ?? '',
     matchIndex: index ?? -1,
     groups: groups ?? null,
     polarity: 'positive' | 'negative', // from decision payload; required
     evidence: { type: 'engine', confidence: 1 },
   }
   ```
   Negative polarity = key checked for NOT_* logics (matched or surveyed per ST payload).

3. **Selective evaluation (scan phase):** always set when `selectiveLogic` is present on decision:
   ```js
   entry.selectiveEvaluation = {
     logic: 'AND_ANY'|'NOT_ALL'|'NOT_ANY'|'AND_ALL', // from numeric enum
     passed: !!selectivePassed,
     evidence: 'engine', // string, same convention as stages.*.evidence
   }
   ```

4. **Rendered (prompt_build phase):** when `reason === 'content_empty_after_regex'`:
   ```js
   entry.stages.rendered = { value: false, evidence: 'engine' };
   entry.rejection = { reason: 'content_empty_after_regex', evidence: 'engine' };
   ```
   When entry accepted AND no such suppression decision → `stages.rendered = { value: true, evidence: 'engine' }` at finish (only if any prompt_build decisions were received for the generation; otherwise leave `unknown`).

5. **Loops:** if `args.phase === 'prompt_build'` OR `loopCount === -1`, do **not** push onto `trace.loops`.

- [ ] **Step 1: Failing tests**

```js
{
  // primary engine
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true, chat: [{ mes: 'no key here' }],
  });
  recordWorldInfoScanDone({
    state: { current: 1, next: 0, loopCount: 0 },
    activated: { entries: new Map([['Fate.42', { world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], content: 'x', comment: 'A' }]]), text: 'x' },
    budget: { current: 1, overflowed: false },
    decisions: [{
      entry: { world: 'Fate', uid: 42 },
      loop: 0,
      scanState: 'INITIAL',
      status: 'accepted',
      reason: 'primary_key',
      primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
      secondaryMatches: [
        { matched: true, text: 'Camelot', index: 10, originalKey: 'Camelot', polarity: 'positive' },
      ],
      selectiveLogic: 0,
      selectivePassed: true,
    }],
    timedEffects: { isEffectActive: () => false },
  });
  recordWorldInfoActivation([{ world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], comment: 'A', content: 'x' }]);
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  const e = trace.lorebook.entries[0];
  assert.equal(e.triggers.find(t => t.type === 'primary_key').evidence.type, 'engine');
  const sec = e.triggers.find(t => t.type === 'secondary_key');
  assert.equal(sec.evidence.type, 'engine');
  assert.equal(sec.polarity, 'positive');
  assert.deepEqual(e.selectiveEvaluation, { logic: 'AND_ANY', passed: true, evidence: 'engine' });
}

{
  // content empty after prompt-regex → rendered false
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true, chat: [{ mes: 'Artoria' }],
  });
  const entry = { world: 'Fate', uid: 42, key: ['Artoria'], comment: 'A', content: 'will be emptied' };
  recordWorldInfoScanDone({
    state: { current: 1, next: 0, loopCount: 0 },
    activated: { entries: new Map([['Fate.42', entry]]), text: 'x' },
    budget: { current: 1, overflowed: false },
    decisions: [{
      entry: { world: 'Fate', uid: 42 },
      loop: 0, scanState: 'INITIAL', status: 'accepted', reason: 'primary_key',
      primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
      secondaryMatches: [], selectiveLogic: 0, selectivePassed: true,
    }],
    timedEffects: { isEffectActive: () => false },
  });
  recordWorldInfoScanDone({
    phase: 'prompt_build',
    state: { current: 0, next: 0, loopCount: -1 },
    activated: { entries: new Map([['Fate.42', entry]]), text: 'x' },
    budget: { current: 1, overflowed: false },
    decisions: [{
      entry: { world: 'Fate', uid: 42 },
      loop: null, scanState: 'NONE', phase: 'prompt_build',
      status: 'suppressed', reason: 'content_empty_after_regex',
      primaryMatch: null, secondaryMatches: [],
    }],
    timedEffects: { isEffectActive: () => false },
  });
  recordWorldInfoActivation([entry]);
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  assert.equal(trace.loops.length, 1); // prompt_build must not add a loop
  assert.equal(trace.lorebook.entries[0].stages.rendered.value, false);
  assert.equal(trace.lorebook.entries[0].stages.rendered.evidence, 'engine');
  assert.equal(trace.lorebook.entries[0].rejection.reason, 'content_empty_after_regex');
}

{
  // AND_ALL failure — secondary missing → not in WORLD_INFO_ACTIVATED; lands in candidates + engine why-not
  _resetSceneSourceTraceForTests();
  startSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 }, {
    enabled: true, chat: [{ mes: 'Artoria without second key' }],
  });
  recordWorldInfoEntriesLoaded({
    globalLore: [],
    characterLore: [{ world: 'Fate', uid: 42, key: ['Artoria'], keysecondary: ['Camelot'], comment: 'A', content: 'x' }],
    chatLore: [],
    personaLore: [],
  });
  recordWorldInfoScanDone({
    state: { current: 1, next: 0, loopCount: 0 },
    activated: { entries: new Map(), text: '' },
    budget: { current: 1, overflowed: false },
    decisions: [{
      entry: { world: 'Fate', uid: 42 },
      loop: 0,
      scanState: 'INITIAL',
      status: 'rejected',
      reason: 'secondary_failed',
      primaryMatch: { matched: true, text: 'Artoria', index: 0, originalKey: 'Artoria' },
      secondaryMatches: [
        { matched: false, text: '', index: -1, originalKey: 'Camelot', polarity: 'positive' },
      ],
      selectiveLogic: 3, // AND_ALL
      selectivePassed: false,
    }],
    timedEffects: { isEffectActive: () => false },
  });
  // no WORLD_INFO_ACTIVATED for this uid
  const trace = finishSceneSourceTrace({ chatKey: 'c', targetMessageId: 1, swipeId: 0 });
  const cand = trace.candidates.find(c => String(c.uid) === '42');
  assert.ok(cand);
  assert.equal(cand.rejection?.reason, 'secondary_failed');
  assert.equal(cand.rejection?.evidence, 'engine');
  assert.deepEqual(cand.selectiveEvaluation, {
    logic: 'AND_ALL', passed: false, evidence: 'engine',
  });
  assert.ok(cand.triggers.some(t => t.type === 'primary_key' && t.evidence.type === 'engine'));
  assert.ok(cand.triggers.some(t => t.type === 'secondary_key' && t.matchedText === ''));
}
```

Import `recordWorldInfoEntriesLoaded`. Persist rejection/selectiveEvaluation/triggers onto **candidates** when decision `status === 'rejected'` (not only on accepted lorebook entries). Why-not copy is Task 7.

- [ ] **Step 2: Run — FAIL until adapter implemented**
- [ ] **Step 3: Implement `applyScanDecisions` + wire `recordWorldInfoScanDone`**
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: apply engine WI primary/secondary decisions and rendered status

EOF
)"
```

---

### Task 7 (ScenePulseN): Engine rejection → why-not upgrade

**Files:**
- Modify: `src/scene-source-trace/why-not.js` (from Phase 2)
- Modify UI to show engine reasons when `evidence: engine`
- Test: why-not with `reason: 'budget_rejected'` **and** `content_empty_after_regex`

- [ ] **Step 1: Failing tests**

```js
{
  const why = explainWhyNot(
    { world: 'Fate', uid: '42', rejection: { reason: 'secondary_failed', evidence: 'engine' },
      selectiveEvaluation: { logic: 'AND_ALL', passed: false, evidence: 'engine' } },
    { trace: { summary: {}, lorebook: { entries: [] }, candidates: [] } },
  );
  assert.equal(why.evidence, 'engine');
  assert.ok(why.lines.some(l => /secondary/i.test(l) || /AND_ALL/i.test(l)));
}
{
  const why = explainWhyNot(
    { world: 'Fate', uid: '42',
      stages: { accepted: { value: true, evidence: 'engine' }, rendered: { value: false, evidence: 'engine' } },
      rejection: { reason: 'content_empty_after_regex', evidence: 'engine' } },
    { trace: {} },
  );
  assert.equal(why.evidence, 'engine');
  assert.ok(why.lines.some(l => /regex|empty|content/i.test(l)));
}
```

- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: surface engine WI rejection reasons in why-not panel

EOF
)"
```

---

### Task 8 (ScenePulseN): Compatibility matrix note + fallback proof

**Files:**
- README / CHANGELOG
- Test: when `decisions` absent, inferred path still works (Phase 1 behavior); secondary stays inferred; `rendered` stays unknown

- [ ] **Step 1: Test** both branches in `scene-source-trace-engine-match.test.mjs`
- [ ] **Step 2: Document** ST versions: `1.18.0` without decisions → inferred; ST builds with decisions → engine primary/secondary/rendered
- [ ] **Step 3: Document** source segments remain inferred until Phase 5 buffer-provenance PR
- [ ] **Step 4: `node tests/run-all.mjs` PASS**
- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: document engine vs inferred WI match compatibility

EOF
)"
```

---

## Self-review (Phase 4)

| Vision §6.12 / §2.4 | Task |
|---------------------|------|
| Structured match API | 1–2 |
| `content_empty_after_regex` + rendered | **2B, 6, 7** |
| Engine secondaryMatches + selectiveLogic | **6** |
| Rejection reasons | 2, 7 |
| Matcher returns exec data | 1 |
| FORCE source field | 4 |
| PR quality bar | 5 |
| ScenePulseN consumes engine data | 6–8 |
| Backward compatible fallback | 8 |
| Engine-grade source segments | **Cut — Phase 5** |

## Execution handoff

Phase 4 can start as an ST PR in parallel after Phase 1 freezes trigger field names. ScenePulseN Tasks 6–8 merge after ST decisions land (or against a mocked `decisions` fixture immediately).

1. Subagent-Driven (recommended)  
2. Inline Execution
