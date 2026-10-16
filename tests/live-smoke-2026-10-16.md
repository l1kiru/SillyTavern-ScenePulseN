# Live acceptance — 2026-10-16

ST 1.19 on port 8000 and ST 1.18 on 8018; current custom connection, model
`soji`, on both hosts. Chromium, isolated contexts, workspace extension served
through a temporary helper. Settings saves and crash-log uploads were intercepted;
character/group/chat/lorebook operations and model requests used the real servers.
Version remains 7.1.16. No implementation changes, commits or release.

## Confirmed group defect — release blocker

Created two temporary characters per host and a LIST-order group. Enabled Separate,
automatic generation, Native, no Delta/parallel, zero retries. Ran two user turns
on each host. Both characters answered each turn: four real generation requests
per host, but **zero tracker requests and zero snapshots**. All four delayed
auto-build handlers per host logged `scheduled owner changed, aborting: CHAT_CHANGED`.

Cause: `currentChatKey()` in `src/message-fingerprint.js` includes `characterId`
(or `name2`) even when `groupId` exists. Group generation changes/clears the active
speaker, so an unchanged group chat acquires a different key. The four-second
Separate delay then rejects the owner before requesting a tracker.

A minimal Node probe with unchanged group/chat/message and only characterId 3 → 4
changed the key from `10:group-test|1:3|9:same-chat` to
`10:group-test|1:4|9:same-chat`; `validateOperationOwner` returned `CHAT_CHANGED`.
Fix should stabilize group identity while preserving solo-character isolation;
then repeat group automatic generation and cancellation/branch ownership tests.
No fix made in this testing-only run.

## Together and Source Trace

- ST 1.19: valid real inline snapshots saved with `source=auto:together`. Trace
  used production event wiring, with no manual trace subscriptions. A constant
  entry in a temporary chat lorebook appeared as accepted, with chat attachment.
- Renamed that lorebook in ST's real editor. ST retargeted the chat attachment.
  A later successful Together snapshot contained the new name; the original
  serialized trace remained byte-identical. Opened the current drawer, then
  rendered the historical snapshot through the normal `updatePanel` renderer and
  opened its drawer: each showed its corresponding name. This checks rendering,
  not the historical navigation UI itself.
- One immediate post-rename generation overlapped editor settlement and was
  discarded for target mismatch; excluded from acceptance. The subsequent run
  after settlement succeeded.
- ST 1.18: three main Together probes did not produce a valid saved snapshot.
  First failed required `elapsed` validation; later responses/recovery were
  truncated or invalid. Explicit reminders/shorter descriptions did not resolve
  this in the bounded run. No claim that the 1.18 production trace scenario passed.
- Minor UI defect: drawer displays `Scan loop {1} · {}`. The template in
  `scene-source-trace-ui.js` uses double-brace placeholders but this translation
  path leaves braces in the rendered result. Record for correction/retest.

## Desktop diagnostics

- All seven inspector tabs rendered on both versions, with nonempty content, no
  horizontal panel overflow and no browser page exceptions in the acceptance run.
- API availability appeared in Overview. Diagnostics button copied a nonempty
  report including capability information on both versions (14099/21122 chars).
  Export-to-file and exhaustive redaction coverage were not tested.
- Actual Doctor button completed five checks and displayed five PASS results on
  each host. Storage write/read, model echo and tokenizer endpoint were exercised;
  token estimate 35 vs endpoint 33, 5.7% drift.
- **Doctor schema claim exceeds its check:** `_checkSchemaRoundtrip` only calls
  `cleanJson` and checks nonempty object keys; it never validates against the active
  schema. Therefore its PASS is evidence of parseable JSON, not schema conformity.
- **Doctor probe cleanup fails:** both servers retained
  `/user/files/scenepulse-doctor-probe.json` after PASS. `_checkStorage` posts
  `{name: FILE_NAME}` to `/api/files/delete`, whose API expects `path`, and ignores
  unsuccessful HTTP status. Correct the request and test failure reporting/cleanup.

## Remaining

