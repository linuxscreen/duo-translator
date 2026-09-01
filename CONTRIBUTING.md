# Contributing to Duo Translator

Thank you for your interest in contributing! All kinds of contributions are welcome — bug reports, feature requests, translations, documentation, and code.

## Reporting Bugs

Before opening an issue, please search [existing issues](https://github.com/linuxscreen/duo-translator/issues) to avoid duplicates.

When reporting a bug, include:

- Browser and version (Chrome / Edge / Firefox / Safari)
- Extension version
- Steps to reproduce the problem
- What you expected to happen vs. what actually happened
- The URL of the page where the problem occurs, if relevant
- Screenshots or console errors (open DevTools → Console), if available

## Suggesting Features

Open an issue describing the feature, the problem it solves, and how you imagine it working. Discussing the idea first helps avoid wasted effort before you start writing code.

## Development setup

```bash
pnpm install          # postinstall runs `wxt prepare`; needed before typechecking
cp .env.example .env  # no secrets are required for local development
pnpm dev              # Chrome MV3 dev build with HMR → .output/chrome-mv3-dev/
```

CI runs on Node 22 and pnpm 11. `pnpm dev` launches a browser with the extension loaded; you can also load `.output/chrome-mv3-dev/` yourself from `chrome://extensions` → Developer mode → **Load unpacked**. (A gitignored `web-ext.config.ts` at the repo root customises or disables the launch — useful if you want to keep using your own browser profile.)

Other targets: `pnpm dev:firefox`, `pnpm build`, `pnpm build:firefox`, `pnpm build:edge`, `pnpm build:safari`. All targets are Manifest V3. Production builds are stricter than `pnpm dev` — they fail on things dev tolerates — so run one before opening a PR.

Two things HMR cannot do: **adding a new entrypoint requires restarting `pnpm dev`** (dev builds register content scripts at runtime, so a new one simply never appears), and occasionally a change does not land — compare your source with what DevTools shows under Sources, and reload the extension from `chrome://extensions` if they differ.

## How the extension is put together

Three runtime contexts. Most confusing bugs come from writing code in the wrong one:

| Context | Entry point | Owns |
| --- | --- | --- |
| Background (service worker; an event page on Firefox) | `entrypoints/background.ts` → `main/background.ts` | Every network request, provider credentials, caches, keyboard commands, cloud sync |
| Content script (injected into **every frame** of every `http(s)` page) | `entrypoints/content.ts` → `main/content.ts` | DOM scanning, translation write-back, in-page UI |
| Extension pages (popup, options) | `entrypoints/popup/`, `entrypoints/options/` | React + Tailwind settings UI |

They communicate only through `chrome.runtime` messages whose names are enumerated in [main/constants.ts](main/constants.ts) (`ACTION`, `DB_ACTION`, `STORAGE_ACTION`, …) — add to those enums instead of passing ad-hoc strings. Note that `sendMessage` strips prototypes: a class instance that crosses the boundary has to be rebuilt on the far side.

## Rules a PR is checked against

Deliberately a short list. Each entry is here because breaking it once produced a bug that was very hard to see from the outside.

**Network requests belong in the background.** MV3 content scripts have no cross-origin privileges — Chrome applies page-origin CORS, Firefox applies the host page's CSP — so a fetch that works on one site fails on the next, and `host_permissions` does not help. Content asks background *by meaning* (`ACTION.TRANSLATE_TEXTS` with `{service, texts, targetLang}`); background owns the provider classes, the API keys and the result cache. An e2e test asserts that no provider endpoint or credential ends up in the content bundle — when you add a provider, add its host to that list.

**Register listeners in the first synchronous turn.** In background, an event page is only woken for listeners registered during initial script evaluation; one registered after an `await` silently stops working once the browser suspends the backend. In content, the startup path awaits several config reads, and a user gesture during that window is one-shot — a listener registered afterwards is, from the user's seat, a feature that does nothing. Register early, and do the waiting inside the handler.

**We are a guest in someone else's page.** Prefer not writing to page DOM at all: paragraph bookkeeping lives in memory rather than in classes on page elements, so a framework re-render cannot destroy it. Draw highlights as boxes in an overlay instead of `outline` on page nodes (an outline is clipped by any `overflow:hidden` ancestor). And **never patch native DOM methods** — a wrapped `Element.prototype.attachShadow` once made a site's bot check fail on its login page, with nothing pointing back at the extension. The only MAIN-world content script we keep is scoped to a single site; a general one will not be accepted.

**Failures must reach the user.** Providers throw; they never `catch { return [] }`. Resilience belongs at the batch level in the content script, where one failed batch leaves the rest of the page readable — while the reason travels back and is shown on the page. Route it through `reportRequestError` in [main/errorReport.ts](main/errorReport.ts); the only exception is a surface that already displays the reason inline. A failure logged solely to the background console is invisible: that console lives behind `chrome://extensions` and nobody opens it.

**Measure before adding per-element work.** The marking scan visits every element on the page, so anything added there is multiplied by tens of thousands. Put a `performance.now()` probe around it and report the numbers in the PR. Chrome timings are not evidence about Firefox: there, every property read on a page node crosses an Xray wrapper, and a walk that is free in Chrome can cost an order of magnitude more.

## UI, theming and i18n

- New UI is **React + Tailwind**, including in-page surfaces (which mount into a Shadow DOM). No `innerHTML` strings or hand-rolled DOM for new features.
- **Never hardcode colors.** Use the `--color-*` tokens. Dark values are the base and light is an override block, so a literal color looks correct in dark and breaks in light. Every new Shadow DOM surface must call `bindThemeToElement(mount)`, or it stays dark forever.
- Extension pages must not load remote resources (fonts, CSS, scripts, images) — bundle them. Remote assets hang in regions that cannot reach the CDN and count against store review.
- Every user-visible string goes through i18n: `assets/locales/<lang>.json` for UI text, `public/_locales/<lang>/messages.json` for manifest strings.
- Form dialogs: mark required fields with a red `*`, disable save until the form is valid (validation has to be a derived value, not a function that only runs on click), and pass errors to the `error` prop of `Dialog` so they cannot scroll out of sight below a long form.

## Settings and storage

Config lives in `chrome.storage.local` under three key prefixes (`config_`, `rule_`, `domain_`), managed by the repositories in [main/storage/configStore.ts](main/storage/configStore.ts).

- Add a new setting to `CONFIG_KEY` and its default to `DEFAULT_VALUE` in [main/constants.ts](main/constants.ts). Readers resolve defaults from there, so a default is defined once.
- **Write through `setConfig`**, not `storage.setItem`. Cloud sync keeps a per-key clock that is updated on write; skipping it means the value can be quietly reverted by the next sync.
- Read with `readConfig(key)` (async — it always resolves to the stored value) or the `useConfig` hook in React. Don't add a default argument; that is what `DEFAULT_VALUE` is for.

## Tests

Three layers. Putting a test in the wrong one is the usual reason it passes while the feature is broken.

- `pnpm test` — Vitest + jsdom, for pure logic and DOM shape. jsdom has **no layout**: `getClientRects()` is always empty, so anything geometric belongs either in a pure predicate over rectangles (testable) or in e2e. It also lacks `isContentEditable`, `CSS.highlights` and `adoptedStyleSheets`.
- `pnpm e2e:build` then `pnpm e2e` — Playwright loading the **real built extension** with mocked translation providers. Anything involving layout, hit-testing, real styling or multiple frames goes here.
- `pnpm e2e:real` hits a live translation API and is deliberately **not** part of CI.

Assert observable output — translated nodes in the page, or the payload a provider received — rather than internal markers, which live in memory and are unreachable from page context. When a test asserts that something does *not* happen, give it a positive synchronisation point first: `expect.poll` succeeds on its first sample, which is usually before the thing you are guarding against could have occurred.

## Logging

The extension logs into **someone else's page console**, next to whatever the site itself prints, so the level you pick and the prefix you use both matter.

| Level | How to write it | Kept in production? | Use it for |
| --- | --- | --- | --- |
| Error | `console.error(APP_NAME_WITH_SUFFIX, msg, e)` | Yes | Serious failures |
| Warning | `console.warn(APP_NAME_WITH_SUFFIX, msg)` | Yes | Serious problems the code can still continue past |
| Info | `console.log(APP_NAME_WITH_SUFFIX, msg)` | Yes | Non-fatal, but useful when diagnosing a report |
| Debug | `console.debug(msg)` | **No — stripped** | Development-time tracing |

- **Info goes through `console.log`, not `console.info`.** There is no `console.info` anywhere in the repo; please keep it that way, so "where are our info logs" has one answer.
- **Always pass `APP_NAME_WITH_SUFFIX` (from [main/constants.ts](main/constants.ts)) as the first argument** of anything that survives into production. It is what lets a user filter our lines out of a busy page console — without it the log may as well not exist.
- **`console.debug` / `console.trace` are removed from production builds** (`terserOptions.compress.pure_funcs` in [wxt.config.ts](wxt.config.ts), which only applies when `NODE_ENV=production`). They are still present in `pnpm dev` and in `--mode development` builds, so seeing one locally tells you nothing about the shipped build. Never rely on debug output for diagnosing a released version, and note that expensive arguments (`JSON.stringify(...)`) still run even when the call itself is dropped.
- **Pick the level by who will read it, not only by severity.** The page console is something a user can open (F12), so anything that answers "why was this paragraph not translated" deserves an info line.

## Pull Requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `perf:`, `chore:`, optionally scoped — `fix(highlight): …`). `master` stays linear, and release notes are derived from the history.

Every pull request runs the CI workflow ([.github/workflows/ci.yaml](.github/workflows/ci.yaml)), and it must be green before the PR can be merged:

| Check | Command | What it covers |
| --- | --- | --- |
| i18n key parity | `pnpm i18n:check` | `assets/locales/` and `public/_locales/` stay in sync between `en` and `zh-CN` |
| Typecheck | `pnpm compile` | `tsc --noEmit` over the whole repo, `e2e/` included |
| Unit tests | `pnpm test` | Vitest suite |
| Build | `pnpm build` / `pnpm build:firefox` | Production builds for both targets |
| E2E | `pnpm e2e:build` then `pnpm e2e:no-real` | Playwright against the real built extension, with mocked providers |

You can run all of them locally before pushing. The `@real` e2e smoke test (`pnpm e2e:real`) hits a live translation API and is deliberately **not** part of CI.

## Translations

Improvements to existing translations and new locales are welcome. UI strings live in `assets/locales/` (i18next JSON) and `public/_locales/` (Chrome manifest messages).

When you add or change a **feature**, only update `en` and `zh-CN`; the remaining locales are filled in together before a release.

## License

By contributing, you agree that your contributions will be licensed under the [GPL-3.0 License](LICENSE), the same license that covers the project.
