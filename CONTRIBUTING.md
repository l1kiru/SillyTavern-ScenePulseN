# Contributing to ScenePulseN

[English overview](README.md) · [Обзор на русском](README.ru.md) · [User guide](docs/USER_GUIDE.md)

Bug reports, translations, tested model presets, documentation, and code changes
are welcome. Issues and pull requests may be written in English or Russian.

## Report a problem

Search [existing issues](https://github.com/l1kiru/SillyTavern-ScenePulseN/issues), then
[open a bug report](https://github.com/l1kiru/SillyTavern-ScenePulseN/issues/new?template=bug_report.yml).
Include the extension version and branch/commit, SillyTavern version, browser,
model/provider, tracking mode, and the smallest reproducible sequence.
For generation bugs, note whether parallel extraction, a separate connection
profile, custom schemas, or custom panels are involved.

Use **Settings → Advanced → Debug Inspector** for diagnostics. Review logs,
screenshots, payloads and configuration exports before attaching them: remove API
keys and private chat or character content. Report vulnerabilities using the
[security policy](SECURITY.md), rather than a public issue.

For a feature request, describe the task you want to accomplish, what is missing,
and any workaround you have tried.

## Share a model preset

A useful report includes the exact model and provider, sampler values, changed
prompt slots or roles, and before/after observations. JSON compliance, continuity,
name handling, and avoiding stale characters are particularly useful test cases.

- Follow the [preset format](presets/README.md) and [examples](presets/_examples/)
  when contributing a JSON preset.
- For bundled tuning, edit [built-in presets](src/presets/built-in.js) and explain
  the model-specific change.
- If you do not have a patch, [open an issue](https://github.com/l1kiru/SillyTavern-ScenePulseN/issues/new/choose)
  with your tested settings.

## Improve a translation

The interface offers English plus 29 locale dictionaries. Matching the full key set does not
mean every value has been translated: English fallback is intentional.

1. Edit the relevant `locales/<language>.json` file.
2. Preserve placeholders such as `{count}` and HTML tags.
3. Run `npm run sync-locales` to refresh the generated catalog and coverage report.
4. Review [coverage](locales/_coverage.json), then run `npm test`.
5. Include the locale and generated metadata in your pull request.

Do not edit `locales/_source.json` or `locales/_coverage.json` by hand.

## Change code or documentation

1. Fork this repository and create a focused branch.
2. Read the [architecture map](ARCHITECTURE.md) and nearby implementation/tests.
3. Keep changes scoped and update the relevant documentation.
4. Run the checks appropriate to the change and describe their results in your PR.
5. Follow the repository's [versioning protocol](ARCHITECTURE.md#versioning-protocol)
   when preparing commits. Keep `manifest.json`, `src/constants.js`, `package.json`,
   version references in both READMEs, and the changelog consistent.
6. Open a pull request against this fork and link the relevant issue, if any.

### Checks

Requires **Node.js 20+** for the regression suite:

```bash
npm ci
npm test
```

The runner checks JavaScript syntax and discovers top-level and nested regression
tests. Individual files can be run with `node tests/<name>.test.mjs`.

For generation or UI changes, verify the affected paths in SillyTavern, including
Together/Separate, Full/Delta, and mobile where relevant. Automated tests do not
prove real-provider behavior. Use the [test guide](tests/README.md) to record the
host, model, results, and remaining gaps.

For documentation changes, check relative links and anchors and preview both
READMEs. Keep the English and Russian overviews aligned. Detailed feature/settings
reference belongs in [the user guide](docs/USER_GUIDE.md); implementation contracts
belong in the architecture map. Keep prepared work marked **Unreleased**.

### Conventions

- Native ES modules; no bundler or new runtime dependency is required.
- Component styles live in `css/` and load through `style.css`.
- Follow existing `sp-` CSS names and JavaScript naming conventions.
- Respect state ownership and setters documented in the architecture map.
- Preserve chat snapshots, user configuration, and existing translations.

## Credits

Keep attribution to the original ScenePulse project and its author, xenofei.
ScenePulseN is maintained by l1kiru and distributed under [GPL-3.0](LICENSE).
