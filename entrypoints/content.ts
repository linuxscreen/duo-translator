import {browser} from "wxt/browser";
import {Rule, sendMessageToBackground, SubRule, UrlStorage} from "@/entrypoints/utils";
import {split} from "sentence-splitter"
import {
    CONFIG_KEY,
    DB_ACTION,
    DOMAIN_STRATEGY,
    STATUS_FAIL,
    STATUS_SUCCESS, STORAGE_ACTION,
    TB_ACTION,
    TRANS_ACTION, VIEW_STRATEGY
} from "@/entrypoints/constants";
import {
    translateParams,
    translationServices
} from "@/entrypoints/translateService";
import log from "loglevel";

export function showTransPop() {
    console.log("showTransPop")
}

export default defineContentScript({
    matches: ['<all_urls>'],
    cssInjectionMode: 'manual',
    async main(ctx) {
        // 存储原始的DOM树
        let domContent = ""
        //DOM树加载完成后,需要存起来该DOM树
        document.addEventListener('readystatechange', function () {
            if (document.readyState == 'complete') {
                domContent = document.body.innerHTML; // 获取整个页面的 HTML
                // console.log("Saving DOM content: ", domContent);
            }
        });

        // 页面加载完成, 根据翻译策略等进行翻译
        // -----------------翻译功能-------------------
        // 获取当前页面的域名
        let currentUrl = window.location.href;
        let domain = getDomainFromUrl(currentUrl);
        if (domain == null) {
            return
        }
        // 获取当前tab的id
        let tabId = await sendMessageToBackground({action: TB_ACTION.TAB_ID_GET})
        let tabKey = "tabTranslateStatus#" + tabId
        console.log("tabId: ", tabId)
        // 获取当前页面的规则, 添加不翻译的class
        let ruleStrategy = (await sendMessageToBackground({action: "searchRule", data: {domain: domain}}))?.[0]?.rules
        console.log("ruleStrategy: ", ruleStrategy)
        //遍历所有的规则，不用来翻译
        ruleStrategy?.forEach((value) => {
            let content = value.content
            let element = document.querySelector(content);
            if (element == null) {
                console.log("没有找到元素")
                return
            }
            // 添加一个class，标记为no-translate
            element.classList.add('no-translate');
        })

        // 获取当前页面的翻译策略
        let viewStrategy = await sendMessageToBackground({action: DB_ACTION.CONFIG_GET, data: {key: "viewStrategy"}})
        if (!viewStrategy) {
            // 默认策略为双语翻译
            viewStrategy = VIEW_STRATEGY.DOUBLE
        }
        let domainStrategy = (await sendMessageToBackground({
            action: DB_ACTION.DOMAIN_GET,
            data: {domain: domain}
        }))?.strategy;
        if (!domainStrategy) {
            // 默认策略为自动判断是否翻译
            domainStrategy = DOMAIN_STRATEGY.AUTO
        }
        console.log("domainStrategy: ", domainStrategy)
        // 获取当前tab页面的语言
        let tabLanguage = await sendMessageToBackground({action: TB_ACTION.TAB_LANG_GET})
        // 获取当前页面的目标语言
        let targetLanguage = await sendMessageToBackground({
            action: DB_ACTION.CONFIG_GET,
            data: {name: "targetLanguage"}
        })
        // 获取选择的翻译服务
        let translateService = await sendMessageToBackground({
            action: DB_ACTION.CONFIG_GET,
            data: {name: "translateService"}
        })
        let params = new translateParams(translateService, targetLanguage, undefined)
        // dom元素变化时需要判断是否是需要翻译的元素
        let observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        translateDOM(node, params)
                    });
                }
            });
        });

        let observerDouble = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        translateDoubleDOM(node, params)
                    });
                }
            });
        });
        // // 获取源语言
        // let sourceLanguage = await sendMessageToBackground({action: DB_ACTION.CONFIG_GET, data: {key: "sourceLanguage"}})
        let userLanguage = navigator.language;
        switch (domainStrategy) {
            case DOMAIN_STRATEGY.AUTO:
                // 目标语言为空，就设置成系统语言
                if (!targetLanguage) {
                    // 设置成系统语言
                    targetLanguage = userLanguage
                }
                // 如果当前页面的语言和目标语言一致 不翻译
                if (tabLanguage == targetLanguage) {
                    await sendMessageToBackground({
                        action: STORAGE_ACTION.SESSION_SET,
                        data: {key: tabKey, value: "translate"}
                    })
                    return
                }
                break
            case DOMAIN_STRATEGY.ALWAYS:
                break
            // case DOMAIN_STRATEGY.ASK:
            //     // 弹出一个对话框，询问是否翻译
            //     return
            // case DOMAIN_STRATEGY.NON_TARGET:
            //     break
            case DOMAIN_STRATEGY.NEVER:
                await sendMessageToBackground({
                    action: STORAGE_ACTION.SESSION_SET,
                    data: {key: tabKey, value: "translate"}
                })
                console.log("不翻译")
                return
        }

        // 设置按钮的翻译状态为显示原文
        await sendMessageToBackground({action: STORAGE_ACTION.SESSION_SET, data: {key: tabKey, value: "showOriginal"}})
        console.log("params: ", params)
        switch (viewStrategy) {
            case VIEW_STRATEGY.DOUBLE:
                translateDoubleDOM(document.body, params)
                observerDouble.observe(document.body, {childList: true, subtree: true});
                break
            case VIEW_STRATEGY.SINGLE:
                translateDOM(document.body, params)
                observer.observe(document.body, {childList: true, subtree: true});
                break
            case VIEW_STRATEGY.BUTTON:
                break
        }

        // 接受来自 popup 的消息,进行相应的翻译
        browser.runtime.onMessage.addListener((message) => {
            let params: translateParams
            switch (message.action) {
                case TRANS_ACTION.DOUBLE:
                    console.log("双语翻译")
                    params = new translateParams(message.data.translateService, message.data.targetLanguage, message.data.sourceLanguage)
                    console.log(params)
                    translateDoubleDOM(document.body, params)
                    observerDouble.observe(document.body, {childList: true, subtree: true});
                    break
                case TRANS_ACTION.SINGLE:
                    params = new translateParams(message.data.translateService, message.data.targetLanguage, message.data.sourceLanguage)
                    console.log("直接翻译")
                    console.log(params)
                    translateDOM(document.body, params)
                    // observer.observe(document.body, {childList: true, subtree: true});
                    break
                case TRANS_ACTION.TOGGLE:
                    console.log("切换按钮")
                    break
                case TRANS_ACTION.ORIGIN:
                    if (domContent != "") {
                        document.body.innerHTML = domContent
                        // 关闭动态翻译
                        observer.disconnect()
                        observerDouble.disconnect()
                    }
                    break
                case "toggleSelectionMode":
                    toggleSelectionMode()
                    break
                default:
                    break
            }
        });
        // translateDoubleDOM(document.body)
        // let d = await microsoftTranslationService.translateText(["hello","world"], "zh")
        // console.log(d)
        // 递归遍历DOM树，收集满足条件的节点
        function collectElements(element: HTMLElement, condition: (element: HTMLElement) => boolean, elements: HTMLElement[] = []): HTMLElement[] {
            elements = elements || []; // 初始化元素数组
            let nodeName = element.nodeName.toLowerCase();
            // class为no-translate的元素不翻译
            if (element.classList != null && element.classList.contains('no-translate')) {
                return elements;
            }
            if (nodeName === 'script' || nodeName === 'style' || nodeName === '#comment') {
                return elements;
            }
            // 检查当前元素是否满足条件
            if (condition(element)) {
                elements.push(element); // 满足条件则添加到数组中
                return elements;
            }
            // 遍历当前元素的所有子节点
            for (var i = 0; i < element.childNodes.length; i++) {
                var currentNode = element.childNodes[i];
                if (currentNode.nodeType === 1) { // 检查节点是否为元素节点
                    collectElements(currentNode as HTMLElement, condition, elements); // 递归搜索
                }
            }
            return elements;
        }

        /**
         * 从 URL 中提取域名
         * @param url
         */
        function getDomainFromUrl(url: string) {
            try {
                const parsedUrl = new URL(url);
                return parsedUrl.hostname; // 获取域名部分
            } catch (error) {
                console.error('Invalid URL:', error);
                return null; // 或处理错误，根据你的需要
            }
        }

        function isParagraphElement(element: HTMLElement): boolean {
            //如果子节点有文本节点，并且不为空，就认为是一个段落
            if (element.childNodes.length > 0) {
                for (let i = 0; i < element.childNodes.length; i++) {
                    if (element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i].textContent!.trim() !== "") {
                        return true
                    }
                }
            }
            return false
            // return element.nodeName.toLowerCase() === 'p'; // 检查是否为<p>元素
        }

        function removeChildrenElement(element) {
            //删除所有的非文本子节点，需要递归删除
            let children = element.childNodes;
            for (let i = 0; i < children.length; i++) {
                if (children[i].textContent.trim() === "") {
                    element.removeChild(children[i]);
                } else {
                    removeChildrenElement(children[i])
                }
            }
        }

        function customElementStyle(element, bgColor, fontColor, borderStyle, padding) {
            element.style.backgroundColor = bgColor
            element.style.color = fontColor
            element.style.padding = padding
            if (borderStyle == undefined) {
                borderStyle = 'noneStyleSelect'
            }
            switch (borderStyle) {
                case 'noneStyleSelect':
                    element.style.border = 'none';
                    break;
                case 'solidBorder':
                    element.style.border = '2px solid';
                    break;
                case 'dottedBorder':
                    element.style.border = '2px dotted';
                    break;
                case 'dashedBorder':
                    element.style.border = '2px dashed';
                    break;
                case "wavyLine":
                    element.style.textDecoration = "wavy underline";
                    break;
                case "doubleLine":
                    element.style.textDecoration = "underline double";
                    break;
                case "underLine":
                    element.style.textDecoration = "underline";
                    break;
                case "dottedLine":
                    element.style.textDecoration = "underline dotted";
                    break;
                case "dashedLine":
                    element.style.textDecoration = "underline dashed";
                    break;
            }
            if (borderStyle.endsWith("Line")) {
                element.style.textUnderlineOffset = `${padding}px`
            } else {
                element.style.padding = `${padding}px`
            }
        }

        function replaceDomContentForTranslate(element: HTMLElement): Map<string, string> {
            const tagMap = new Map<string, string>();
            let replaceHtmlTags = (element: HTMLElement, index = 10): number => {
                element.childNodes.forEach((node: HTMLElement) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        index = replaceHtmlTags(el, index);
                        // Replace start and end tags with custom placeholders
                        index++;
                        // const replacedOuterHtml = originalOuterHtml.replace(
                        //     new RegExp(`^<${el.tagName.toLowerCase()}[^>]*>`, 'i'),
                        //     openingTag
                        // ).replace(
                        //     new RegExp(`</${el.tagName.toLowerCase()}>$`, 'i'),
                        //     closingTag
                        // );
                        // 创建正则表达式匹配完整的开始和结束标签
                        const openingTagRegex = new RegExp(`^<${el.tagName.toLowerCase()}[^>]*>`, 'i');
                        const closingTagRegex = new RegExp(`</${el.tagName.toLowerCase()}>$`, 'i');

                        // 获取完整的标签字符串
                        const originalOuterHtml = el.outerHTML;
                        const openingTag = originalOuterHtml.match(openingTagRegex)?.[0] || '';
                        const closingTag = originalOuterHtml.match(closingTagRegex)?.[0] || '';

                        // 保存到Map中
                        const placeholderStart = `<b${index}>`;
                        const placeholderEnd = `</b${index}>`;
                        tagMap.set(placeholderStart, openingTag);
                        tagMap.set(placeholderEnd, closingTag);

                        // 替换outerHTML为占位符
                        const replacedOuterHtml = originalOuterHtml
                            .replace(openingTagRegex, placeholderStart)
                            .replace(closingTagRegex, placeholderEnd);
                        el.outerHTML = replacedOuterHtml;
                        // Recursively process children
                        // index = replaceHtmlTags(el, index + 1);
                    }
                });
                return index;
            }
            replaceHtmlTags(element)
            return tagMap
        }

        function hasAttributeIncludingParents(element: HTMLElement, attribute: string): boolean {
            // 当前元素有这个属性
            if (element.hasAttribute(attribute)) {
                return true;
            }

            // 向上递归检查父元素
            if (element.parentElement) {
                return hasAttributeIncludingParents(element.parentElement, attribute);
            }

            // 如果到达根元素还没有找到，返回 false
            return false;
        }
        async function translateDoubleDOM(tree, params: translateParams) {
            let treeElm = tree as HTMLElement
            if (!(treeElm instanceof HTMLElement)) {
                return;
            }
            if (hasAttributeIncludingParents(treeElm,"duo-no-observer")) {
                return
            }
            // 获取定义的样式
            let [bgColor, fontColor, borderStyle, padding] = await Promise.all([
                sendMessageToBackground({
                    action: DB_ACTION.CONFIG_GET,
                    data: {name: CONFIG_KEY.BG_COLOR}
                }),
                sendMessageToBackground({
                    action: DB_ACTION.CONFIG_GET,
                    data: {name: CONFIG_KEY.FONT_COLOR}
                }),
                sendMessageToBackground({
                    action: DB_ACTION.CONFIG_GET,
                    data: {name: CONFIG_KEY.STYLE}
                }),
                sendMessageToBackground({
                    action: DB_ACTION.CONFIG_GET,
                    data: {name: CONFIG_KEY.PADDING}
                })
            ]);
            // let bgColor = await sendMessageToBackground({
            //     action: DB_ACTION.CONFIG_GET,
            //     data: {name: CONFIG_KEY.BG_COLOR}
            // })
            // let fontColor = await sendMessageToBackground({
            //     action: DB_ACTION.CONFIG_GET,
            //     data: {name: CONFIG_KEY.FONT_COLOR}
            // })
            // let borderStyle = await sendMessageToBackground({
            //     action: DB_ACTION.CONFIG_GET,
            //     data: {name: CONFIG_KEY.STYLE}
            // })

            let needTranslateElement = []
            let elementTextContents: string[] = []
            let tagMaps : Map<string,string>[] = []
            let eles = collectElements(tree, isParagraphElement, [])
            if (!eles) {
                return
            }

            for (let element of eles) {

                //分段
                const sentences = split(element.innerHTML).filter((node) => node.type === 'Sentence');
                // ele.cloneNode(false)
                element.innerHTML = ""
                // const newDiv = document.createElement('span');
                for (let i = 0; i < sentences.length; i++) {
                    let sentence = sentences[i]
                    let span = document.createElement('span');
                    // span.style.display = "inline-block"
                    span.onmouseover = function () {
                        span.style.backgroundColor = "#ADD8E6"
                        //找到对应的翻译句子,修改背景颜色
                        let querySelectorAll = span.parentElement?.querySelectorAll("duo-translated span");
                        let translatedSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                        translatedSpan.style.backgroundColor = "#FFECCB"
                    }
                    span.onmouseleave = function () {
                        span.style.backgroundColor = ""
                        let querySelectorAll = span.parentElement?.querySelectorAll("duo-translated span");
                        let translatedSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                        translatedSpan.style.backgroundColor = ""
                    }
                    span.innerHTML = sentence.raw;
                    span.setAttribute("duo-no-observer", "true")
                    span.setAttribute("duo-sequence", i.toString())
                    // span.setAttribute("data-sentence", i.toString())
                    // ele.appendChild(span)
                    element.appendChild(span)
                }
                // element.innerHTML = newDiv.innerHTML
                element.setAttribute("no-observer", "true")
                let cloneNode = element.cloneNode(true) as HTMLElement;
                let map = replaceDomContentForTranslate(cloneNode);
                tagMaps.push(map)
                // 当前文本的长度超过40个字符，就添加一个换行符
                if (element.textContent!.length > 40) {
                    element.appendChild(document.createElement('br'));
                } else {
                    //添加一个空格
                    element.appendChild(document.createTextNode(' '));
                }
                let duoElement = document.createElement('duo-translated')
                duoElement.setAttribute("duo-no-observer", "true")
                // 添加到eles[i]元素的后面
                element.appendChild(duoElement)
                needTranslateElement.push(duoElement)
                elementTextContents.push(cloneNode.innerHTML)
            }
            console.log(elementTextContents)
            console.log(needTranslateElement)
            params.serviceName = "microsoft"
            // for (let i = 0; i < needTranslateElement.length; i++) {
            //             needTranslateElement[i].innerHTML = '<a>aaa</a>'
            //         }
            translationServices.get(params.serviceName)?.translateText(elementTextContents, params.targetLang, params.sourceLang).then((res) => {
                console.log(res)
                for (let i = 0; i < needTranslateElement.length; i++) {
                    let htmlText = res[i][0]
                    console.log(htmlText,"htmlText")
                    let map = tagMaps[i]
                    map.forEach((value, key) => {
                        htmlText = htmlText.replace(key, value)
                    })
                    needTranslateElement[i].innerHTML = htmlText
                    const spanElements = needTranslateElement[i].querySelectorAll('span');

                    spanElements.forEach(span => {
                        span.addEventListener('mouseover', () => {
                            span.style.backgroundColor = '#FFECCB';
                            let querySelectorAll = span.parentElement?.parentElement?.querySelectorAll("span");
                            let translatedSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                            translatedSpan.style.backgroundColor = "#ADD8E6"
                            // 在这里添加你想在鼠标悬浮时执行的其他操作
                        });
                        span.addEventListener('mouseleave', () => {
                            span.style.backgroundColor = '';
                            let querySelectorAll = span.parentElement?.parentElement?.querySelectorAll("span");
                            let translatedSpan = querySelectorAll![parseInt(span.getAttribute("duo-sequence")!)] as HTMLElement;
                            translatedSpan.style.backgroundColor = ""
                            // 在这里添加你想在鼠标悬浮时执行的其他操作
                        });
                    });
                }
            })

            // let textNodes = []
            // for (let i = 0; i < needTranslates.length; i++) {
            //     collectTextNodes(needTranslates[i], textNodes)
            // }


            // let clone = element.cloneNode(true) as HTMLElement;
            // // let textWidth = clone.offsetWidth; // 获取元素内文本的长度
            // // clone.style.width = textWidth + 'px'; // 设置元素的宽度
            // //设置为行内元素
            // // clone.style.display = 'inline';
            // clone.removeAttribute("id")
            // // clone.removeAttribute("class")
            // //删除所有的非文本子节点，需要递归删除
            // removeChildrenElement(clone)
            // let fontElement = document.createElement('font');
            // fontElement.classList.add("doubleTransStyle")
            // // fontElement.classList.add("wavy-underline")
            // // 将 clone 的内容复制到新的 font 元素中
            // fontElement.innerHTML = clone.innerHTML;
            // customElementStyle(fontElement, bgColor, fontColor, borderStyle, padding)
            // // 当前文本的长度超过40个字符，就添加一个换行符
            // if (element.textContent!.length > 40) {
            //     element.appendChild(document.createElement('br'));
            // } else {
            //     //添加一个空格
            //     element.appendChild(document.createTextNode(' '));
            // }
            // // 添加到eles[i]元素的后面
            // element.appendChild(fontElement)
            // // eles[i].parentNode.insertBefore(clone, eles[i].nextSibling);
            // needTranslates.push(fontElement)
        }

        // for (const element of eles) {
        //     //开启标记阅读模式
        //     //分割文本为句子
        //     //获取element innerHtml
        //     console.log(element)
        //     const sentences = split(element.innerHTML).filter((node) => node.type === 'Sentence');
        //     // console.log(sentences.map(sentence => sentence.raw));
        //     //遍历所有的句子
        //     if (sentences.length === 1) {
        //         //只有一个句子，不需要标记
        //         continue
        //     }
        //     for (let i = 0; i < sentences.length; i++) {
        //         let sentence = sentences[i]
        //         // let span = document.createElement('span');
        //         // span.textContent = sentence.raw;
        //         console.log(sentence.raw)
        //     }
        //     //复制当前元素
        //     let clone = element.cloneNode(true) as HTMLElement;
        //     // let textWidth = clone.offsetWidth; // 获取元素内文本的长度
        //     // clone.style.width = textWidth + 'px'; // 设置元素的宽度
        //     //设置为行内元素
        //     // clone.style.display = 'inline';
        //     clone.removeAttribute("id")
        //     // clone.removeAttribute("class")
        //     //删除所有的非文本子节点，需要递归删除
        //     removeChildrenElement(clone)
        //     let fontElement = document.createElement('font');
        //     fontElement.classList.add("doubleTransStyle")
        //     // fontElement.classList.add("wavy-underline")
        //     // 将 clone 的内容复制到新的 font 元素中
        //     fontElement.innerHTML = clone.innerHTML;
        //     customElementStyle(fontElement, bgColor, fontColor, borderStyle, padding)
        //     // 当前文本的长度超过40个字符，就添加一个换行符
        //     if (element.textContent!.length > 40) {
        //         element.appendChild(document.createElement('br'));
        //     } else {
        //         //添加一个空格
        //         element.appendChild(document.createTextNode(' '));
        //     }
        //     // 添加到eles[i]元素的后面
        //     element.appendChild(fontElement)
        //     // eles[i].parentNode.insertBefore(clone, eles[i].nextSibling);
        //     needTranslates.push(fontElement)
        // }
        // let textNodes = []
        // for (let i = 0; i < needTranslates.length; i++) {
        //     collectTextNodes(needTranslates[i], textNodes)
        // }
        // // console.log(textNodes)
        // //翻译文本
        // splitElements(textNodes, 10).forEach((ele, index) => {
        //     let texts = []
        //     for (let eleElement of ele) {
        //         // console.log(eleElement)
        //         texts.push(eleElement.textContent.trim())
        //     }
        //     // console.log(translationServices.get(params.serviceName))
        //     translationServices.get(params.serviceName)?.translateText(texts, params.targetLang, params.sourceLang).then((res) => {
        //         for (let i = 0; i < ele.length; i++) {
        //             // console.log()
        //             ele[i].textContent = res[i]
        //         }
        //     })
        // })

        function translateTextTest(texts
                                       :
                                       string[], zh
                                       :
                                       string
        ) {
            let data = []
            for (let i = 0; i < texts.length; i++) {
                data.push({translatedText: "翻译"})
            }
            return new Promise((resolve) => {
                resolve(data)
            })
        }

