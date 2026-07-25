# Lorebook Inspector Phase 3 — Diagnostic Console Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Depends on:** [Phase 1](2026-07-25-lorebook-inspector-phase1.md) (required), [Phase 2](2026-07-25-lorebook-inspector-phase2.md) recommended for richer merge targets.
>
> **Roadmap:** [2026-07-25-lorebook-inspector-roadmap.md](2026-07-25-lorebook-inspector-roadmap.md)

**Goal:** Add an optional, time-boxed diagnostic logs adapter that can enrich triggers/rejection hints from SillyTavern World Info console output without ever overriding engine evidence or breaking capture when log format changes.

**Architecture:** Three adapters reconciled explicitly: Engine (Phase 1 events) > Diagnostic (this plan) > Inferred (Phase 1/2 matcher). Console interception is opt-in, scoped to active Together source-trace generation, and always forwards to the original `console` method.

**Tech Stack:** Same as Phase 1; no new dependencies.

## Global Constraints

- Setting default: `sceneSourceTraceDiagnostics: false`
- Intercept only while `_activeTrace` is non-null
- Never block/throw from console wrapper
- On unrecognized format → disable adapter for the rest of the session (flag on module) and leave a summary note `diagnostics: { status: 'disabled_unknown_format' }`
- Diagnostic fields use `evidence.type = 'diagnostic'`
- Reconciliation: if engine already set accepted/force/sticky, diagnostic may only add complementary match details, never flip accepted→rejected
- No persistence of full console lines by default (parse then discard); optional ring buffer of 50 parsed events in snapshot when setting on

## File Structure

| File | Responsibility |
|------|----------------|
| Create `src/scene-source-trace/diagnostics/console-intercept.js` | Install/uninstall wrappers |
| Create `src/scene-source-trace/diagnostics/parsers/st-1-18.js` | Versioned parser for ST 1.18 WI logs |
| Create `src/scene-source-trace/diagnostics/reconcile.js` | Merge diagnostic facts into trace entries |
| Create `src/scene-source-trace/diagnostics/index.js` | Public start/stop/probe API |
| Modify `src/scene-source-trace.js` | Start/stop diagnostics with capture lifecycle |
| Modify `src/constants.js` / settings UI | `sceneSourceTraceDiagnostics` |
| Modify `locales/_source.json` | Setting hint |
| Test: `tests/scene-source-trace-diagnostics.test.mjs` |

---

### Task 1: Console intercept primitive

**Files:**
- Create: `src/scene-source-trace/diagnostics/console-intercept.js`
- Test: `tests/scene-source-trace-diagnostics.test.mjs`

**Interfaces:**
```js
export function installConsoleIntercept({ onDebug, onLog } = {})
// wraps console.debug and console.log; returns uninstall()
// must call original.apply(console, args) even if onDebug throws
```

- [ ] **Step 1: Failing test**

```js
import assert from 'node:assert/strict';
import { installConsoleIntercept } from '../src/scene-source-trace/diagnostics/console-intercept.js';

{
  const seen = [];
  const orig = console.debug;
  const calls = [];
  console.debug = (...args) => { calls.push(args); };
  const uninstall = installConsoleIntercept({
    onDebug: (args) => { seen.push(args); throw new Error('listener boom'); },
  });
  console.debug('[WI] test', 1);
  assert.equal(calls.length, 1);
  assert.equal(seen.length, 1);
  uninstall();
  console.debug = orig;
}
```

- [ ] **Step 2: Run — FAIL**

Run: `node --test tests/scene-source-trace-diagnostics.test.mjs`

- [ ] **Step 3: Implement**

```js
export function installConsoleIntercept({ onDebug, onLog } = {}) {
  const targets = [
    ['debug', onDebug],
    ['log', onLog],
  ];
  const previous = {};
  for (const [name, handler] of targets) {
    if (typeof handler !== 'function') continue;
    previous[name] = console[name];
    console[name] = (...args) => {
      try { handler(args); } catch { /* never break host */ }
      return previous[name].apply(console, args);
    };
  }
  return () => {
    for (const name of Object.keys(previous)) console[name] = previous[name];
  };
}
```

- [ ] **Step 4: PASS + commit**

```bash
git add src/scene-source-trace/diagnostics/console-intercept.js tests/scene-source-trace-diagnostics.test.mjs
git commit -m "$(cat <<'EOF'
feat: add safe console intercept for WI diagnostics

EOF
)"
```

---

### Task 2: ST 1.18 parser + compatibility probe

**Files:**
- Create: `src/scene-source-trace/diagnostics/parsers/st-1-18.js`
- Test: `tests/scene-source-trace-diagnostics.test.mjs`

