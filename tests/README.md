# Tests

Dependency-free Node regression scripts. The SillyTavern extension loader does not load anything in this directory.

Run every top-level and nested test with:

```bash
node tests/run-all.mjs
```

Each test remains a standalone Node ES module and can also be run directly.

Add new manual tests as `tests/<area>/<name>.test.mjs`. Keep them dependency-free so `node tests/<...>.test.mjs` always works without `npm install`.

## SillyTavern compatibility

The matrix below consolidates the [2026-10-15 live smoke report](live-smoke-2026-10-15.md)
and [2026-10-16 follow-up](live-smoke-2026-10-16.md). Historical pending statements
in those journals describe their stage of the run, not the current status.

The [2026-10-16 follow-up](live-smoke-2026-10-16.md) records group ownership,
Doctor and Source Trace findings and their fix verification.
`group-operation-owner.test.mjs` checks stable group identity and solo isolation;
`group-auto-build.test.mjs` checks slow-request sequencing and stale queued work.
`doctor-checks.test.mjs` rejects parseable invalid trackers and checks storage
cleanup, cancellation, failure reporting and HTTP-context UUID fallback.

`scene-build-ui.test.mjs` covers the native Action Loader options and handle
lifecycle, repeat reconciliation, stop callback, swipe ownership, disposal and
missing-API degradation while retaining the existing message status checks.

`token-count.test.mjs` covers UTF-8 estimates (Latin, Cyrillic, CJK, emoji) and
tokenizer failure/invalid-result fallback. `persona-guard.test.mjs` covers restore,
decline, duplicate events, stale confirmations, legacy name ambiguity and deleted
personas. `extension-cleanup.test.mjs` checks the exact cleanup boundary and
preservation of unrelated storage, panel library and chat snapshots.
`crash-log-cleanup.test.mjs` verifies an in-flight old upload finishes before
the empty cleanup upload, capture stays quiescent, and server failures surface.
Persona restore/decline was checked in Chromium on both ST versions.
Persistent Clean was checked on an isolated ST 1.18 through a server restart;
see the follow-up report for the exact preservation boundary. These Node tests
do not call a real LLM.

The minimum client remains **1.18.0**. Select optional integrations by API
availability, never by parsing a version label. `st-capabilities.test.mjs`
checks detection, incomplete API objects, raw-request priority and agreement
with the real `requestTracker` dispatcher. Its inputs are synthetic API-shaped
objects, not captures of either SillyTavern release.

Debug Inspector → Overview reports the current host version (or Unknown),
display implementation, ordinary request API, Connection Manager availability,
and missing events. Diagnostics includes the same inventory. Optional APIs
being absent is not itself a compatibility failure. API presence cannot prove
provider support for Native JSON, correctness of event ordering, or live UI
behavior. The existing Latest build timing records the observed transport;
the ordinary request API field does not describe Together or parallel requests.
`tracker-display.test.mjs` covers marker pairs/prefixes, immutable source text,
role exclusions, ordinary JSON preservation, one-time registration, removal of
only ScenePulse's legacy regex, registration failure fallback, and suppression
of legacy streaming polling after successful registration. Registration inputs
are API-shaped test objects; they are not an actual SillyTavern browser session.

### Live smoke procedure: 1.18.0 and 1.19.0

Use separate clean ST profiles and copies of a disposable chat. Record exact ST
tag/commit, extension commit, browser, mode, provider/model and result for each
row. Do not export credentials or private chat content. Model-backed rows make
requests using the selected test connection; local Node tests do not.