//设置边框的样式
// 在 TypeScript 中设置变量值
        const root = document.documentElement; // 或者另一个特定的容器元素
// root.style.setProperty('--color', 'red');
// root.style.setProperty('--border-width', '1');
// root.style.setProperty('--border-color', 'red');
// root.style.setProperty('--border-style', 'dashed');
// root.style.setProperty('--bg-color', 'blue');


        function collectTextNodes(element, textNodes) {
            // textNodes = textNodes || []; // 初始化文本节点数组
            for (var j = 0; j < element.childNodes.length; j++) {
                var currentNode = element.childNodes[j];
                // console.log(currentNode)
                if (currentNode.nodeType === 3) { // 检查节点是否为文本节点
                    textNodes.push(currentNode); // 是文本节点则添加到数组中
                } else if (currentNode.nodeType === 1) { // 检查节点是否为元素节点
                    collectTextNodes(currentNode, textNodes); // 递归搜索
                }

            }
            // // 遍历当前元素的所有子节点
            // return textNodes;
        }

// 使用示例：
// var textNodes = collectTextNodes(document.body); // 从<body>标签开始收集所有文本节点
// console.log(textNodes); // 打印所有文本节点
// //遍历所有的文本节点
// textNodes.forEach((node) => {
//     // 找到最近的块级父元素
//     let parent = node.parentNode;
//     if (window.getComputedStyle(parent).display == 'block') {
//         //单独的一个段落
//     }
//
// })


