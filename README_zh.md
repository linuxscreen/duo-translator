[README](README.md) | [中文文档](README_zh.md)
<h1 align="center">
  <img align="top" width="44" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/public/DuoTranslator.svg" alt="DUO Logo">
  <span>Duo Translator</span>
</h1>

AI驱动的翻译和写作助手。支持网页翻译、划词翻译、写作增强等。

## 特性
- 翻译
  - 网页翻译
  - 段落翻译和划词翻译
  - 输入框翻译
  - 原文和译文逐句对照高亮
  - 文本转语音 (TTS)
- AI写作
  - 输入框中快速完成语法纠错、润色、翻译等操作
  - AI工作台编辑长文本
- 接入多种翻译和AI服务
- 同步和备份配置

## 安装
添加到您的浏览器：

<p>
  <a href="https://chromewebstore.google.com/detail/duotranslator/pjniaipnjcdiiglednmhgmjmpmllelke"><img src="./docs/assets/badge-chrome.svg" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/duotranslator/aagmdliblgcoijibaiohkdfpkopekoeo"><img src="./docs/assets/badge-edge.svg" alt="Edge Add-ons"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/duo-translator/"><img src="./docs/assets/badge-firefox.svg" alt="Firefox Add-ons"></a>
</p>

或者您可以通过zip文件手动安装。

## 截图
<div align="center">
<img style="width: 384px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/popup.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/options.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/webpage-translation.png" alt="">
<img style="width: 768px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/ai-workbench.png" alt="">
</div>

# 开发

基于 [WXT](https://wxt.dev/) + React 构建，包管理器使用 [pnpm](https://pnpm.io/)。

1. 安装依赖：`pnpm i`
2. 启动开发构建（支持热重载）：`pnpm dev`（Firefox：`pnpm dev:firefox`）
3. 打开 `chrome://extensions/`，开启开发者模式，从 `.output/chrome-mv3-dev` 文件夹加载已解压的扩展程序

其他命令：

- `pnpm build` — 生产构建，输出到 `.output/chrome-mv3`（Firefox：`pnpm build:firefox`，Edge：`pnpm build:edge`）
- `pnpm zip` — 打包扩展用于商店上传
- `pnpm test` — 单元测试（Vitest）
- `pnpm e2e:build && pnpm e2e` — 端到端测试（Playwright）

友情链接

感谢 [LINUX DO](https://linux.do/) 社区提供的帮助与支持。