# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
