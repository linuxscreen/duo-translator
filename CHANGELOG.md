# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.4] - 2026-08-25

### Changed

- Translations show up about twice as fast after an in-page navigation on single-page sites: shadow-DOM style sheets are injected in one batch instead of one at a time, the paragraph scan yields to the browser in a way that gets it scheduled back right away, and paragraphs are handed to the translator as the scan finds them rather than only once the whole page has been scanned. Measured on a Reddit thread, the first translated line went from about 1.1 s to about 0.5 s after the page content was ready

### Fixed

- The selection translate icon landing far away from the selected text — sometimes a thousand pixels off. It was placed at the caret, which is not always where the highlight ends: releasing the mouse over something that cannot be selected (a button), a selection ending exactly at a line wrap, or one ending on an element edge all sent it elsewhere. It now follows the end of the visible highlight, on whichever end the drag finished
- The translation card opening in the wrong place after a selection that crossed several paragraphs: screen-reader-only text parked far outside the page was measured as part of the selection, so the card was positioned against a box nobody can see
- Pages freezing while typing when the site rebuilds a list on every keystroke — a documentation search box, a virtual list, a route change. Every removed node made the extension walk its entire bookkeeping, right inside the change callback; on Firefox a single keystroke could hold the tab for over a second. That work is now batched and no longer walks the page tree. The pause was worst on Firefox but present everywhere

## [2.2.3] - 2026-08-20

### Added

- Safari support (beta). The release asset is the raw extension rather than a double-click install: on Safari 18.4 and later it is loaded from its folder through Settings → Developer → Add Temporary Extension, which lasts for the session — see the README for the steps. Google Drive sync and the built-in on-device AI translator are not available there; WebDAV and every other service are
- Google Drive as a sync target next to WebDAV, with a sync-method picker — one target at a time, chosen per device. Chrome can authorize through the browser itself; the other builds use web sign-in, and an expired session now asks to reconnect instead of quietly reading as never connected
- The selection translate icon inside `<input>` and `<textarea>`: text selected in an input box gets the same icon as the rest of the page, placed on the selection itself

### Changed

- The selection popup follows the selected text while the page scrolls; a pinned card stays where it was put
- Errors in the settings page stay on screen until dismissed, can be selected and carry a copy button, and a repeated error counts up instead of stacking — success messages still disappear on their own
- Shortcuts are written with the macOS symbols on a Mac, and the double-tap modifier is labelled Control / Option there

### Fixed

- YouTube's own captions coming back on. Loading a bilingual subtitle track makes the player select it, which YouTube records as the viewer's caption preference, so native captions returned on the next video and after every reload. No track is loaded while the overlay is off (subtitle download still works, it asks for one explicitly), and the track is cleared again when it goes off
- The selection translate icon appearing for a selection that had been scrolled out of view
- Text selected inside web components (shadow DOM) on Firefox and Safari: the selection reported no position, so the icon never appeared and the translation card opened in the middle of the screen
- Dropdowns in the popup closing themselves the moment they opened on Safari — the same auto-resizing-popup problem fixed for Firefox earlier, which had been tied to the browser's name instead of the behaviour
- Bilingual sentence highlighting leaving its colours on screen after the pointer left the paragraph on Safari
- Recording a Control+key shortcut on macOS installed Command+key instead
- WebDAV servers and rule subscriptions on a non-standard port: the permission was asked for with the port in it, which Safari rejects outright and Firefox grants without it taking effect — surfacing much later as a network error
- The sync file no longer carries the cached contents of website-rule subscriptions, which are re-fetchable and had been inflating every sync; remote files that already contain them shrink on their own at the next sync

## [2.2.2] - 2026-08-18

### Added

- Languages that are never auto-translated — the rule covers whole pages, individual paragraphs and YouTube subtitle tracks, and a video whose captions are on the list gains an "original only (this time)" entry in the subtitle menu
- Model dropdown in the AI provider form, with a free-text field for models the list does not carry yet
- Choice between click and hover to fire the selection-translate icon

### Changed

- Collections now sync item by item: adding an AI provider, a site rule or a subscription on one device no longer discards what another device added, and importing a backup keeps items only present locally
- The video subtitle box is dragged by its blank area instead of the grip above it — the grip shared that strip of screen with the dictionary panel

### Fixed

- Content added to an already-translated paragraph is now translated, and translationOnly mode no longer resent every paragraph to the translator on each page change. A re-translated paragraph also keeps its previous translation on screen until the new one arrives
- Buttons and other self-contained inline elements are translated on their own, so their labels are no longer folded into the surrounding sentence nor cloned into the bilingual output
- Removed the last patch of a native browser method — a second Cloudflare verification failure traced back to it, since replacing native methods is what anti-bot checks look for. Shadow roots attached long after their element was inserted are no longer picked up right away; the next change nearby recovers them
- Refreshing website rule subscriptions no longer overwrites a subscription added moments earlier
- The docked floating ball stays expanded while the pointer rests on it, and its settings/close buttons no longer overlap each other's click areas
- The AI writing dot no longer appears in web terminals and code editors (xterm.js-based panels, CodeMirror, Monaco, Ace) or in read-only fields, where writing back was never possible

## [2.2.1] - 2026-08-14

### Fixed

- Cloudflare human verification failing while the extension was enabled

### Changed

- Text inside closed shadow roots is no longer translated. Reaching into them is what broke the Cloudflare check, and the same technique guards captchas, payment fields and SSO popups. Sites built with the mainstream component frameworks are unaffected — those use open shadow roots.

## [2.2.0] - 2026-08-13

### Added

- Built-in AI translate service with on-device model management
- Yandex translate service
- Translation support for content inside Shadow DOMs
- Selection translation icon, movable and resizable popup, and dictionary lookup
- YouTube subtitle enhancements: original-only mode, hover dictionary, native CC sync, source-language controls, minimal player UI, and subtitle downloads
- Per-site option to translate all elements
- Translation progress indicators with error details and retry actions
- New translation styles: weaken, quote, and blur

### Changed

- Redesigned the docked floating ball while retaining the classic style
- Expanded built-in website rules to 438 and added incremental list rendering

### Fixed

- Preserve local API keys when importing redacted backups
- Support UTF-8 characters in WebDAV credentials
- Prevent the floating ball from expanding when a window regains focus
- Show a refresh prompt when a page uses an invalidated extension context

## [2.1.0] - 2026-08-06

### Added

- Video Subtitles (YouTube bilingual subtitles)
- Website translation rules (Per-site translate areas, no-translate areas and custom CSS)
- Translation module architecture refactor

### Fixed

- Microsoft Translator API failure
- Introduced logical paragraphs to improve the reading experience
- Implemented bilingual highlighting with a new API to avoid intrusive modifications

## [2.0.1] - 2026-07-17

### Added

- New modern UI, support dark and light theme switching
- AI Writing, input box enhancement & AI workbench
- Paragraph and selection translation
- Config sync (Webdav) & backup
- Text-to-speech (TTS) service
- Translation cache support
- Double-tap shortcuts
- AI service integrations (OpenAI, DeepSeek, Gemini, OpenRouter, Claude, Ollama, and custom)
- Support translation service DeepL
- Support Firefox

### Fixed

- Paragraph marking survives SPA re-renders (in-memory marks instead of DOM classes)
