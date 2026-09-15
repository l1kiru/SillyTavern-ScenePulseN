# ScenePulse — Architecture Map

A short reference for non-obvious cross-cutting rules that span multiple
modules. File-level headers cover module-local invariants; this document
covers the things you'd otherwise have to reverse-engineer by reading
five files.

## Parallel extraction and continuity

`state-records.js` defines the optional evidence-backed state facets and their
normalization: character `conditions`, `emotionalState`, `establishedTraits`, scene
`trackedItems`/`worldFacts`, and optional provenance on `knowledge` records. The
character fields join the continuity registry and built-in key protection; root
records belong to Global. The player exists only as an item holder, never as an NPC.
Stable item IDs survive transfers; canonical identity resolution updates NPC holder
names. Quantity is nullable, and extraction validation accepts explicit null only
where the schema allows it. Existing saved knowledge records need no migration.

Each facet uses existing profile field toggles. Knowledge provenance trims nested
schema fields and context while preserving the base knowledge contract. Shared
projection filters all new disabled fields before Together/Separate/parallel context
is sent. Conditions, traits, world facts and items are durable complete-list records;
omission carries them, `[]` clears. Emotions are transient: Delta omission and partial
character fallback clear them, and off-scene context never includes them. No code
advances conditions or inventory with elapsed time. `state-records-view.js` renders
escaped RU/EN labels in the scene and character context UI, including character wiki.

`continuity.js` owns the optional `characters[].activityPlans` and root
`narrativeHooks` contracts. They share the existing built-in field toggle path
(`char_activityPlans`, `narrativeHooks`) and require no migration for old snapshots.
Plans belong to character lanes; hooks belong to Global. Full refresh carries omitted
records, Delta replaces a supplied list (including `[]`), and normalization preserves
only valid, source-backed records with stable ids (at most 6 plans per NPC / 20 hooks).
Terminal records stay available in saved history; `prepareSnapshotContext` excludes
them and disabled fields. Lane previous-state prompts use that same projection without
mutating the base snapshot used for merge. Neither feature advances time, simulates
off-scene actions, adjusts meters, nor enforces narrative outcomes.

Separate optionally uses `parallel-build.js` through Connection Manager. Core owns
time, location, current NPC roster and routing tags; character lanes own character
continuity and custom character fields; Global owns relationships, quests, story threads
and global custom fields. Lanes only return data. The engine validates, normalizes and
saves one assembled snapshot. Only failed lanes are retried, within the configured
concurrency limit. Automatic panel routing uses `SCENE_TAG_REGISTRY`, including `rest`.

When character lanes are needed, Core requests `charactersPresent` even if its UI field
or Scene panel is hidden. This operational roster stays in the snapshot for merge and
presence filtering; UI visibility and narrative context projection still honor field
settings. Audience validation applies to current-scene characters, not restored archive
entries. A newly active audience panel needs initial values; ordinary Delta omissions
can carry values already recorded for that character.

The engine captures the schema, panel specifications, prompt role and a cloned base
snapshot before transport. Parallel prompt macros are resolved through the ST context
API before the first request and reused by subsequent lanes and retries, including
schema descriptions. Saving uses the same frozen custom-field specifications, so an
in-flight settings edit cannot strip accepted values. Chat/swipe ownership is checked
before persistence. Together also clones its base snapshot at interception.

Full-refresh debt is held per chat with an operation epoch. Consuming it returns a
ticket; cancellation/failure can restore only that ticket's owner and epoch. A late old
request cannot rearm a newer successful operation. Together chat changes, Stop and
watchdog cleanup restore debt before dropping the inline context. Section updates do
not consume the whole-scene ticket.

Partial builds record `_spMeta.parallel.partial` and show a localized notice. Carried
durable facts remain available; transient thoughts, intentions, immediate needs and
reactions are cleared. Off-scene records remain last-known state without simulation.
Both narrative delivery modes use `prepareSnapshotContext`; parallel transport does
not disable the Separate embedding preference. Narrative output is never graded or
regenerated to enforce predicted events.

Automatic routing is effective only in Separate with parallel enabled. Other modes
use manual panel selection while retaining the requested strategy. Connection Manager
uses its saved profile preset; the legacy preset override belongs to ordinary requests.

## Module graph

```
state ─┐
        ├──► settings ──► profiles ──► generation ──► ui
        │                                  ▲
        │                                  └─ schema, prompts, normalize
        │
builtins ┴──► (schema.js, prompt.js — pure data, no logic)
i18n / utils ──► (leaves — imported widely, import nothing)
```

