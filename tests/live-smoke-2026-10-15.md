# Live smoke — 2026-10-15

Partial acceptance run, with real provider requests. This is not a completed
compatibility matrix or certification of model presets.

## Environment and isolation

- Chromium, SillyTavern 1.19.0 release `06bde939f` on port 8000;
  SillyTavern 1.18.0 on port 8018.
- ScenePulseN 7.1.16, uncommitted workspace based on
  `41ad3ae10a2f5e0fac533421c947f0d5b8e27f94`.
- Model `soji`, custom chat-completion source. Saved connection profile named
  `soji` on 8000 and `suji` on 8018; user confirmed either spelling is intended.
- Each host used its own isolated browser context. Extension files were served
  from this checkout through browser routing, not installed into either server.
- Settings saves and diagnostic-log uploads were intercepted. Generation and
  disposable character/chat/avatar operations reached the actual servers.
  Provider responses were not replaced. No credentials were recorded here.
- Temporary characters, their chats and temporary persona avatars were deleted
  successfully (HTTP 200). Test contexts were closed and the helper stopped.

## Observations

| Check | 1.18 | 1.19 |
| --- | --- | --- |
| Startup | No page exceptions; legacy display path | No page exceptions; MessageFormatter path |
| Separate JSON | Saved snapshot through connection-profile transport | Saved snapshot through Same as current / raw-data transport |
| Separate Native | Saved snapshot; schema present in outbound request | Saved snapshot through raw-data transport |
| Parallel full | Three lanes completed, no failed lanes, one assembled snapshot | Not run with a working saved profile |
| Together streaming | Narrative returned without tracker; fallback Separate saved snapshot | Same behavior with adequate test output/context budgets |
| Explicit marker display fixture through host messageFormatting | Payload hidden; narrative before/after retained | Payload hidden; narrative before/after retained |
| Ordinary JSON display fixture | Preserved | Preserved |
| Native Action Loader | Visible, nonblocking, detailed message status retained | Same |
| Stop after request dispatch | Cancelled; previous snapshot unchanged; loader removed | Same |
| Saved-chat reload before Clean | Snapshot preserved | Snapshot preserved |
| Persona restore / decline | Real setUserAvatar restores old selection; decline remembers new persona | Same |
| Native Clean button and confirmation | Hook removes settings/cache, retains library sentinel and in-memory snapshots | Same |
| Mobile panel at 390 × 844 | Panel fits viewport after transition; content scrolls | Same |

The first Together probe inherited a 300-token output budget. A second probe
used 8192 output / 65536 context in the isolated session. Its outgoing messages
contained the tracker instructions, but the model still returned narrative only.
Successful saved snapshots came from `auto:together:fallback`, not inline tracker
extraction. Together success in a single model response remains unverified.

Cancellation was tested after observing the actual generation HTTP request, not
only before dispatch. Subsequent observations showed no late snapshot replacement.
An earlier attempted cancellation arrived after completion and is not counted
as cancellation evidence.

Clean evidence covers the native UI, hook dispatch and state immediately after
the hook. The server diagnostic upload was substituted; settings were not written
to the user's server. After page reload the test character was not reopened, so
post-Clean chat persistence is not claimed by this run. Library storage survived
the reload. Normal saved-chat reload was verified separately before Clean.

## Confirmed defect (fixed in the follow-up below)

**Voluntary cancellation shows a failure toast on both hosts.** Start Separate,
wait for `/api/backends/chat-completions/generate`, then click the Action Loader
stop icon. The message status becomes `Scene creation cancelled`, but a red
`Generation failed / All retry attempts failed` toast appears as well. Reproduced
after removing existing toasts, on both transport paths. Data remains unchanged.

`src/generation/engine.js:470` emits the exhausted-attempts toast when cancellation
exits the attempt loop. The cancellation path should return without presenting
retry exhaustion as a provider failure. No implementation changes were made in
this testing run; fix and regression verification remain open.

## Connection and output limitations

- The saved 1.19 profile initially had no model field. Adding `soji` in test
  memory did not resolve the failure: provider response was HTTP 200 containing
  `error.message = Forbidden`. Same as current succeeded on the same host/model.
  This narrows the issue to differing saved-profile request parameters; the
  exact key/URL/permission difference was not established. Profile naming is not
  the cause. Saved-profile real-provider coverage on 1.19 remains blocked.
- One later 1.18 JSON response was rejected as `TRUNCATED` (7083-character
  candidate, missing closing brace). The previous valid snapshot stayed intact;
  the panel offered Retry/Edit JSON/Dismiss. Retries were disabled for these
  probes, so automatic recovery from this output was not verified.
- Successful responses can include validation warnings. Success here means an
  accepted and saved snapshot, not proof of every field's narrative accuracy.

## Remaining coverage

- Fix and recheck the cancellation toast; resolve the 1.19 saved profile.
- Together with an actual inline tracker, streaming off, mid-stream stop.
- Real parallel delta, profile A/B switching, explicit sampler/preset override.
- Real delayed responses during chat/branch changes; broader lifecycle matrix
  retains the earlier phase-3 event-fixture evidence, not fresh provider coverage.