// const systemLanguage = navigator.language;
// const siteLanguage = await getSiteLang();
// console.log("系统语言", systemLanguage)
// console.log("网站语言", siteLanguage)
// translateDOM(document.body)

// observer.observe(document.body, {childList: true, subtree: true});

// // 采集页面文本
// let sampleText = document.documentElement.textContent.slice(0, 2000);
// console.log(sampleText)
// // 使用 franc 检测语言
// let detectedLanguage = franc(sampleText);
// console.log("通过 franc 检测到的语言:", detectedLanguage);
// const text = "这是一段测试文本，用于检测语言。";
// console.log(franc(text));
        /**
         * 获取当前网站的语言
         */
        function getSiteLang() {
            return browser.runtime.sendMessage({action: "getTabLanguage"})
        }

// -----右下角添加一个菜单，用于选择翻译插件的配置------
        const body = document.body;
        console.log("添加按钮")
// 创建按钮和菜单
        const button = document.createElement('div');
        button.id = 'myExtensionButton';
        button.textContent = '+';
        const menu = document.createElement('div');
        menu.id = 'myExtensionMenu';
        menu.innerHTML = '<div class="menu-item" id="addRule">add rule</div><div class="menu-item">Action 2</div><div class="menu-item">Action 3</div>';
        body.appendChild(button);
        body.appendChild(menu);

