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
- 视频字幕（YouTube 双语字幕）
- 接入多种翻译和AI服务
- 同步（WebDAV）和备份配置
- 网站翻译规则（按网站设置翻译区域、不翻译区域和自定义 CSS）

## 安装
添加到您的浏览器：

<p>
  <a href="https://chromewebstore.google.com/detail/duotranslator/pjniaipnjcdiiglednmhgmjmpmllelke"><img src="./docs/assets/badge-chrome.svg" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/duotranslator/aagmdliblgcoijibaiohkdfpkopekoeo"><img src="./docs/assets/badge-edge.svg" alt="Edge Add-ons"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/duo-translator/"><img src="./docs/assets/badge-firefox.svg" alt="Firefox Add-ons"></a>
</p>

或者您可以通过zip文件手动安装。

<details>
<summary><b>Safari（beta）—— 手动安装</b></summary>

要求 **macOS 上的 Safari 18.4 或更高版本**。

1. 从 [Releases](https://github.com/linuxscreen/duo-translator/releases) 下载 `duo-translator-<版本号>-safari-beta.zip` 并解压，含有 `manifest.json` 的那个目录就是扩展本体 —— 请放在一个固定位置，Safari 是就地读取它的。
2. 打开 Safari 的 **设置 → 高级**，勾选 **显示网页开发者功能**，设置窗口里会多出一个 **开发者** 标签页。
3. 进入 **设置 → 开发者**，打开 **允许未签名的扩展**。
4. 点击 **添加临时扩展…**，用 Mac 密码或触控 ID 确认，然后选择第 1 步里那个目录（含 `manifest.json` 的那一层）。
5. 打开 **设置 → 扩展**，勾选 **DuoTranslator**，并把网站访问权限设为「在所有网站上允许」—— 扩展是在页面上原地改写内容的，需要访问您浏览的网站。

**临时扩展只在当前这次 Safari 会话中有效。** 退出 Safari 就会被卸载，下次启动要重做第 3–5 步。商店版本目前还未上架。

快捷键从 Safari 26 起才能修改，入口在 Safari → 设置 → 扩展。

</details>

## 社区

- [Discord](https://discord.gg/VSjWP752JV)
- [Telegram 中文](https://t.me/+v7Z9ssqrQLc3OGI5)
- [Telegram](https://t.me/+_097YKqnuGhlYmNh)

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
