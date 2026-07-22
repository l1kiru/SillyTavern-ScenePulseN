# Contributing to ScenePulse

Thank you for your interest in contributing to ScenePulse!

## Reporting Bugs

1. Check [existing issues](https://github.com/xenofei/SillyTavern-ScenePulse/issues) first
2. Use the bug report template when creating a new issue
3. Include: ScenePulse version, SillyTavern version, browser, AI model/provider, steps to reproduce
4. Attach the SP debug log (Settings > Advanced > SP Log) and any console output

## Feature Requests

Open an issue using the feature request template describing:
- What you want to achieve
- Why existing features don't cover it
- Any implementation ideas

## Code Contributions

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Test with at least one AI model in both Together and Separate modes
5. Bump the version in `manifest.json`; `src/constants.js`, `package.json`, README, and CHANGELOG must agree (the tests enforce this)
6. Submit a pull request

## Translation Contributions

ScenePulse exposes 29 selectable languages. Locale structure is enforced independently from translation completeness: every locale contains the full active key set, while untranslated values deliberately fall back to the English source text.

To improve or add translations:

1. Edit the relevant `locales/<language>.json` file.
2. Preserve every `{placeholder}` and HTML tag exactly.
3. Run `npm run sync-locales` to refresh the generated source catalog and coverage report.
4. Review `locales/_coverage.json`; a value equal to its key is counted as an English fallback.
5. Run `npm test` and submit the locale changes together with the generated metadata.

Do not edit `locales/_source.json` or `locales/_coverage.json` by hand.

## Code Style

- ES modules (`import`/`export`) — no bundler required
- No external dependencies — everything runs natively in the browser
- CSS split by component in `css/` directory, loaded via `@import` in `style.css`
- Follow existing naming conventions (`sp-` prefix for CSS classes, camelCase for JS)
- All mutable state in `src/state.js` with explicit setter functions

## Questions?

Open a [discussion](https://github.com/xenofei/SillyTavern-ScenePulse/discussions) or [issue](https://github.com/xenofei/SillyTavern-ScenePulse/issues).