- Third-party regex interaction, group chats, Firefox, live lorebook rename,
  and complete diagnostics/desktop UI acceptance.
- Persistent Clean lifecycle including real diagnostic-file cleanup, in a fully
  disposable ST user environment.

No version bump, commit, release, or new full Node run was performed. Source code
was unchanged; this run adds live evidence to the preceding local regression run.

## Follow-up: cancellation fix and additional live checks

The user subsequently authorized the cancellation fix and continued testing.
The Action Loader aborts with a string reason `user`; that reason was classified
as a retryable provider error. The engine now checks the operation's signal before
reporting errors/retrying and exits cancellation without entering failure UI.
Internal watchdog timeouts still take the failure path.

- Added an engine regression for both current and saved-profile transports:
  external abort with `user`, no error toast or new extraction failure, unchanged
  snapshots, subsequent genuine provider error still reported, subsequent success.
  The new test failed before the fix and passed afterward.
- Full local run after the fix: **132/132 source files**, **109/109 test files**.
  Independent fresh-context review found no actionable issues in this fix.
- Live Stop after actual request dispatch: **passed on both versions**, no error
  toast, status cancelled, snapshots unchanged. A subsequent real request succeeded
  on both versions (raw-data on 1.19, connection-profile on 1.18).
- Together without streaming: **1.18 saved `auto:together` from the main response**,
  with no extra fallback request. **1.19 saved `auto:together:fallback`**. A single
  successful 1.18 response does not establish consistent model compliance.
- 1.18 small-cast Delta with parallel enabled: accepted delta, selected the expected
  ordinary connection-profile route. Large-cast partitioned Delta remains pending.
- Switch to a different disposable character after actual provider dispatch:
  cancelled on both versions, no error toast, no snapshot entered the destination
  chat; subsequent observations still showed no snapshot and no active loader.
- Host messageFormatting plus an additional markdown regex: tracker hidden,
  prefix retained, suffix transformed on both versions. An unfinished tracker
  payload was hidden with its preceding narrative intact. These are explicit
  formatting fixtures, not model-generated streaming-marker evidence.
- Read-only profile comparison on 1.19 confirmed its saved URL differs from the
  current URL and its model field is absent. On 1.18 both match. No saved profile
  was changed; the exact server-side reason for Forbidden remains unverified.
- No page exceptions in these test sessions. Four new disposable characters and
  their chats were deleted successfully (HTTP 200); contexts were closed and the
  helper stopped. The same settings/log
  isolation limitations as the first run apply.

Remaining acceptance gaps: 1.19 saved-profile provider requests, Together inline
on 1.19 and streaming inline on both, mid-stream cancellation, partitioned Delta,
profile/preset sampler switching, Firefox/group/lorebook and persistent Clean
checks. The cancellation defect itself is closed. No version bump or commits.

## Further acceptance run: large scenes, profiles, rename and streaming

Same two hosts and browser isolation; real `soji` requests. No source changes.
Temporary connection profiles and sampler presets existed only in browser memory.
The 1.19 test profile used the working current URL/model and default active secret,
not the user's failing saved profile. This verifies the profile API independently
of that saved profile's configuration.

### Passed / observed

- Seven-character scene, ordinary JSON: both full builds rejected unclosed JSON
  (`TRUNCATED`, candidate lengths 6340 and 5829). No valid snapshot was claimed.
- Parallel full JSON: 1.19 had a character schema failure and truncated global
  lane; 1.18 had a character timeout and truncated global lane. Other lanes
  completed. Retries were disabled; the unsuccessful assemblies were rejected.
- Native parallel full then succeeded on both hosts: 8 lanes on 1.19, 9 on 1.18,
  no failed lanes. A manually prepared baseline had been supplied for this retry,
  but the failure-refresh flag correctly forced a full rebuild rather than Delta.
  The model omitted Mira from the 1.19 core roster; accepted structure does not
  imply narrative accuracy.
- A following **actual parallel Delta**, based on those successful model-produced
  full snapshots, succeeded on both hosts: `deltaMode=true`, `parallel-delta`,
  8/9 lanes and no failed lanes. Narrative turns were authored test fixtures.
- Real profile transport A → B → A on both hosts sent `soji` with temperatures
  0.2 → 0.7 → 0.2. Global source/model/preset/profile selection stayed unchanged.
  Both profiles used the same working endpoint; distinct providers were not tested.
- Explicit sampler override through `withProfileAndPreset` + `requestTracker`
  sent `soji`, temperature 0.7, then restored source/model/preset/temperature.
  Abort after request dispatch also restored preset/temperature on both hosts.
  These were short transport probes, not full tracker generations.
- An initial override probe cloned the built-in Default preset and consequently
  selected its different API/model; HTTP 400 was returned, and the preset/temperature
  restored. The successful retest used presets derived from the active `soji`
  connection. The initial probe is not counted as a successful model request.