- `src/state.js` — single mutable state object behind setter functions.
  See its header for why ESM live bindings forced the `export let` +
  setter pattern.
- `src/settings.js` — bridges SillyTavern's extension settings into
  ScenePulse's profile model. Owns `getActiveSchema()`,
  `getActivePrompt()`, `getLatestSnapshot()`, and the legacy-mirror
  helpers. The single longest file in the codebase by intent — settings
  surface area is large.
- `src/profiles.js` — profile CRUD + cloning. `makeProfile` is the
  single constructor; never reach in and assemble a profile literal.
- `src/generation/` — pipeline (extraction → normalize → save) plus the
  interceptor that starts Together delivery. Together no longer mutates
  `chat`; it builds a `PromptInjectionPlan` in
  [`prompt-injection.js`](src/generation/prompt-injection.js) and
  registers extension prompts (`IN_PROMPT` + `IN_CHAT` tail). Read
  [`interceptor.js`](src/generation/interceptor.js) and
  `prompt-injection.js` before touching this directory.
- `src/builtins/` — `BUILTIN_SCHEMA` and `BUILTIN_PROMPT`. Edit these
  files to extend the bundled defaults, NOT `src/constants.js` (which
  re-exports them for backward compatibility).
- `src/ui/` — flat directory; one file per overlay/widget. The shared
  overlay lifecycle helper is [`dialog-base.js`](src/ui/dialog-base.js)
  but most legacy modules still inline their own ESC + click-outside
  handlers. Migration is incremental — see that file's header.

## Source-of-truth rules

These rules are load-bearing across the codebase and not always obvious
from the call site:

1. **Active profile is the source of truth (post-v6.13.0).** Anything
   under `s.profiles[s.activeProfileId]` wins over the same key at the
   root of `s`. Root settings are legacy mirrors kept so older code
   paths still read sensible values; new code should always go through
   `getActiveProfile(s)` and `buildProfileView(s, profile)`.
2. **`getActiveSchema()` falls back gracefully.** When `profile.schema`
   is corrupt JSON, it falls through to the dynamic builder AND warns
   the user once (toastr) so a silent tracker-mostly-empty failure
   doesn't go unnoticed. See `src/settings.js`.
3. **Wiki entries are permanent.** Characters added to the wiki never
   disappear from there even if they leave the active scene. Tests in
   `tests/wiki-permanence.test.mjs` enforce this.
4. **`{{user}}` is never a character.** Filter at every read site that
   walks `characters[]` or `relationships[]` — the LLM occasionally
   tries to slip the user persona in. Multiple normalize.js paths and
   schema descriptions guard against it.

## Descriptive scene continuity

`src/continuity.js` owns additive continuity field schemas, extraction rules,
normalizers, and the shared prompt projection. Dynamic profiles expose
`storyThreads`, character `innerThoughtBasis` / `currentIntent` / `knowledge`,
and relationship `lastReaction` / `relationshipBasis` / `changeReason` /
`unresolvedConflicts`. Optional additions preserve compatibility with older
snapshots; explicit custom schemas and full prompt overrides remain unchanged.

Continuity describes the final scene, never a required next action. The
narrative is authoritative; there is no narrative conformance check or rewrite.
The shared rule block lives below `FIELD SPECIFICATIONS`, so both Separate and
Together receive it. `prepareSnapshotContext` filters disabled continuity fields
and resolved threads without mutating stored history. Off-scene context includes
last-known knowledge/goals and relationship foundations/conflicts, not simulated
progress or fresh thoughts.

Delta arrays for knowledge, conflicts and threads replace their entire field:
omission preserves durable information, `[]` clears it. Full refreshes also
preserve omitted durable continuity fields on identity matches. Reactions,
intentions and thought evidence are turn-local; resolved threads have one
snapshot of visibility. Existing snapshot ownership handles swipes and edits.

## In-flight generation contract

Inline tracker generation has a two-flag in-flight tuple:

```
generating === true  &&  inlineGenStartMs > 0
```

Both flags must be cleared together. Half-cleared state was the cause
of the v6.23.x Together-mode skip regression chain (commits a8e6f65,
95b97ee). v6.27.13 widened the interceptor's stuck-detection guard to
treat any `generating === true` without a fresh start time as stale,
and v6.27.14 added a 180s watchdog that force-resets the tuple when
ST never fires a termination event (e.g. ECONNRESET on a slow upstream).