| Scenario | Expected result | 1.18.0 | 1.19.0 |
| --- | --- | --- | --- |
| Fresh start, open Overview, copy Diagnostics | No init exception; API inventory matches host | Passed, legacy | Passed, MessageFormatter |
| Together, streaming on/off | Accepted tracker; narrative readable | Real nonstream, streaming fallback and inline streaming passed (compact custom schema) | Same |
| Separate, ordinary JSON | Valid snapshot saved | Real soji passed | Real soji passed |
| Separate, Native JSON | Schema and valid snapshot | Real passed | Real passed |
| Separate, parallel full build | Lanes assemble; global connection unchanged | Real Native passed | Real Native passed |
| Parallel Delta: small and large cast | Correct transport; no duplicates | Real large-cast Delta passed; local workload tests | Same |
| Stop before first token and mid-stream | No late save, no cancellation error/fallback | Real dispatched Separate and streaming Together passed | Same |
| Provider failure and recovery | Error reported; next run completes | Real failure/retry observed; local assertions | Same; original saved profile still misconfigured |
| Switch chat during a request | No old result in new chat | Real passed | Real passed |
| Reload saved chat | Snapshot and dependent UI restored | Alternate-swipe snapshot, thoughts, timeline and wiki passed | Same |
| Edit, switch swipe, delete active/inactive swipe | Correct snapshot; no navigation generation | Browser fixture passed | Browser fixture passed |
| `/addswipe`, both activation options | Correct active snapshot and dependent UI | Snapshot passed; new swipe snapshot/UI restored after reload | Same |
| Historical timeline thoughts | Thoughts match selected historical snapshot | Fixed and browser-verified: old/empty/latest/rapid navigation | Same |
| Delete a message with associated tool calls | Correct snapshot after deletion | Core deletion with synthetic tool block passed | Same; core also removed tool block |
| Branch/checkpoint while generating | Late result cannot cross owner | Real cancellation passed; branch seed incomplete | Real cancellation + populated branch passed |
| Connection A → B → A, preset, cancellation | Correct source/model; settings restored | Real same endpoint passed; different sources fixture only | Same |
| Group chat and mobile panel | Both speakers saved; readable UI | Real auto-build + mobile passed | Same |
| Explicit markers, third-party regex, partial stream | Hidden payload, preserved suffix/raw text | Browser fixture passed | Browser fixture passed |
| Stop mid-marker, repeated init, edit/re-render | No hidden/stuck text or duplicate rule | Partial-marker fixture + real streaming Stop passed | Same |
| Ordinary JSON/code and role exclusions | Unrelated content preserved | Browser JSON + local role tests | Same; actual reasoning-provider mode not tested |
| Firefox display/edit/swipe/re-init | Same display contract | Firefox 157 passed, fixtures | Firefox 157 passed, fixtures |
| Persona restore and decline | Previous persona restored only on acceptance | Native UI/API passed | Native UI/API passed |
| Setup language page | Immediate translation, saved language, retained draft, Next/Back/Finish | Chromium desktop/mobile passed; save payload intercepted | Same |
| Source Trace and lorebook rename | Old/new names belong to old/new captures | Real passed with compact schema and explicit reattachment | Real passed |
| Doctor storage/schema | Validated result; probe deleted | Real passed; failure paths local | Same |
| Native Clean persistence | Settings/cache/log removed; library/chats preserved | Isolated install + server restart passed | Isolated install + disk/chat verification passed; no restart certification |

Run the initial mode checks in Chromium; repeat display/streaming/edit/swipe
checks in Firefox. For event investigations, record only event name/order,
message index, swipe index and generation type on a disposable chat. Label
fixtures with the originating ST tag/commit; do not present invented sequences
as real captures. Selected local-host observations are recorded below.

The table records bounded coverage, not blanket certification. “Fixture” means
prepared input or substituted responses, not a successful model generation.
Open gate: different-provider real A → B → A (user confirmed no second working
connection). Historical thoughts now follow the displayed snapshot; the regression
is covered by `panel-update-boundary.test.mjs` and Chromium on both ST versions.
The Node 20/22 CI matrix runs local regressions; it is not an ST-version matrix.

### Phase 3 observations — 2026-10-15