// 按钮点击事件，切换菜单显示
        button.addEventListener('click', function () {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });

// 鼠标移动事件，自动隐藏按钮
        let timeout;
        body.addEventListener('mousemove', function () {
            button.style.opacity = '1';
            clearTimeout(timeout);
            timeout = setTimeout(function () {
                button.style.opacity = '0';
            }, 2000); // 2秒无操作后自动隐藏
        });
// --------节点选择器---------
        let selectionModeActive = false;
        const selectorButton = document.getElementById("addRule");
        selectorButton?.addEventListener('click', function (event) {
            console.log(event)
            // 阻止事件冒泡
            event.stopPropagation();
            toggleSelectionMode();
        });
        let allAddBorderElement = []

        async function toggleSelectionMode() {
            if (!selectionModeActive) {
                // 启动选择模式
                selectionModeActive = true;
                document.body.style.cursor = "crosshair"; // 改变光标样式
                // 已经添加的元素反显出来
                let resp = await sendMessageToBackground({action: DB_ACTION.RULES_SEARCH, data: {domain: domain}})
                console.log(resp)
                if (resp.length === 0) {
                    console.log("没有找到规则")
                    // return
                } else {
                    resp[0].rules.forEach((rule: SubRule) => {
                        let content = rule.content
                        console.log(rule)
                        let element = document.querySelector(content);
                        if (element == null) {
                            console.log("没有找到元素")
                            return
                        }
                        // 元素添加一个绿色的边框
                        element.style.border = "2px solid green";
                        allAddBorderElement.push(element)
                        element.classList.add("hasSelected")
                    })
                }
                addEventListeners();
            } else {
                // 取消选择模式
                deactivateSelectionMode();
            }
        }

        function addEventListeners() {
            document.addEventListener('mouseover', highlightElement);
            document.addEventListener('mouseout', unhighlightElement);
            document.addEventListener('click', selectElement, true); // 使用捕获阶段以优先处理
            document.addEventListener('contextmenu', cancelSelectionMode);
        }

        function highlightElement(event) {
            if (event.target.classList.contains("hasSelected")) {
                // event.target.style.background = 'yellow'
                // event.classList.add("yellowBorder")
                event.target.style.border = "2px solid yellow";
                return
            }
            // 如果是hasSelected元素的子元素，不做处理
            let has = document.getElementsByClassName("hasSelected")
            for (let i = 0; i < has.length; i++) {
                if (has[i].contains(event.target)) {
                    // has[i].classList.add("yellowBorder")
                    has[i].style.border = "2px solid yellow";
                    // has[i].classList.add("yellowBorder")
                    return
                }
            }
            if (event.target !== selectorButton) {
                event.target.style.border = "2px solid red";
            }
        }

        function unhighlightElement(event) {
            if (event.target.classList.contains("hasSelected")) {
                // event.target.style.background = 'yellow'
                event.target.style.border = "2px solid green";
                return
            }
            // 如果是hasSelected元素的子元素，不做处理
            let has = document.getElementsByClassName("hasSelected")
            for (let i = 0; i < has.length; i++) {
                if (has[i].contains(event.target)) {
                    has[i].style.border = "2px solid green";
                    return
                }
            }
            if (event.target !== selectorButton) {
                event.target.style.border = "";
            }
        }

        async function selectElement(event) {
            event.preventDefault();
            // 黄色的元素点击之后，先从数据库删除规则，然后取消边框设置
            if (event.target.classList.contains("hasSelected")) {
                let content = generateSelector(event.target)
                console.log(content)
                try {
                    await sendMessageToBackground({
                        action: DB_ACTION.RULES_DEL,
                        data: {domain: domain, ruleContent: content}
                    })
                } catch (e) {
                    console.log("DB_ACTION.RULES_DEL error", e)
                }
                event.target.style.border = "";
                event.target.classList.remove("hasSelected")
                return
            }
            let has = document.getElementsByClassName("hasSelected")
            for (let i = 0; i < has.length; i++) {
                if (has[i].contains(event.target)) {
                    let content = generateSelector(has[i])
                    console.log(content)

                    try {
                        await sendMessageToBackground({
                            action: DB_ACTION.RULES_DEL,
                            data: {domain: domain, ruleContent: content}
                        })
                    } catch (e) {
                        console.log("DB_ACTION.RULES_DEL error", e)
                    }
                    has[i].style.border = "";
                    has[i].classList.remove("hasSelected")
                    return
                }
            }
            if (event.target !== selectorButton) {
                const selector = generateSelector(event.target);
                // 添加规则到数据库中，然后添加一个绿色的边框
                try {
                    let resp = await sendMessageToBackground({
                        action: DB_ACTION.RULES_ADD,
                        data: {domain: domain, subRule: new SubRule("", selector)}
                    })
                    // 设置元素的边框为绿色，并且添加一个class，标记为hasSelected
                    event.target.style.border = "2px solid green";
                    event.target.classList.add("hasSelected")
                    allAddBorderElement.push(event.target)
                } catch (e) {
                    console.log("DB_ACTION.RULES_ADD error", e)
                }

                // navigator.clipboard.writeText(selector).then(() => {
                //     alert(`CSS Selector copied to clipboard: ${selector}`);
                // });
                // deactivateSelectionMode(event); // 选择后退出选择模式
            }
        }

        function cancelSelectionMode(event) {
            event.preventDefault();
            deactivateSelectionMode(event);
        }

        function deactivateSelectionMode(event) {
            event.target.style.border = ""
            allAddBorderElement.forEach(ele => ele.style.border = "")
            // let yellowBorder = document.getElementsByClassName("yellowBorder")
            // for (let i = 0; i < yellowBorder.length; i++) {
            //     yellowBorder[i].classList.remove("yellowBorder")
            // }
            // let greenBorder = document.getElementsByClassName("greenBorder")
            // for (let i = 0; i < greenBorder.length; i++) {
            //     greenBorder[i].classList.remove("greenBorder")
            // }
            // if (event.target !== selectorButton) {
            //     event.target.style.border = "";
            // }
            selectionModeActive = false;
            document.body.style.cursor = ""; // 恢复光标样式
            document.removeEventListener('mouseover', highlightElement);
            document.removeEventListener('mouseout', unhighlightElement);
            document.removeEventListener('click', selectElement, true);
            document.removeEventListener('contextmenu', cancelSelectionMode);
        }

        function generateSelector(element) {
            let path = [], current = element;
            while (current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
                const tagName = current.tagName.toLowerCase();
                const id = current.id ? `#${current.id}` : '';
                let className = current.className ? `.${current.className.trim().replace(/\s+/g, '.')}` : '';
                if (className.includes("hasSelected")) {
                    className = className.replaceAll(".hasSelected", "")
                }
                if (className.includes("no-translate")) {
                    className = className.replaceAll(".no-translate", "")
                }
                path.unshift(`${tagName}${id}${className}`);
                // path.unshift(`${tagName}${id}${className}`);
                current = current.parentNode;
            }
            return path.join(" > ");
        }


        /**
         *  递归遍历 DOM 树
         */
        function traverseDOM(element, callback) {
            // 调用回调函数处理当前元素
            if (element.classList != null && element.classList.contains('no-translate')) {
                return
            }
            callback(element);

            // 获取当前元素的所有子元素
            let children = element.childNodes;

            // 遍历所有子元素并递归调用该函数
            for (let i = 0; i < children.length; i++) {
                // 元素不能是脚本、样式、注释等
                // 跳过脚本、样式、注释等元素
                const nodeName = element.nodeName.toLowerCase();
                if (nodeName === 'script' || nodeName === 'style' || nodeName === '#comment') {
                    return;
                }
                traverseDOM(children[i], callback);
            }
        }

        /**
         * 从根节点开始遍历 DOM 树，找到所有需要翻译的文本节点，并翻译
         */
        function translateDOM(rootNode, params: translateParams) {
            let needTranslate = []
            traverseDOM(rootNode, (element) => {
                // 如果是文本节点，并且文本内容不为空，就将其添加到数组中
                if (element.nodeType === Node.TEXT_NODE && element.nodeValue != null && element.nodeValue.trim() !== '') {
                    // 判断文本内容是否为特殊字符，如换行符、制表，数字，标点符号等
                    if (!/^\s*[\r\n\t\s]*\d*[\.,:;\/\\\-_\[\]\(\)\{\}!@#$%^&*+=|<>?"'`~]*\s*$/g.test(element.nodeValue)) {
                        needTranslate.push(element);
                    }
                }
            });
            // 将需要翻译的文本分组，每组最多 10 个元素
            splitElements(needTranslate, 50).forEach((ele, index) => {
                    let texts = []
                    for (let eleElement of ele) {
                        texts.push(eleElement.textContent.trim())
                    }
                    // get the translateService and translate the text
                    translationServices.get(params.serviceName)?.translateText(texts, params.targetLang, params.sourceLang).then((res) => {
                        for (let i = 0; i < ele.length; i++) {
                            ele[i].textContent = res[i]
                        }
                    })
                    // translateText(texts, systemLanguage).then((res) => {
                    //     for (let i = 0; i < ele.length; i++) {
                    //         // ele[i].textContent = res[i].translatedText
                    //         //当前元素添加一个font子元素，用于显示译文
                    //         let font = document.createElement('font');
                    //         font.textContent = res[i].translatedText;
                    //         console.log(font)
                    //         //添加到font到ele中
                    //         // 如果当前元素的父元素是行内元素，并且存在兄弟节点是文本节点，就复制该元素，并设置textContent为译文,然后添加到上层元素
                    //
                    //         let parent = ele[i].parentNode
                    //         while (parent.nextSibling != null && parent.nextSibling.nodeType !== Node.TEXT_NODE) {
                    //             parent = parent.parentNode
                    //         }
                    //
                    //         ele[i].parentNode.appendChild(font);
                    //     }
                    // })
                }
            )

        }

        /**
         * 谷歌翻译 API
         * @param texts
         * @param targetLanguage
         */
        async function translateText(texts: [], targetLanguage: string) {
            const apiKey = 'AIzaSyC_zDStMeRgutILdJuL_4xyQpEwawBrKw4';  // 替换为你的 API 密钥
            const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    q: texts,
                    target: targetLanguage
                })
            });

            const data = await response.json();
            return data.data.translations;
        }

        /**
         * 将数组拆分为指定大小的多个数组
         * @param elements
         * @param size
         */
        function splitElements<T>(elements: T[], size: number): T[][] {
            const result: T[][] = [];
            for (let i = 0; i < elements.length; i += size) {
                result.push(elements.slice(i, i + size));
            }
            return result;
        }


    }
})
;
