# Contributing to Duo Translator

Thank you for your interest in contributing! All kinds of contributions are welcome — bug reports, feature requests, translations, documentation, and code.

## Reporting Bugs

Before opening an issue, please search [existing issues](https://github.com/linuxscreen/duo-translator/issues) to avoid duplicates.

When reporting a bug, include:

- Browser and version (Chrome / Edge / Firefox)
- Extension version
- Steps to reproduce the problem
- What you expected to happen vs. what actually happened
- The URL of the page where the problem occurs, if relevant
- Screenshots or console errors (open DevTools → Console), if available

## Suggesting Features

Open an issue describing the feature, the problem it solves, and how you imagine it working. Discussing the idea first helps avoid wasted effort before you start writing code.

## Pull Requests

Every pull request runs the CI workflow ([.github/workflows/ci.yaml](.github/workflows/ci.yaml)), and it must be green before the PR can be merged:

| Check | Command | What it covers |
| --- | --- | --- |
| i18n key parity | `pnpm i18n:check` | `assets/locales/` and `public/_locales/` stay in sync across languages |
| Typecheck | `pnpm compile` | `tsc --noEmit` over the whole repo, `e2e/` included |
| Unit tests | `pnpm test` | Vitest suite |
| Build | `pnpm build` / `pnpm build:firefox` | Production builds for both targets |
| E2E | `pnpm e2e:build` then `pnpm e2e:no-real` | Playwright against the real built extension, with mocked providers |

You can run all of them locally before pushing. The `@real` e2e smoke test (`pnpm e2e:real`) hits a live translation API and is deliberately **not** part of CI.

## Translations

Improvements to existing translations and new locales are welcome. UI strings live in `assets/locales/` (i18next JSON) and `public/_locales/` (Chrome manifest messages).

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0 License](LICENSE), the same license that covers the project.