Local hosts advertised 1.19 (8000) and 1.18 (8018). Chromium sessions were isolated
per port because cookies on the same hostname otherwise caused CSRF 403 failures.
The checkout was temporarily served through Playwright routing and initialized in
disposable characters; it was not installed into the servers. An extra `#sheld`
inside the hosts' background tab caused `/del` to select the wrong `#chat`; removing
that duplicate in the test page allowed the actual core deletion path to run.
These harness issues are not counted as extension regressions.

Observed events (indices refer only to disposable chats):

| Action | 1.18 | 1.19 | State observed |
| --- | --- | --- | --- |
| `/addswipe switch=false` | CHAT_CHANGED (same chat) | No swipe/chat event | Active snapshot retained |
| `/addswipe switch=true` | CHAT_CHANGED (same chat) | MESSAGE_SWIPED(2) | Old swipe snapshot not borrowed |
| Existing swipe left | MESSAGE_SWIPED(2) | MESSAGE_SWIPED(2) | Snapshot returns on original swipe |
| Delete inactive swipe | MESSAGE_SWIPE_DELETED(payload) | Same | Other active snapshot not invented |
| Delete active swipe | MESSAGE_SWIPE_DELETED then MESSAGE_SWIPED | Same | Deleted snapshot absent |
| Reload / branch / checkpoint | CHAT_CHANGED | CHAT_CHANGED | Saved snapshot retained; old owner rejected across chats |
| Delete last reply | MESSAGE_DELETED(new length=2) | Same | Snapshot removed |
| Delete reply after synthetic tool message | MESSAGE_DELETED(3); tool message retained | MESSAGE_DELETED(2); tool message removed | Deleted reply snapshot removed |

A pending SceneBuild's AbortSignal was aborted on chat/checkpoint navigation;
owner validation returned CHAT_CHANGED. Core reload/branch navigation did not emit
CHARACTER_MESSAGE_RENDERED in these runs. With autoGenerate enabled, addswipe,
existing-swipe navigation and reload produced zero generation HTTP requests
after the normal four-second auto-generation delay on both hosts. This covers event wiring and ownership,
not an actual delayed provider response. Existing Node provenance, swipe, scrub,
thoughts and wiki tests cover the broader state projections.

Transport probe used each host's real ConnectionManagerRequestService with synthetic
profiles and substituted ChatCompletionService/TextCompletionService responses.
A(openai/fixture-a) → B(openrouter/fixture-b) → A with a shared preset reached the
correct downstream source/model, preserved system/user roles and Native schema,
and left the global selector unchanged. Text completion forwarded its instruct and
preset. Injected provider error and AbortSignal cancellation propagated correctly.
No external provider request was made; sampler application and model compliance
are still unverified. Legacy scoped switching has local async provider restoration
tests for success, provider error and cancellation, not a live configured-provider run.

`single-profile-transport.test.mjs` covers capability/preset gating, payload roles,
schema, cancellation even when the service does not settle, and no provider fallback.
`engine-single-profile.test.mjs` covers ordinary engine routing, timing and
continuation cancellation without stopping the main generation.

`together-cancel-recovery.test.mjs` covers cancelled Together ownership, dismissal
of cancelled status, cancellation during continuation without Tier 2 escalation,
and recovery remaining available for a fresh active turn. The 2026-10-15 live
report records streaming Stop on both hosts with no additional tracker request.

### Source Trace rename regression

`scene-source-trace-rename.test.mjs` exercises loaded entries, activations, scan
keys, optional engine decisions and the historical drawer model. It covers rename
between captures, event-object mutation during/after capture, JSON round-trip,
multiple attachment sources, reused old names with identical UIDs, and absent
optional decisions (the legacy path). Before the fix, a nested decision mutation
created a spurious second accepted entry under the new world name in the old trace.

On 2026-10-15 the `world-info.js` served by both local hosts was inspected read-only:
WORLDINFO_ENTRIES_LOADED contains newly loaded world names; the 1.19 rename helper
also retargets active chat/persona attachments, unlike the 1.18 helper. This is source
inspection plus regression testing, not a live UI rename or real-LLM acceptance run.
No lorebooks, attachments or saved user traces were modified for this check.