Fix/retest group ownership; correct Doctor validation/cleanup and trace label.
Firefox remains unverified after the previous browser startup failure. Full
persistent Clean on 1.18 still needs an isolated server/data root. Production
Together trace/history on 1.18 requires a valid inline response. Original saved
1.19 profile configuration was not changed or revalidated.

No full Node suite rerun: implementation unchanged; the last full run remains
132 source files / 110 test files. This run adds the minimal ownership probe and
live evidence above, not a replacement for regression tests after fixes.

Cleanup: both groups and all four temporary characters/chats deleted (HTTP 200),
temporary lorebooks absent from world lists, Doctor probe deleted with the correct
path (HTTP 200; subsequent reads 404). Test contexts closed and helper stopped.

## Fix verification follow-up

Implemented stable group identity, sequential Separate group handlers with
captured-owner checks, real Doctor schema validation, independent probe files with
checked deletion and read-error/cancellation cleanup, and single-brace trace
localization placeholders. UUID generation degrades on HTTP LAN contexts without
`crypto.randomUUID`. Version unchanged; no commits.

Regression tests failed before their fixes and pass afterward. Full suite:
132/132 source files, 113/113 test files. Additional targeted tests cover abort
after storage upload and changing chats with queued group work. Independent
review's UUID finding was fixed and rechecked; no remaining actionable findings.

Live results on both hosts with model `soji` through the current connection:

- The initial stable-key fix saved the first group tracker but exposed a second
  issue: the next speaker's auto-build was skipped while busy. After serialization,
  two real group replies at message IDs 9/10 each received an `auto:separate`
  snapshot on both versions. No provider response substitutions.
- An intermediate reload probe lost temporary settings to startup/chat reload
  and ran Together; excluded. The successful Separate retest synchronized runtime
  settings through `saveSettings` while its network save remained intercepted.
- Doctor native UI: storage PASS and both probe URLs subsequently returned 404.
  At the test narrative limit of 400 tokens, schema correctly failed on incomplete
  JSON. With 8192 tokens, the real schema retry passed on both hosts using
  `validateExtraction`, not just parsing.
- ST 1.19 group checkpoint switch during a dispatched tracker request returned
  null for the old build and removed its loader; group-key stabilization did not
  erase branch isolation.
- Corrected `Scan loop 1` label verified through the real DOM renderer with a
  trace fixture on both hosts. No leftover interpolation braces.
- ST 1.18 produced a real `auto:together` snapshot and production trace with a
  compact custom schema (location/elapsed/time/date/character names). This closes
  the basic production-event gate gap, but does not certify default large-schema
  compliance. Renaming through the actual editor preserved the original trace;
  the 1.18 chat attachment was explicitly updated to the new name because this ST
  version did not retarget it. One immediate rename probe hit a target mismatch;
  another model reply omitted the tracker and was not counted as success.
- A following 1.18 request explicitly required tracker markers and all five fields:
  real snapshot 7 saved with the renamed world. Snapshot 2's serialized trace
  stayed identical; current and historical drawers displayed new/old names.
  Expanding the real entry confirmed `Scan loop 1` without leftover braces.

Firefox and full persistent Clean on an isolated ST 1.18 remain unverified.

## Final follow-up: Firefox and isolated ST 1.18 Clean

Both remaining checks below passed. No implementation changes or model requests
were needed; version stays 7.1.16, with no commits or release.

### Firefox

Firefox 157.0 (Playwright build 1555), headless, fresh context per main host.
The restricted Windows process could not spawn Firefox's tab subprocess even
for a data-URL page (`SpawnTarget`, target crashed). The same binary and test
succeeded through the approved elevated execution path; no Firefox sandbox
preferences were disabled. This explains the earlier startup-only failure.

On ST 1.19 / port 8000 and ST 1.18 / port 8018:

- Incomplete and complete explicit tracker blocks were hidden, surrounding
  narrative preserved, and raw message text unchanged. The incomplete block
  was a render fixture, not a live streaming provider response.
- Edited ordinary JSON remained visible; `/addswipe switch=true` selected the
  new text at swipe 1.
- Repeated display initialization left zero legacy hider rules on 1.19 and
  exactly one on 1.18. MessageFormatter was active only on 1.19.
