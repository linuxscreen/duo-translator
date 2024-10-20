[README](README.md) | [中文文档](README_zh.md)
<h1 align="center">
  <img align="top" width="44" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/public/icon/48.png" alt="DUO Logo">
  <span>duo-translator</span>
</h1>

<div align="center">
<img style="width: 384px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/duo-en.png" alt="">
</div>

Easy to use translation plug-in with bilingual and contrast highlighting functions.

## Usage

For rule mode, you need on the original status page, click the Enter button to activate rule mode. Select the area you don't want to translate; the cursor will change to a plus sign (+) and the border will turn green. Left-click, and the selected area will be highlighted with a yellow border. When you hover over the area, the border will turn red, and the cursor will change to a trash icon. Left-click the area to remove it from the rule. To exit rule mode, right-click, refresh the page, or click the plugin icon again.

# Development 

First, run `pnpm i` to install the dependencies.

Then, run `pnpm dev` to start the development server and visit localhost:3000.

Finally, open browser add load unpacked extension from `.output/chrome-mv3` folder.