Termination paths that clear the tuple:
- `GENERATION_ENDED` event (success or extraction-failure deferral)
- `GENERATION_STOPPED` event (user clicked stop)
- 180s watchdog (catches network drops)
- Next interceptor call's stuck-detection (last-resort)

## Together PromptInjectionPlan

Together delivery is run-scoped (`activePromptInjectionRun`) with a
per-request phase (`currentRequest.seq` / `phase`):

1. `buildInlineTrackerPrompt()` produces the instruction text.
2. `prompt-injection.js` wraps it with integrity markers, registers
   `setExtensionPrompt` (main=`IN_PROMPT`, tail=`IN_CHAT` depth 0,
   `scan=false`), and freezes schema/delta/snapshot for extraction.
3. Intermediate hooks materialize only if the payload block matches
   `sourceText` under an allowlisted ST transform (`identity`,
   `collapse_newlines`, re-macro).
4. Authoritative hooks (`GENERATE_AFTER_DATA` for Text,
   `CHAT_COMPLETION_SETTINGS_READY` for Chat, via `makeLast`) verify
   the materialized block, commit the verified context footprint, then
   allow the request. Integrity failure calls `stopGeneration()` —
   never `throw` from the listener, and never auto-Separate.
5. Extension prompt keys are cleared owner-aware (by `runId`); foreign
   quiet `GENERATION_ENDED` must not wipe an active Together run.
   Nested quiet uses a suspend counter; tool recursion reuses the run
   with a new `seq`.

ScenePulse measures and shows footprint; it does not budget-limit,
compact, or strip user panels.

## Dialog system

12 overlay-style dialog modules currently live in `src/ui/`. Each
implements its own ESC keydown listener, click-outside handler,
mousedown/pointerdown stopPropagation isolation, and exit-anim
teardown. The duplication caused the v6.23.x backdrop/popover
regression chain (four successive fixes for the same bug shape).

`src/ui/dialog-base.js` ships `mountOverlay({ root, onClose,
closeOnEsc, closeOnEnter, closeOnBackdrop, closingClass })` as the
canonical lifecycle helper. As of v6.27.12, only `or-connector-prompt`
and `preset-suggestion-prompt` use it. Migration of the other ten
modules is incremental — touch the file → migrate it. See that
file's header for the migration criteria.

## CSS file ownership

`style.css` is the entry point and `@import`s every CSS file. Files
are mostly named for their feature, with one carryover misnomer:

- `css/crash-log.css` (1461 lines after v6.27.10 audit) holds the
  ENTIRE debug-overlay system: `.sp-cl-*` (crash log), `.sp-di-*`
  (debug inspector + doctor + perf-tab), and a few stragglers. A
  full split was attempted and deferred because rules are interleaved
  with shared `@media` blocks; cascade-safe extraction would require
  duplicating media wrappers per file. Add new debug/perf rules here,
  not in `css/debug.css`.
- `css/dialogs.css` and `css/preset-browser.css` were split out in
  v6.27.9 to fix prefix↔filename mismatches in `custom-panels.css`
  and `prompt-editor.css`.
- `css/perf-overlay.css` (v6.27.10) holds the standalone perf-capture
  floating pill (distinct from the Inspector's perf TAB).

## State mutation and clone rules

- `src/state.js` uses `export let` + setter functions, not
  `Object.defineProperty`, because ESM forbids dynamic getter exports
  on the module namespace. The header in that file is the canonical
  explanation.
- Use `structuredClone()` for deep copies. v6.27.7 swept `JSON.parse(JSON
  .stringify(...))` out of every site — it's slower, semantically
  weaker (no Date/Map handling), and shouldn't reappear.

## Versioning protocol

Every commit bumps version in BOTH `manifest.json` AND
`src/constants.js`. The duplication is intentional — bump-both is the
release-checklist forcing function. Don't refactor it into a single
runtime read.

i18n covers all 29 languages in `locales/*.json`. Adding a translatable
string means updating every locale file, not a subset.

## Where to read first

If you're new to the codebase and want to make a change, read in this order:

1. This file (you are here)
2. [CLAUDE.md](CLAUDE.md) — coding style, commit hygiene, refactor philosophy
3. [src/state.js](src/state.js) — the mutable state surface
4. [src/settings.js](src/settings.js) — profile + persistence machinery
5. [src/generation/interceptor.js](src/generation/interceptor.js) — the
   hot path everything else feeds into