**Interfaces:**
```js
export const PARSER_ID = 'st-1.18';
export function probeWiLogFormat(sampleLines)
// sampleLines: string[]
// → { ok: boolean, parserId: string }

export function parseWiConsoleArgs(args)
// → null | {
//   kind: 'primary_match'|'secondary_match'|'budget'|'sticky'|'cooldown'|'delay'|'other',
//   world?: string, uid?: string|number, key?: string, detail?: string
// }
```

Ground parser on patterns actually present in local ST `world-info.js` `log(...)` / `console.debug('[WI]...')` strings. At minimum support:

```text
[WI] Entry with primary key match
activated because active sticky
```

If probe fails on 3 consecutive unrecognized `[WI]` lines during a generation, mark adapter disabled.

- [ ] **Step 1: Failing tests** with fixture lines copied from ST source comments/strings
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement parser narrowly (YAGNI — only patterns with tests)**
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: parse SillyTavern 1.18 World Info debug log lines

EOF
)"
```

---

### Task 3: Reconciliation layer

**Files:**
- Create: `src/scene-source-trace/diagnostics/reconcile.js`
- Test: `tests/scene-source-trace-diagnostics.test.mjs`

**Interfaces:**
```js
export function reconcileDiagnosticEvent(entry, diagEvent)
// mutates/returns entry copy:
// - may add triggers[{ type, originalKey, evidence: diagnostic }]
// - must NOT remove engine accepted stage
// - must NOT replace inferred matchedText if engine/diagnostic conflict — keep both triggers
```

- [ ] **Step 1: Failing test**

```js
{
  const entry = {
    stages: { accepted: { value: true, evidence: 'engine' } },
    triggers: [{ type: 'primary_key', matchedText: 'A', evidence: { type: 'inferred' } }],
  };
  const out = reconcileDiagnosticEvent(entry, {
    kind: 'primary_match', key: 'Artoria', world: 'Fate', uid: 42,
  });
  assert.equal(out.stages.accepted.evidence, 'engine');
  assert.ok(out.triggers.some(t => t.evidence.type === 'diagnostic' && t.originalKey === 'Artoria'));
  assert.ok(out.triggers.some(t => t.evidence.type === 'inferred'));
}
```

- [ ] **Step 2–4: Implement + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: reconcile diagnostic WI logs without overriding engine evidence

EOF
)"
```

---

### Task 4: Lifecycle wiring + setting

**Files:**
- Create: `src/scene-source-trace/diagnostics/index.js`
- Modify: `src/scene-source-trace.js` start/finish/cancel
- Modify: `src/constants.js` DEFAULTS
- Modify: `src/settings-ui/create-settings.js`, `bind-ui.js`
- Modify: `locales/_source.json`
- Test: integration section in diagnostics test

**Interfaces:**
```js
export function startDiagnostics({ enabled, onEvent } = {})
export function stopDiagnostics()
export function getDiagnosticsStatus() // 'off'|'active'|'disabled_unknown_format'
```

- [ ] **Step 1: Failing test** — start with enabled true installs intercept; finish uninstalls; original console restored
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**; pass setting from interceptor/getSettings into start
- [ ] **Step 4: PASS + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: optional WI diagnostic logging adapter gated by setting

EOF
)"
```

---

### Task 5: UI badge for diagnostic evidence

**Files:**
- Modify: `src/ui/scene-source-trace-ui.js`, CSS, locales
- Test: UI assertion that diagnostic trigger shows «Получено из диагностической трассы» / `Evidence: diagnostic`

- [ ] **Step 1–4: TDD + commit**

```bash
git commit -m "$(cat <<'EOF'
feat: show diagnostic evidence badges in lore drawer

EOF
)"
```

---

### Task 6: Failure isolation test

**Files:**
- Test only

- [ ] **Step 1: Write test** — feed 5 garbage `[WI] totally unknown xyz` lines → status `disabled_unknown_format`; subsequent `WORLD_INFO_ACTIVATED` path still finishes `v:3` with engine accepted
- [ ] **Step 2: `node tests/run-all.mjs` PASS**
- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test: diagnostics adapter auto-disables on unknown WI log format

EOF
)"
```

---

## Self-review (Phase 3)

| Vision §6.11 | Task |
|--------------|------|
| Separate console module | 1 |
| Optional / time-boxed | 4 |
| Forward original console | 1 |
| Versioned parsers | 2 |
| Compatibility probe + auto-disable | 2, 6 |
| No overwrite of engine | 3 |
| Reconciliation | 3 |
| UI evidence | 5 |

## Execution handoff

Then proceed to [Phase 4 upstream ST](2026-07-25-lorebook-inspector-phase4-upstream-st.md) for engine-grade match data.

1. Subagent-Driven (recommended)  
2. Inline Execution