- Zero browser page exceptions and zero monitored Chat Completion generation
  requests (`/api/backends/chat-completions/generate`).
- Temporary Firefox characters/chats were deleted by the test cleanup.

This is targeted Firefox display/edit/swipe acceptance, not an exhaustive
Firefox pass over every extension feature or another real-provider matrix.

### Full persistent Clean — isolated ST 1.18

Exported local upstream tag `1.18.0`, commit
`51ad27fb86d39a3daca3adaa970375c9670c12df`, into a temporary workspace directory.
Installed its own dependencies and copied the current extension runtime there.
Ran on 127.0.0.1:8029 with a dedicated config/data root. Package version and
startup confirmed 1.18.0; startup's Git branch string came from the enclosing
extension checkout, so it was not used as version evidence. No existing ST
installation, settings, credentials or data root was reused.

No browser routes mocked settings, file uploads, discovery or extension files.
Prepared a settings sentinel, a cache entry, an unrelated localStorage entry,
a valid panel library with a panel, snapshots in two separate character chats,
and a diagnostic sentinel flushed to the actual server log. Confirmed settings,
both chat files and the nonempty log existed on disk before cleanup.

Clicked ST's native extension Clean action and its confirmation. After the
automatic page reload, then again after stopping/restarting the server and
reloading the browser:

- settings sentinel absent and cache removed;
- diagnostic file persisted with zero entries;
- unrelated browser storage preserved;
- library JSON identical and loadable through `loadPanelLibrary`;
- both chats reopened with snapshot JSON exactly matching their pre-clean values.

Disk inspection independently confirmed the absent settings sentinel, empty
diagnostic log and two saved snapshot files. All post-restart checks were true.
This closes the persistent Clean 1.18 gap; failure paths remain covered by the
existing Node cleanup tests rather than induced server faults in this live run.

No full Node rerun: product code unchanged; last full result remains 132 source
files / 113 test files.

Independent report review found no blocking inconsistencies; request-count
wording is limited to the monitored endpoint. Temporary server/browser contexts
were stopped; isolated installation, data and downloaded test runtime removed.

## Consolidation and focused follow-up — 16 October

Updated the plan, current matrix and Unreleased validation wording against both
dated reports. In particular, tool-call-associated deletion was already covered
through core ST deletion with a synthetic tool message; it was not a new gap.
The user confirmed that no second working provider is available. Real cross-provider
A → B → A remains unverified; same-endpoint and substituted-source coverage stand.

### History UI and reload

Fresh Chromium context per host; routed current checkout, intercepted settings
saves/diagnostic uploads, disposable `SP History QA` characters. Three prepared
snapshots had distinct locations/thoughts for the same character. No model output
was used to prepare this history fixture.

- Clicking the first timeline node changed the main panel to snapshot 0 on both
  versions, and Jump to latest restored snapshot 2. Wiki displayed the character.
- **Open discrepancy:** floating thoughts stayed at snapshot 2 when viewing
  snapshot 0. The selected state was 0 and all fingerprints were current, ruling
  out stale-snapshot rejection. `src/ui/update-panel.js` explicitly skips
  `updateThoughts` during `_isTimelineScrub`; the same guard exists in baseline
  HEAD. No fix was made in this testing pass.
- `/addswipe switch=true` selected a new swipe without borrowing snapshot 2.
  After saving a distinct snapshot for that swipe, reloading the page and reopening
  the disposable character restored its location, thoughts, three timeline nodes
  and wiki entry on both versions.
- Settings saves were intercepted, so reload initially restored the user's prior
  character selection. An early 1.18 reopen also raced startup selection; the
  settled explicit reopen passed. Those waits were harness issues, not failures
  of snapshot persistence.
- Zero monitored Chat Completion generation requests during this history phase;
  zero browser page exceptions. Historical thought synchronization is not passed.

### Real streaming Together

On both hosts, current custom connection/model `soji`, streaming enabled, 4096
output limit, fallback disabled, retries zero. Used a compact custom schema
(location, elapsed, time, date, character names) and an explicit test instruction
to append the tracker. These settings existed only in the isolated browser session.

