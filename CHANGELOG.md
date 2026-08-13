# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
