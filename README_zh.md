<h1 align="center">
  <img align="top" width="44" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/public/icon/48.png" alt="DUO Logo">
  <span>双语翻译</span>
</h1>

<div align="center">
<img style="width: 384px" src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/pop-cn.png" alt="">
<img src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/option-cn.png" alt="">
<img src="https://raw.githubusercontent.com/linuxscreen/duo-translator/HEAD/docs/assets/translate-page.png" alt="">
</div>

简单易用的翻译插件,支持双语和对比高亮等功能。

## 用法

在规则模式下，你需要在原始状态页面上点击“Enter”按钮以激活规则模式。选择你不想翻译的区域，光标会变成加号（+），并且边框会变为绿色。左键点击后，选中的区域会被黄色边框高亮显示。当你将光标悬停在该区域时，边框会变为红色，光标会变为垃圾桶图标。再次左键点击该区域以将其从规则中移除。要退出规则模式，可以右键点击、刷新页面或再次点击插件图标。

# 开发

首先，运行`pnpm i`来安装依赖项。

然后，运行`pnpm dev`来启动开发服务器。

最后，打开浏览器，从`.output/chrome-mv3`文件夹中添加加载解压的扩展程序。