- Exactly one `/api/backends/chat-completions/generate` request per host, with
  `stream: true`, model `soji`; no substituted responses or additional fallback.
- New assistant message 4 saved a current-fingerprint snapshot with source
  `auto:together` on both versions. Final narrative had no tracker markers.
- At 100 ms sampling, 1.18 recorded five samples containing a raw marker and no
  visible marker/characters-payload leaks. On 1.19 no sample caught a raw marker;
  successful streaming extraction is established, but a live partial-marker
  visibility claim is not made for that run. Earlier formatter fixtures remain
  the evidence for that boundary.
- This establishes successful inline streaming extraction with a compact schema,
  not model compliance for every schema or exact narrative-state semantics.

Fresh `node tests/run-all.mjs` exited 0: 113/113 test files. `git diff --check`
reported no whitespace errors (only existing line-ending normalization warnings).
No product code, version, commits or release changed in this pass.

Independent documentation review identified the then-stale inline-streaming gate;
it is now updated with the bounded result above. Both disposable characters/chats
were deleted successfully (HTTP 200); browser contexts closed and the temporary
checkout HTTP helper stopped. Fresh syntax checks: 132/132 source files.

## Historical thoughts fix and acceptance

Removed the timeline-only guard around `updateThoughts(d)` in `updatePanel`.
Other scrub guards and debounce behavior are unchanged. The regression in
`panel-update-boundary.test.mjs` failed before the fix on the historical thought
card assertion and passed afterward; it also covers latest and empty scenes.

Fresh Chromium sessions on both ST 1.19 (8000) and ST 1.18 (8018), disposable
`SP Thoughts QA` characters, routed current checkout and intercepted settings/log
writes. Three prepared snapshots: historical thoughts, no present characters,
and current thoughts. Auto-generation enabled; no model responses needed.

- Clicking historical node 0 showed its thoughts and location together.
- Node 1 cleared the thought body and hid the empty thought panel.
- Jump to latest restored node 2's thoughts and location.
- Rapid clicks 0 → 1 → 0 settled on node 0's thoughts.
- Both hosts recorded zero browser exceptions and zero monitored Chat Completion
  generation requests throughout navigation.

This closes the historical-thought discrepancy above. Version remains 7.1.16;
no commits or release.

Fresh full regression run passed: 132/132 source syntax checks and 113/113 test
files. `git diff --check` passed. Both disposable characters/chats were deleted
(HTTP 200); browser contexts and the temporary checkout server were closed.

## Setup language page

User requested a dedicated first page for language selection. Setup now has six
pages; the existing five retain their order. Language options and application
reuse the settings path. Changing language saves immediately, translates the
wizard, retains its draft choices and does not mark setup complete.

Chromium on both 8000 / ST 1.19 and 8018 / ST 1.18, isolated browser contexts,
checkout routing, intercepted settings/diagnostic writes, no model requests:

- Before implementation, no `#sp-setup-language` existed on either host.
- Russian selection translated the guide immediately; settings and setup selectors
  agreed and had identical options. English and auto-detect also worked.
- Final six-page layout: translated page 2 opened through Next; Back returned to
  page 1 with the selected language. Recovery profile and disabled-recovery draft
  survived changing language; Finish saved the choices and dismissed the wizard.
- Settings-save payload contained the selected language. Reopening retained it.
  Persistent server writes were deliberately intercepted; this is not a fresh
  server-restart persistence test.
- Delaying the Greek locale response, closing setup, then releasing the response
  did not reopen the guide; settings still applied the language.
- At 390×844, the first page initially exposed an existing viewport-height issue:
  the fixed overlay collapsed and clipped its header/control. Explicit viewport
  height fixed it. Final selector fit horizontally and vertically on both hosts,
  and Next/Back/Finish/Close remained clickable.
- No browser page exceptions. No version change, commits or release.

Final regression run: 133/133 source syntax checks and 113/113 test files passed;
`git diff --check` passed. Independent scoped review found no new actionable
defects. The existing i18n response-order race across overlapping language loads
after closing/reopening remains outside this change; the in-place selector is
disabled during its own load. Browser contexts and helper server were closed;
no temporary characters/chats were needed.
