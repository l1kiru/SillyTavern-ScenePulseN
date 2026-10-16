<div align="center">

<img src="docs/assets/scenepulsen-banner.svg" width="100%" alt="ScenePulseN — scene tracking for SillyTavern">

# ScenePulseN

**Your story, its characters, and everything that changes between replies.**

A live scene dashboard for SillyTavern, with character memory, relationship history,
quests, and descriptive continuity.

[![SillyTavern 1.18.0+](https://img.shields.io/badge/SillyTavern-1.18.0%2B-61d6bd?style=flat-square&labelColor=151c26)](manifest.json)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-92a8ba?style=flat-square&labelColor=151c26)](LICENSE)
[![CI](https://github.com/l1kiru/SillyTavern-ScenePulseN/actions/workflows/ci.yml/badge.svg)](https://github.com/l1kiru/SillyTavern-ScenePulseN/actions/workflows/ci.yml)

**English** · [Русский](README.ru.md)

[Install](#installation) · [Quick start](#quick-start) · [User guide](docs/USER_GUIDE.md) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/l1kiru/SillyTavern-ScenePulseN/issues/new/choose)

</div>

---

## Keep the scene in view

ScenePulseN extracts structured scene data from AI replies and displays it alongside
your roleplay. Review what changed, look back at an earlier message, or carry the
established state into the next response.

| Follow | What the dashboard keeps track of |
| :--- | :--- |
| **The scene** | Location, time, weather, mood, tension, and background witnesses. |
| **The cast** | Appearance, thoughts, goals, knowledge, conditions, emotions, and established traits. A searchable character wiki includes absent characters. |
| **Relationships** | Affection, desire, trust, stress, compatibility, milestones, conflicts, and history graphs. |
| **The story** | Main and side quests, promises, appointments, character plans, and unresolved hooks. |
| **Continuity** | Items and ownership, world facts, and the sources behind established knowledge. |
| **Your own systems** | Global or per-character custom panels, audience filters, reusable panel library, and prompt/schema profiles. |

**The tracker describes the story.** Plans do not progress off-screen, hooks do not
trigger events, and relationship scores do not dictate dialogue. Durable records
persist until the narrative changes them; current emotions and reactions need fresh evidence.

<details>
<summary><strong>Explore the dashboard</strong> — existing interface screenshots</summary>

Screenshots show existing UI examples; the current build and your theme may look different.

**Scene overview**

<img src="https://github.com/user-attachments/assets/7740dada-d740-49d8-8ae3-1ae6d72767d5" width="860" alt="Scene dashboard showing environment and scene details">

**Relationships and change over time**

<img src="https://github.com/user-attachments/assets/7094c6bb-28af-46b5-a7da-54a5f117371d" width="860" alt="Relationship cards with meters and history sparklines">

**Custom tracking panels**

<img src="https://github.com/user-attachments/assets/6732fa65-dc8b-4390-8445-bbd08d36f9df" width="860" alt="Custom fields displayed in a tracking panel">

[More features and screenshots →](docs/USER_GUIDE.md#features)

</details>

## Installation

Requires **SillyTavern 1.18.0 or newer** and a configured AI connection.

> [!WARNING]
> Disable or remove the original ScenePulse before installing ScenePulseN.
> They share generation hooks and persistent-state identifiers; running both can
> duplicate requests and overwrite shared state.

1. Open **Extensions → Install Extension** in SillyTavern.
2. Paste this repository URL:

   ```text
   https://github.com/l1kiru/SillyTavern-ScenePulseN
   ```

3. Install, then reload SillyTavern.

<details>
<summary>Manual installation with Git</summary>

For the default SillyTavern user, run from your SillyTavern directory:

```bash
cd data/default-user/extensions/third-party
git clone https://github.com/l1kiru/SillyTavern-ScenePulseN
```

For another user, use that user's extension directory. Restart SillyTavern afterward.

</details>

## Quick start

1. Open a chat and **Extensions → ScenePulse** settings. The interface may use the
   original ScenePulse name in some controls.
2. Follow the setup wizard and choose a recovery connection profile if you want
   automatic recovery when an inline tracker is missing. The current **Unreleased**
   setup starts with a language selector; released builds also expose language in settings.
3. Start with **Together**, the default, or choose **Separate** for a dedicated
   tracking request. Keep automatic generation enabled to update after replies.
4. Send a message. Open the side panel on desktop or the floating icon on mobile
   to see the extracted scene.
5. Use **Panel Manager** to choose fields and panels. Use the timeline to inspect
   earlier snapshots and the character wiki to browse the cast.

Need to rebuild stale state? Run `/sp-refresh`. For panel performance, enable
**General → Reduce visual effects**. The [full guide](docs/USER_GUIDE.md) covers
shortcuts, macros, themes, profile management, and manual editing.

## Choose how tracking runs

| | Together · default | Separate |
| :--- | :--- | :--- |
| **Extraction** | The narrative reply includes a tracker block, hidden from the visible message. | A dedicated request extracts state after the narrative reply. |
| **Connection** | Uses the narrative generation; optional recovery can use another profile. | Can use a saved connection profile for tracking. |
| **Useful when** | The model reliably follows inline structured-output instructions. | You want a separate tracker connection or the narrative model struggles with inline tracking. |
| **Trade-off** | Tracker instructions and output share the narrative request. | Extra requests add latency and provider usage. |

**Delta updates** carry unchanged data forward and periodically request a full refresh.
Savings depend on the model and scene. **Parallel extraction** is optional, off by
default, and available in Separate mode with a saved connection profile; higher
concurrency does not guarantee faster results. Automatic custom-panel selection
requires Separate with parallel extraction.

Together includes the previous scene state as context. In Separate, enable
**Embed snapshots** to supply continuity context to the next narrative response.
Custom schemas and full prompt overrides must explicitly include the fields you want.

[Generation details and recovery →](docs/USER_GUIDE.md#how-it-works)

## Current version and prepared changes

**Latest release: v7.1.16** — schema-derived JSON contracts, more reliable extraction,
consistent section updates, and preservation of confirmed scene records.

The working tree also contains **Unreleased** improvements. The version remains
7.1.16; these additions are not a separate published release:

- Language selection at the start of setup and improved mobile setup layout.
- Host API diagnostics, tracker display integration, and direct profile requests
  where the required SillyTavern APIs are available.
- Per-chat persona change confirmation and an explicit extension **Clean** action.
  Clean resets settings, custom prompt/schema profiles and caches, while preserving
  the panel library and chat snapshots.
- Native scene-build progress and cancellation, ordered group auto-builds, and
  fixes for Together recovery after cancellation.
- Multilingual token estimates, preset matching, Doctor validation, historical
  source-trace stability, and thoughts following the selected timeline snapshot.

[All changes](CHANGELOG.md#unreleased) · [Verification and remaining acceptance gaps](tests/README.md)

## Make it yours

Six themes, font scaling, a mobile layout, reduced-motion support, and **English plus 29 locale dictionaries** are included. Russian has complete UI-dictionary coverage; other
translations are partial and fall back to English. See the [coverage report](locales/_coverage.json).

Use prompt/schema profiles for different settings and custom panels for systems
such as health, mana, reputation, or faction standings. Diagnostics include a
Debug Inspector, payload comparison, token analytics, and opt-in Scene Source Trace.
Model output can still omit or misinterpret facts; inspect and correct important state.

| Learn more | |
| :--- | :--- |
| [User guide](docs/USER_GUIDE.md) | Feature reference, settings, modes, commands, and limitations. |
| [Custom panels](docs/USER_GUIDE.md#custom-panels) | Field types, character panels, and custom-schema requirements. |
| [Model presets](presets/README.md) | Preset format, examples, and contribution workflow. |
| [Architecture](ARCHITECTURE.md) | Modules, state ownership, generation, and continuity contracts. |
| [Tests and compatibility](tests/README.md) | Automated checks, live verification, and known coverage gaps. |

## Contribute

[Report a bug or suggest an improvement](https://github.com/l1kiru/SillyTavern-ScenePulseN/issues/new/choose),
improve a translation, or share a tested model preset. Include the model, provider,
settings, and observed result when contributing tuning advice.

[Contribution guide](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Preset examples](presets/_examples/)

## Credits and license

ScenePulseN is a community-maintained fork of [ScenePulse](https://github.com/xenofei/SillyTavern-ScenePulse).
The original project and core architecture are by [xenofei](https://github.com/xenofei).
**ScenePulseN fork maintained by [l1kiru](https://github.com/l1kiru).**

Thanks also to the projects that inspired ScenePulse: [RPG Companion](https://github.com/SpicyMarinara/rpg-companion-sillytavern),
[Dooms Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite),
[WTracker](https://github.com/bmen25124/SillyTavern-WTracker), and
[zTracker](https://github.com/Zaakh/SillyTavern-zTracker).

[GPL-3.0](LICENSE). Vendored jsonrepair retains its [ISC license](src/vendor/jsonrepair.LICENSE).
