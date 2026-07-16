[README](README.md) | [中文文档](README_zh.md)
<h1 align="center">
  <img align="top" width="44" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/public/DuoTranslator.svg" alt="DUO Logo">
  <span>Duo Translator</span>
</h1>

An AI-powered translation and writing assistant. Supports webpage translation, selected text translation, writing enhancement, and more.

## Features
- Translation
  - Webpage Translation
  - Paragraph and Selection Translation
  - Input box Translation
  - Highlights the original and translation sentence by sentence
  - Text-to-speech (TTS)
- AI Writing
  - Correct grammar, polish, translate, and more directly in input box
  - AI workbench to edit long-form text
- Multiple Translation and AI Service Integrations
- Sync & Backup Config

## Installation
Add to your browser:

<p>
  <a href="https://chromewebstore.google.com/detail/duotranslator/pjniaipnjcdiiglednmhgmjmpmllelke"><img src="./docs/assets/badge-chrome.svg" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/duotranslator/aagmdliblgcoijibaiohkdfpkopekoeo"><img src="./docs/assets/badge-edge.svg" alt="Edge Add-ons"></a>
  <!-- todo fill firefox href -->
  <a href=""><img src="./docs/assets/badge-firefox.svg" alt="Firefox Add-ons"></a>
</p>

Alternatively, you can install it manually using the ZIP file.

## Screenshots
<div align="center">
<img style="width: 384px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/popup.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/options.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/webpage-translation.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/ai-workbench.png" alt="">
</div>


# Development

Built with [WXT](https://wxt.dev/) + React. Package manager is [pnpm](https://pnpm.io/).

1. Install dependencies: `pnpm i`
2. Start the dev build (with HMR): `pnpm dev` (Firefox: `pnpm dev:firefox`)
3. Open `chrome://extensions/`, enable Developer mode, and load the unpacked extension from `.output/chrome-mv3-dev`

Other commands:

- `pnpm build` — production build to `.output/chrome-mv3` (Firefox: `pnpm build:firefox`, Edge: `pnpm build:edge`)
- `pnpm zip` — package the extension for store upload
- `pnpm test` — unit tests (Vitest)
- `pnpm e2e:build && pnpm e2e` — end-to-end tests (Playwright)