- Created a temporary lorebook on each server and renamed it via ST's actual
  editor. Actual World Info scans before/after rename yielded old/new world names;
  the serialized earlier trace remained identical. The test explicitly subscribed
  trace adapters around the scan; it does not certify the normal Together event
  gate or historical trace drawer. Direct scans outside Together initially produced
  no trace because the production gate correctly requires an inline generation.
- No browser page exceptions in either session.

### New confirmed defect: Together Stop permits automatic recovery

On both versions, enable Together + streaming + automatic fallback, start a main
reply, and click ScenePulse's native Action Loader stop icon while the **new**
assistant message is still streaming. The targeted message had 171 visible
characters on 1.19 and 244 on 1.18; `generate()` was still unresolved. The main
reply continued and **one further nonstreaming tracker request** was dispatched
after Stop on each host. A preliminary cancellation probe showed the same behavior.

The extra requests returned truncated JSON, so no new snapshot was saved in these
probes. Late snapshot persistence after a valid fallback response is a risk, not an
observed result. The proven defect is an unwanted new provider request after the
user cancelled scene creation. This is separate from the fixed Separate error toast.

Code evidence: Action Loader calls `cancelSceneBuild`, which settles/aborts the
operation (`scene-build-controller.js`). `message.js` starts a fresh
`auto:together:fallback` operation after extraction failure; its recovery gate uses
`shouldSkipAutoSceneRecovery()` (`state.js`), which checks the global cancel flag
rather than the cancelled Together operation. The recovery chain must respect the
cancelled owner before starting another operation. Fix and regression/live recheck
are required before release; no fix was made during this testing-only run.

### Still open

- Fix Together cancellation and repeat streaming acceptance with a valid inline
  tracker; provider output quality remains variable.
- Firefox, group chat, branch/checkpoint during a real request, persistent Clean
  including actual diagnostic-file cleanup, and complete desktop diagnostics UI.
- Production Together trace gate/drawer across lorebook rename; the real-scanner
  adapter/history boundary was exercised above.
- The user's original 1.19 saved profile still needs configuration correction.

Full tests were not rerun because source code did not change. Version remains
7.1.16; no commits or release. Both temporary characters and their chats, plus
both renamed temporary lorebooks, were deleted successfully (HTTP 200). Test
contexts were closed and the helper stopped; in-memory profiles/presets were
discarded with the contexts.

## Together cancellation fix and follow-up acceptance

The defect above is now fixed. Inline recovery checks the original scene-build
operation as well as the global stop guard. Continuation receives that operation's
AbortSignal; cancellation does not become a provider error or escalate to Tier 2.
The regression failed before the fix and passes afterward, including dismissal
of cancelled status and a fresh active turn. Full Node validation: 132/132 source
files, 110/110 test files. Independent review found no actionable issues.

- On both main hosts, clicked the actual Action Loader Stop while a new Together
  reply was streaming (177 visible characters on 1.19; 251 on 1.18; main generation
  unresolved). Main narration completed; **zero additional generation requests**,
  unchanged snapshots, zero remaining loaders, no error toast/page exception.
  This verifies recovery suppression, not physical provider-side request abortion.
- Branched the temporary character chat after dispatch of a real Separate request:
  chat ID changed, old assembly returned null, loaders disappeared on both hosts.
  Snapshot data stayed unchanged. Only 1.19 had a successfully generated seed;
  1.18's seed failed, so preservation of a populated seed is not claimed there.
- Manual Native assembly in a temporary one-member group succeeded on both hosts.
  This does not cover automatic generation with multiple speakers.
- Created a group checkpoint, dispatched another real Separate request, then
  opened the checkpoint using `openGroupChat(groupId, chatId)`: chat ID changed,
  old assembly returned null and loaders disappeared on both hosts. An initial
  probe used the wrong API arity and did not navigate; it is excluded from this result.
- Started a separate ST 1.19 process on 8029 with isolated data/config. Used native
  extension Clean with real settings and diagnostic-file writes, then reopened the
  chat. Settings sentinel/cache removed, diagnostic entries empty on disk, library
  preserved and snapshot JSON identical. An early snapshot check preceded chat
  loading; the settled UI and saved chat file both confirmed preservation.
- Temporary Playwright Firefox installed, but crashed at `newPage()` before ST
  navigation. Firefox acceptance remains open; no extension failure is inferred.

Remaining: Firefox, multi-speaker automatic group flow, complete persistent Clean
on 1.18, production Together trace gate/history drawer after lorebook rename,
complete desktop diagnostics UI, and valid inline tracker output acceptance.
The user's original 1.19 saved profile still needs configuration correction;
tests used the working current connection there and the saved `suji` profile on 1.18.
Version remains 7.1.16; no commits or release.
Temporary groups and characters/chats were deleted (all HTTP 200); contexts were
closed and both temporary server/helper processes stopped.
