import PouchDB from 'pouchdb';
import {
    STATUS_FAIL,
    STATUS_SUCCESS,
    DOMAIN_STRATEGY,
    TRANS_ACTION,
    TRANS_SERVICE, CONFIG_KEY,
    TRANSLATE_STATUS_KEY,
    TB_ACTION,
    DB_ACTION,
    STORAGE_ACTION,
    ACTION,
    VIEW_STRATEGY,
    PORT_NAME,
    APP_NAME_WITH_SUFFIX,
    AI_TASK,
} from "@/main/constants";
import { Browser, browser } from "wxt/browser";
import { Token } from "@/main/translateService";
import { Mutex } from "async-mutex";
import enLocale from "@/assets/locales/en.json";
import zhCNLocale from "@/assets/locales/zh-CN.json";
import type { InterfaceLang } from "@/main/constants";
import {
    AiStreamRequest,
    AiStreamMessage,
    buildPrompt,
    chatStream,
    chatComplete,
    normalizeProvider,
    AiProvider,
} from "@/main/aiService";
import { getDomainWithPortFromUrl } from '@/utils/url';

// In-extension locale tables for strings the background needs to render itself
// (currently the context menu title). Chrome's chrome.i18n.getMessage is locked
// to the browser UI language at install time, so for a user-overridable UI
// language we have to do the lookup ourselves.
const LOCALES: Record<InterfaceLang, Record<string, string>> = {
    en: enLocale as Record<string, string>,
    'zh-CN': zhCNLocale as Record<string, string>,
};

export function background() {
    console.log("background loaded")
    const mutex = new Mutex();
    initTokenMap()
    let db = new PouchDB('userdb');
    let paraContextMenuShowStatus = false
    let isTranslateParaShowing = false

    const ruleStorage = RuleStorage.getInstance(db)
    const domainStorage = DomainStorage.getInstance(db)
    const configStorage = ConfigStorage.getInstance(db)

    let currentInterfaceLang: InterfaceLang = detectDefaultInterfaceLang()
    const getMsg = (key: string) => LOCALES[currentInterfaceLang][key] ?? key
    configStorage.getConfigItem(CONFIG_KEY.INTERFACE_LANG).then((value) => {
        const lang = normalizeInterfaceLang(value)
        if (lang) currentInterfaceLang = lang
    })

    // One-shot migration: legacy AI_WRITING_DISABLED_DOMAINS (string[]) →
    // DomainStorage docs with aiWritingDisabled=true. The config slot is wiped after
    // migration so subsequent runs no-op.
    void (async () => {
        const legacy = await configStorage.getConfigItem(CONFIG_KEY.AI_WRITING_DISABLED_DOMAINS);
        if (!Array.isArray(legacy) || legacy.length === 0) return;
        for (const d of legacy) {
            if (typeof d !== 'string' || !d) continue;
            await domainStorage.update(new Domain(d, undefined, undefined, true));
        }
        await configStorage.setConfigItem(CONFIG_KEY.AI_WRITING_DISABLED_DOMAINS, []);
    })()


    browser.runtime.onMessage.addListener((message, sender, sendResponse: (t: any) => void) => {
        // messages are received to manipulate the db database
        function errorResponse(e: any) {
            if (e?.name === 'not_found') {
                sendResponse({ status: STATUS_SUCCESS, data: undefined })
            } else {
                sendResponse({ status: STATUS_FAIL, data: { name: e.name, message: e.message, recieved: message } })
            }
        }
        console.log('background onMessage', message)
        switch (message.action) {
            case ACTION.ACCESS_TOKEN_GET:
                // console.log("getAccessToken", serviceTokenMap.get("microsoft"))
                let service: string = message.data.service
                if (serviceTokenMap && serviceTokenMap.get(service) && (serviceTokenMap.get(service)?.expireTime || 0) > Date.now()) {
                    sendResponse({ status: STATUS_SUCCESS, data: serviceTokenMap.get(service) })
                    return
                }
                // todo support other service
                getMicrosoftToken().then((token) => {
                    sendResponse({ status: STATUS_SUCCESS, data: token })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: new Token("", 0) })
                })
                return true
            case ACTION.TRANSLATE_HTML:
                // todo
                break
            case DB_ACTION.RULES_ADD:
                ruleStorage.add(message.data.domain, message.data.data).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "add success" });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_DEL:
                try {
                    ruleStorage.delete(message.data.domain, message.data.data).then(() => {
                        sendResponse({ status: STATUS_SUCCESS, data: "delete success" });
                    })
                } catch (e) {
                    sendResponse({ status: STATUS_FAIL, data: "delete fail" });
                }
                return true
            case DB_ACTION.RULES_LIST:
                console.debug("list rule from domain", message.data.domain)
                ruleStorage.list(message.data.domain).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data: data });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_GET_ALL:
                ruleStorage.getAll().then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_SEARCH:
                ruleStorage.search(message.data.domain).then(value => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case DB_ACTION.DOMAIN_GET:
                domainStorage.get(message.data.domain).then(data => {
                    sendResponse({ status: STATUS_SUCCESS, data: data })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.DOMAIN_UPDATE:
                domainStorage.update(message.data).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                return true
            case DB_ACTION.DOMAIN_DELETE: {
                const fieldArg = message.data?.field as ('strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy' | undefined);
                const op = fieldArg
                    ? domainStorage.clearField(message.data.domain, fieldArg)
                    : domainStorage.delete(message.data.domain);
                op.then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "delete success" });
                }).catch((e) => {
                    errorResponse(e)
                });
                return true
            }
            case DB_ACTION.DOMAIN_LIST: {
                const filter = {
                    strategy: message.data?.strategy,
                    aiWritingDisabled: message.data?.aiWritingDisabled,
                    aiWritingEnabled: message.data?.aiWritingEnabled,
                };
                domainStorage.list(filter).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data })
                }).catch((e) => {
                    errorResponse(e)
                });
                return true
            }
            // get the configuration
            case DB_ACTION.CONFIG_GET:
                console.log('getConfig', message.data)
                configStorage.getConfigItem(message.data.name).then((value) => {
                    // console.log(value)
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.CONFIG_SET:
                configStorage.setConfigItem(message.data.name, message.data.value).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                return true
            // get the language of the tab
            case TB_ACTION.LANG_GET:
                // try get tabId from message data and sender tab
                let tabId = sender.tab?.id || message.data.id
                if (!tabId) {
                    sendResponse({ status: STATUS_FAIL, data: "tabId is null" });
                    return
                }
                let url = sender.tab?.url || message.data.url
                if (!url.startsWith('http')) {
                    sendResponse({ status: STATUS_FAIL, data: "url is not http or https" });
                    return
                }
                browser.tabs.detectLanguage((lang: string) => {
                    sendResponse({ status: STATUS_SUCCESS, data: lang });
                })
                return true;
            // get browser native language
            case TB_ACTION.NATIVE_LANGUAGE_GET:
                // let lang = browser.i18n.getUILanguage()
                sendResponse({ status: STATUS_SUCCESS, data: navigator.language.split('-')[0] });
                break
            case TB_ACTION.TAB_DOMAIN_GET:
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    if (tabs.length === 0) {
                        sendResponse({ status: STATUS_FAIL, data: "tabs is null" });
                        return
                    }
                    let urlString = tabs?.[0]?.url
                    if (!urlString) {
                        sendResponse({ status: STATUS_FAIL, data: "url is null" });
                        return
                    }
                    const domain = getDomainWithPortFromUrl(urlString)
                    sendResponse({ status: STATUS_SUCCESS, data: domain })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case TB_ACTION.ID_GET:
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    let tab = tabs[0].id
                    sendResponse({ status: STATUS_SUCCESS, data: tab })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case STORAGE_ACTION.SESSION_SET:
                let key = message.data.key
                if (!key || key.endsWith("null") || key.endsWith("undefined") || message.data.value == undefined || message.data.value === "" || message.data.value === "null" || message.data.value === "undefined") {
                    console.log('value is null or empty', key, message.data.value)
                    sendResponse({ status: STATUS_FAIL, data: "value is null or empty" });
                    return
                }
                console.log('set session storage', key, message.data.value)
                browser.storage.session.set({ [key]: message.data.value }).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case STORAGE_ACTION.SESSION_GET:
                browser.storage.session.get(message.data.key).then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value[message.data.key] });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case TB_ACTION.CONTEXT_MENU_SHOW:
                console.log('showContextMenu', message.data)
                // updateContextMenu(message.data as number)
                break
            case TB_ACTION.CONTEXT_MENU_SWITCH:
                console.log('contextMenuSwitch', message.data)
                let contextMenuSwitch = message.data.contextMenuSwitch
                if (contextMenuSwitch) {
                    browser.contextMenus.create({
                        id: CONTEXT_MENU.TRANSLATE_RESTORE_PAGE,
                        title: getMsg('contextMenuTranslate'),
                        contexts: ["page"]
                    });
                } else {
                    browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE)
                }
                break
            case ACTION.INTERFACE_LANG_CHANGE: {
                const lang = normalizeInterfaceLang(message.data)
                if (lang) {
                    currentInterfaceLang = lang
                    // Refresh the context menu title if it exists. update()
                    // silently fails (logs lastError) when the item is absent.
                    const title = translateStatus
                        ? getMsg('contextMenuOriginal')
                        : getMsg('contextMenuTranslate')
                    try {
                        browser.contextMenus.update('translate', { title })
                    } catch { }
                }
                sendResponse({ status: STATUS_SUCCESS, data: null })
                break
            }
            case TRANS_ACTION.TRANSLATE_STATUS_CHANGE:
                console.log('translateStatusChange', message.data)
                if (typeof message.data.status === 'boolean') {
                    updateContextMenu(message.data.status)
                }
                break
            case ACTION.OPEN_OPTIONS_PAGE:
                browser.tabs.create({ url: 'options.html' }).then(
                    () => sendResponse({ status: STATUS_SUCCESS, data: null }),
                    (e: any) => sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } }),
                )
                return true
            case ACTION.AI_PROVIDER_TEST: {
                const provider = normalizeProvider(message.data);
                (async () => {
                    try {
                        const gen = chatStream(
                            provider,
                            [
                                { role: "system", content: "Reply with exactly: ok" },
                                { role: "user", content: "ping" },
                            ],
                            { maxTokens: 16 },
                        );
                        let collected = "";
                        for await (const delta of gen) {
                            collected += delta;
                            if (collected.length > 32) break;
                        }
                        sendResponse({ status: STATUS_SUCCESS, data: { reply: collected.trim() } });
                    } catch (e: any) {
                        sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } });
                    }
                })();
                return true;
            }
            case ACTION.GLOBAL_SWITCH_CHANGE:
                console.log('globalSwitchChange', message.data)
                let globalSwitch = message.data
                if (typeof globalSwitch === 'boolean') {
                    if (globalSwitch) {
                        initContextMenu()
                        initShortcutKey()
                    } else {
                        removeContextMenu()
                        removeShortcutKey()
                    }
                }
                break
            case ACTION.SHOW_TRANSLATE_RESTORE_PARA_MENU:
                let translatedStatus = message.data.translated as boolean
                isTranslateParaShowing = !translatedStatus
                let msg = translatedStatus ? "Restore this paragraph" : "Translate this paragraph"
                if (paraContextMenuShowStatus) {
                    browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PARA, { title: msg })
                    return
                }
                browser.contextMenus.create({
                    id: CONTEXT_MENU.TRANSLATE_RESTORE_PARA,
                    title: msg,
                    contexts: ["page", "link"] //"selection"
                });
                paraContextMenuShowStatus = true;
                sendResponse({ status: STATUS_SUCCESS });
                break
            case ACTION.HIDE_TRANSLATE_RESTORE_PARA_MENU:
                if (!paraContextMenuShowStatus) return
                browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PARA)
                paraContextMenuShowStatus = false
                isTranslateParaShowing = false
                sendResponse({ status: STATUS_SUCCESS });
                break
            default:
                break
        }
        return
    });

    let translateStatus = false
    // add context menu to translate page
    configStorage.getConfigItem(CONFIG_KEY.CONTEXT_MENU_SWITCH).then((value) => {
        console.log("contextMenuSwitch", value);
        let contextMenuSwitch = value === undefined ? true : value
        // judge global switch
        configStorage.getConfigItem(CONFIG_KEY.GLOBAL_SWITCH).then((globalSwitch) => {
            globalSwitch = globalSwitch === undefined ? true : globalSwitch
            if (contextMenuSwitch && globalSwitch) {
                console.log('initContextMenu')
                initContextMenu()
            }
            if (globalSwitch) {
                initShortcutKey()
            }
        })
    })

    let contextMenuClickLister = (info: Browser.contextMenus.OnClickData, tab: Browser.tabs.Tab | undefined): void => {
        console.log('contextMenus.onClicked', info, tab, translateStatus)
        if (!tab || !tab.id) {
            return
        }
        switch (info.menuItemId) {
            case CONTEXT_MENU.TRANSLATE_RESTORE_PAGE:
                if (!translateStatus) {
                    browser.tabs.sendMessage(tab.id, { action: TRANS_ACTION.TRANSLATE });
                } else {
                    browser.tabs.sendMessage(tab.id, { action: TRANS_ACTION.SHOW_ORIGINAL });
                }
                break
            case CONTEXT_MENU.TRANSLATE_TEXT_BOX:
                browser.tabs.sendMessage(tab.id, { action: TRANS_ACTION.TRANSLATE_TEXT_BOX });
                break
            case CONTEXT_MENU.TRANSLATE_RESTORE_PARA:
                console.log('translatePara', info, tab)
                let act = isTranslateParaShowing ? TRANS_ACTION.TRANSLATE_PARA : TRANS_ACTION.SHOW_ORIGINAL_PARA
                browser.tabs.sendMessage(tab.id, { action: act });
                break
        }


    }

    function initContextMenu() {
        let t: string = 'contextMenuTranslate'
        if (translateStatus) {
            t = 'contextMenuOriginal'
        }
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_RESTORE_PAGE,
            title: getMsg(t),
            contexts: ["page"] //"selection"
        });

        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_TEXT_BOX,
            title: "Translate text box to English",
            contexts: ["editable"]
        });

        browser.contextMenus.onClicked.addListener(contextMenuClickLister)
        // Listen for tab activation events
        browser.tabs.onActivated.addListener(async (activeInfo) => {
            // only process http or https url
            let tab = await browser.tabs.get(activeInfo.tabId)
            if (!tab?.url?.startsWith('http')) {
                return
            }
            console.log('tabs.onActivated', activeInfo)
            // get current tab translate status
            let tabTranslateStatusKey = TRANSLATE_STATUS_KEY + activeInfo.tabId
            browser.storage.session.get(tabTranslateStatusKey).then((value) => {
                translateStatus = value[tabTranslateStatusKey] as boolean
                if (translateStatus) {
                    browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                        title: getMsg('contextMenuOriginal'),
                    })
                } else {
                    browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                        title: getMsg('contextMenuTranslate'),
                    })
                }
            })
        });
    }

    function removeContextMenu() {
        browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE)
        browser.contextMenus.onClicked.removeListener(() => { })
        browser.tabs.onActivated.removeListener(() => { })
    }

    let shortcutKeyListener = (command: string) => {
        let action = ""
        if (command === 'shortcut-toggle') {
            // send message to current tab, toggle translate status
            action = TRANS_ACTION.TOGGLE
        } else if (command === 'shortcut-translate') {
            // send message to current tab, toggle translate status
            action = TRANS_ACTION.TRANSLATE
        } else if (command === 'shortcut-restore') {
            // send message to current tab, restore page
            action = TRANS_ACTION.SHOW_ORIGINAL
        } else if (command === 'shortcut-ai-workbench') {
            action = ACTION.AI_OPEN_WORKBENCH
        }
        if (!action) return
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            let tab = tabs[0]
            if (!tab || !tab.id) {
                return
            }
            browser.tabs.sendMessage(tab.id, { action: action });
        });
    }

    function initShortcutKey() {
        // process shortcut key command
        browser.commands.onCommand.addListener(shortcutKeyListener);
    }

    function removeShortcutKey() {
        browser.commands.onCommand.removeListener(shortcutKeyListener)
    }




    function updateContextMenu(status: boolean) {
        console.log('updateContextMenu', status)
        translateStatus = status

        if (translateStatus) {
            browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                title: getMsg('contextMenuOriginal'),
            })
        } else {
            browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                title: getMsg('contextMenuTranslate'),
            })
        }
    }

    async function getMicrosoftToken(): Promise<Token> {
        const release = await mutex.acquire(); // Acquire the lock
        try {
            let tokenFromDB: Token = await configStorage.getConfigItem(CONFIG_KEY.MICROSOFT_TOKEN)
            // if token is null or "" and token is expired, get token from server
            console.debug("getMicrosoftToken tokenFromDB", tokenFromDB)
            if (tokenFromDB == null || tokenFromDB.token == "" || (tokenFromDB.expireTime || 0) < Date.now()) {
                let token = await fetch(tokenUrl).then(response => response.text());
                // save token to db
                let freshToken = new Token(token, Date.now() + 10 * 60 * 1000)
                await configStorage.setConfigItem(CONFIG_KEY.MICROSOFT_TOKEN, freshToken)
                return freshToken
            }
            return tokenFromDB
        } catch (e) {
            console.error(APP_NAME_WITH_SUFFIX, "getMicrosoftToken error", e)
            return new Token("", 0)
            // first get token from db
        } finally {
            release();
        }

    }

    async function initTokenMap() {
        let token = await getMicrosoftToken()
        serviceTokenMap.set(TRANS_SERVICE.MICROSOFT, token)
    }

    // -----------------------------------------------------------------
    // Page translation via AI: port-based so the content script can abort
    // the in-flight fetch by disconnecting. One request per port — the
    // response is a single { translations } message followed by disconnect.
    //   request:  { providerId?: string; texts: string[]; targetLang: string }
    //   response: { type: "result"; translations: string[] }
    //             | { type: "error"; message: string }
    // -----------------------------------------------------------------
    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT_NAME.AI_TRANSLATE) return;
        const controller = new AbortController();
        let disposed = false;
        const send = (msg: { type: "result"; translations: string[] } | { type: "error"; message: string }) => {
            if (disposed) return;
            try { port.postMessage(msg); } catch { /* port may have closed */ }
        };
        port.onDisconnect.addListener(() => {
            disposed = true;
            controller.abort();
        });
        port.onMessage.addListener(async (raw) => {
            const { providerId, texts, targetLang } = (raw || {}) as {
                providerId?: string;
                texts: string[];
                targetLang: string;
            };
            try {
                const raw_list: any[] = (await configStorage.getConfigItem(CONFIG_KEY.AI_PROVIDERS)) || [];
                const list: AiProvider[] = raw_list.map(normalizeProvider);
                let provider: AiProvider | undefined;
                if (list.length > 0) {
                    const id = providerId || (await configStorage.getConfigItem(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
                    provider = list.find((p) => p.id === id && p.enabled !== false)
                        || list.find((p) => p.enabled !== false);
                }
                if (!provider) {
                    send({ type: "error", message: "No enabled AI provider configured." });
                    return;
                }
                const messages = buildPrompt({
                    task: AI_TASK.PAGE_TRANSLATE,
                    providerId: provider.id,
                    payload: { text: JSON.stringify(texts ?? []), targetLang },
                });
                const full = await chatComplete(provider, messages, { signal: controller.signal });
                if (disposed) return;
                // Model is instructed to return a JSON array; be forgiving and
                // pull the first top-level [...] block if surrounded by prose.
                let parsed: unknown;
                try {
                    parsed = JSON.parse(full);
                } catch {
                    const start = full.indexOf("[");
                    const end = full.lastIndexOf("]");
                    if (start >= 0 && end > start) {
                        parsed = JSON.parse(full.slice(start, end + 1));
                    } else {
                        throw new Error("AI did not return a JSON array");
                    }
                }
                if (!Array.isArray(parsed)) throw new Error("AI response was not a JSON array");
                send({ type: "result", translations: parsed.map(String) });
            } catch (e: any) {
                send({ type: "error", message: e?.message || String(e) });
                // if (controller.signal.aborted) return;
            } finally {
                try { port.disconnect(); } catch {}
            }
        });
    });

    // -----------------------------------------------------------------
    // AI Writing: streaming SSE bridge (content port <-> OpenAI fetch)
    // -----------------------------------------------------------------
    browser.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT_NAME.AI_CHAT_STREAM) return;
        const controller = new AbortController();
        let disposed = false;
        const send = (msg: AiStreamMessage) => {
            if (disposed) return;
            try { port.postMessage(msg); } catch { /* port may have closed */ }
        };
        port.onDisconnect.addListener(() => {
            disposed = true;
            controller.abort();
        });
        port.onMessage.addListener(async (raw) => {
            const req = raw as AiStreamRequest;
            try {
                // Look up provider directly from the in-scope ConfigStorage
                // (PouchDB). Round-tripping through sendMessageToBackground
                // here would deadlock: we ARE the background.
                const raw_list: any[] = (await configStorage.getConfigItem(CONFIG_KEY.AI_PROVIDERS)) || [];
                const list: AiProvider[] = raw_list.map(normalizeProvider);
                // Selection: explicit providerId wins; otherwise stored active
                // id; otherwise the first ENABLED provider in the list.
                let provider: AiProvider | undefined;
                if (list.length > 0) {
                    const id = req.providerId || (await configStorage.getConfigItem(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
                    provider = list.find((p) => p.id === id && p.enabled !== false)
                        || list.find((p) => p.enabled !== false);
                }
                if (!provider) {
                    send({ type: "error", message: "No enabled AI provider configured. Add or enable one in extension Options → Services." });
                    return;
                }
                const messages = buildPrompt(req);
                const gen = chatStream(provider, messages, { signal: controller.signal });
                for await (const delta of gen) {
                    if (disposed) return;
                    send({ type: "delta", text: delta });
                }
                send({ type: "done" });
            } catch (e: any) {
                if (controller.signal.aborted) return;
                send({ type: "error", message: e?.message || String(e) });
            }
        });
    });
}

export class Sub {
    constructor(title: string, content: string) {
        this.title = title
        this.content = content
    }

    title: string
    content: string
}

export class Domain {
    constructor(domain: string, strategy?: DOMAIN_STRATEGY, viewStrategy?: VIEW_STRATEGY, aiWritingDisabled?: boolean, aiWritingEnabled?: boolean) {
        this.domain = domain
        this.strategy = strategy
        this.viewStrategy = viewStrategy
        this.aiWritingDisabled = aiWritingDisabled
        this.aiWritingEnabled = aiWritingEnabled
    }

    domain: string
    strategy?: DOMAIN_STRATEGY
    viewStrategy?: VIEW_STRATEGY
    // AI Writing floating dot, blacklist mode: when true, the dot is hidden on this domain.
    aiWritingDisabled?: boolean
    // AI Writing floating dot, whitelist mode: when true, the dot is shown
    // on this domain (and only on whitelisted domains when whitelist mode is on).
    // Independent of `aiWritingDisabled` — both flags can coexist on one doc.
    aiWritingEnabled?: boolean
}

class ConfigStorage {
    private static instance: ConfigStorage;
    db: PouchDB.Database;
    private prefix = "config_"

    constructor(db: PouchDB.Database) {
        this.db = db
    }

    public static getInstance(db: PouchDB.Database): ConfigStorage {
        if (!ConfigStorage.instance) {
            ConfigStorage.instance = new ConfigStorage(db);
        }
        return ConfigStorage.instance;
    }

    async setConfigItem(name: string, value: any) {
        name = this.prefix + name;
        return this.db.put({
            _id: name,
            value: value,
        }).catch(err => {
            if (err.name === 'conflict') {
                return this.db.get(name).then(doc => {
                    // @ts-ignore
                    doc.value = value;
                    return this.db.put(doc);
                });
            } else {
                throw err;
            }
        });
    }

    async getConfigItem(name: string) {
        return this.db.get(this.prefix + name)
            // @ts-ignore
            .then(doc => doc.value)
            .catch(err => {
                if (err?.name === 'not_found') {
                    if (name === CONFIG_KEY.GLOBAL_SWITCH) {
                        return true
                    }
                    if (name === CONFIG_KEY.BILINGUAL_HIGHLIGHTING_SWITCH) {
                        return true
                    }
                    if (name === CONFIG_KEY.FLOAT_BALL_SWITCH) {
                        return true
                    }
                    if (name === CONFIG_KEY.CONTEXT_MENU_SWITCH) {
                        return true
                    }
                    return undefined;
                }
                console.error(APP_NAME_WITH_SUFFIX, `Error getting config item ${name}:`, err);
                return undefined; // Return null if document not found or any other error
            });
    }


}

class DomainStorage {
    private static instance: DomainStorage;
    db: PouchDB.Database;
    private prefix = "domain_"

    constructor(db: PouchDB.Database) {
        this.db = db;
    }

    public static getInstance(db: PouchDB.Database): DomainStorage {
        if (!DomainStorage.instance) {
            DomainStorage.instance = new DomainStorage(db);
        }
        return DomainStorage.instance;
    }

    public add(domain: Domain) {
        domain.domain = this.prefix + domain.domain;
        this.db.put({
            _id: domain.domain,
            strategy: domain.strategy,
            viewStrategy: domain.viewStrategy,
            aiWritingDisabled: domain.aiWritingDisabled,
            aiWritingEnabled: domain.aiWritingEnabled,
        }).then(() => {
            // console.log('Domain added successfully: ${domain.domain}');
        }).catch((err) => {
            console.error(APP_NAME_WITH_SUFFIX, 'Error adding domain: ${domain.strategy}', err);
        });
    }

    public get(domain: string): Promise<any> {
        domain = this.prefix + domain;
        return this.db.get(domain)
    }

    public delete(domain: string): Promise<any> {
        const key = this.prefix + domain;
        return this.db.get(key).then((doc) => {
            return this.db.remove(doc);
        }).catch((err) => {
            if (err?.name === 'not_found') return undefined;
            console.error(APP_NAME_WITH_SUFFIX, `Error deleting domain: ${domain}`, err);
            throw err;
        });
    }

    /**
     * List all stored domains, optionally filtered by strategy / aiWritingDisabled / aiWritingEnabled.
     * Returns plain objects of shape { domain, strategy, viewStrategy, aiWritingDisabled, aiWritingEnabled }.
     */
    public async list(filter?: { strategy?: DOMAIN_STRATEGY; aiWritingDisabled?: boolean; aiWritingEnabled?: boolean }): Promise<Array<{ domain: string; strategy?: DOMAIN_STRATEGY; viewStrategy?: VIEW_STRATEGY; aiWritingDisabled?: boolean; aiWritingEnabled?: boolean }>> {
        const res = await this.db.allDocs({ include_docs: true, startkey: this.prefix, endkey: this.prefix + '￰' });
        let items = res.rows
            .map((r: any) => r.doc)
            .filter((d: any) => d && typeof d._id === 'string' && d._id.startsWith(this.prefix))
            .map((d: any) => ({
                domain: (d._id as string).slice(this.prefix.length),
                strategy: d.strategy,
                viewStrategy: d.viewStrategy,
                aiWritingDisabled: d.aiWritingDisabled,
                aiWritingEnabled: d.aiWritingEnabled,
            }));
        if (filter?.strategy) items = items.filter((it) => it.strategy === filter.strategy);
        if (filter?.aiWritingDisabled !== undefined) items = items.filter((it) => !!it.aiWritingDisabled === filter.aiWritingDisabled);
        if (filter?.aiWritingEnabled !== undefined) items = items.filter((it) => !!it.aiWritingEnabled === filter.aiWritingEnabled);
        return items;
    }

    public update(domain: Domain) {
        return this.db.get(this.prefix + domain.domain).then((doc) => {
            if (domain.strategy) {
                // @ts-ignore
                doc.strategy = domain.strategy;
            }
            if (domain.viewStrategy) {
                // @ts-ignore
                doc.viewStrategy = domain.viewStrategy;
            }
            if (domain.aiWritingDisabled !== undefined) {
                // @ts-ignore
                doc.aiWritingDisabled = domain.aiWritingDisabled;
            }
            if (domain.aiWritingEnabled !== undefined) {
                // @ts-ignore
                doc.aiWritingEnabled = domain.aiWritingEnabled;
            }
            // console.log(doc)
            return this.db.put(doc);
        }).then(() => {
            // console.log(`Domain updated successfully: ${domain.domain}`);
        }).catch((err) => {
            if (err.name === 'not_found') {
                this.add(domain)
            } else {
                console.error(APP_NAME_WITH_SUFFIX, `Error updating domain: ${domain.domain}`, err);
            }

        });
    }

    /**
     * Clear a single field on a domain doc. When the doc has no remaining
     * meaningful fields (strategy / viewStrategy / aiWritingDisabled /
     * aiWritingEnabled), delete the doc outright — keeps storage tidy.
     */
    public async clearField(domain: string, field: 'strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy'): Promise<any> {
        const key = this.prefix + domain;
        try {
            const doc: any = await this.db.get(key);
            delete doc[field];
            if (
                doc.strategy === undefined &&
                doc.viewStrategy === undefined &&
                doc.aiWritingDisabled === undefined &&
                doc.aiWritingEnabled === undefined
            ) {
                return this.db.remove(doc);
            }
            return this.db.put(doc);
        } catch (err: any) {
            if (err?.name === 'not_found') return undefined;
            console.error(APP_NAME_WITH_SUFFIX, `Error clearing field on domain: ${domain}`, err);
            throw err;
        }
    }


}

class RuleStorage {
    private static instance: RuleStorage;
    db: PouchDB.Database;
    private prefix = "rule_"

    constructor(db: PouchDB.Database) {
        this.db = db;
    }

    public static getInstance(db: PouchDB.Database): RuleStorage {
        if (!RuleStorage.instance) {
            RuleStorage.instance = new RuleStorage(db);
        }
        return RuleStorage.instance;
    }

    async add(domain: string, rule: string) {
        domain = this.prefix + domain;
        try {
            const existingDoc: Rule = await this.db.get(domain);
            if (existingDoc.rules.some(r => r === rule)) {
                // console.log('Rule ${rule.content} already exists in domain ${domain}.');
                return;
            }
            existingDoc.rules.push(rule);
            await this.db.put(existingDoc);
            // console.log('Rules added successfully to domain ${rule.domain}.');
        } catch (err: any) {
            if (err.name == "not_found") {
                await this.db.put({
                    _id: domain,
                    rules: [rule]
                });
                // console.log('Rules added successfully to domain ${rule.domain}.');
                return
            }
            console.error(APP_NAME_WITH_SUFFIX, 'Error adding rules to domain ${rule.domain}: ', err);
        }
    }

    async delete(domain: string, ruleContent: string) {
        domain = this.prefix + domain;
        try {
            const doc: Rule = await this.db.get(domain);
            doc.rules = doc.rules.filter(rule => rule !== ruleContent);
            await this.db.put(doc);
            // console.log('Rule ${ruleTitle} deleted successfully from domain ${domain}.');
        } catch (err) {
            console.error(APP_NAME_WITH_SUFFIX, `Error deleting rule ${ruleContent} from domain ${domain}: `, err);
        }
    }

    async list(domain: string) {
        domain = this.prefix + domain;
        const doc: Rule = await this.db.get(domain);
        return doc.rules

    }

    async deleteList(domain: string, rules: string[]) {
        domain = this.prefix + domain;
        try {
            const doc: Rule = await this.db.get(domain);
            let existRules = doc.rules
            const needDeleteList = new Set(rules);
            doc.rules = existRules.filter(rule => !needDeleteList.has(rule));
            await this.db.put(doc);
            // console.log('Rule ${ruleTitle} deleted successfully from domain ${domain}.');
        } catch (err) {
            console.error(APP_NAME_WITH_SUFFIX, 'Error deleting rule ${ruleTitle} from domain ${domain}: ', err);
        }
    }

    async search(domain?: string, ruleTitle?: string, ruleContent?: string) {
        try {
            // search all data prefixed with rule_
            const allDocs = await this.db.allDocs(
                {
                    include_docs: true,
                    startkey: this.prefix,
                }
            );
            let result = allDocs.rows.map(row => row.doc);

            if (domain) {
                result = result.filter(doc => doc?._id.includes(domain));
            }

            if (ruleTitle || ruleContent) {
                // result = result.map((doc) => {
                //     let rules;
                //     if (ruleTitle && ruleContent) {
                //         rules = doc.rules.filter(rule => rule.includes(ruleTitle) && rule.content.includes(ruleContent));
                //     } else if (ruleTitle) {
                //         rules = doc.rules.filter(rule => rule.includes(ruleTitle));
                //     } else if (ruleContent) {
                //         rules = doc.rules.filter(rule => rule.includes(ruleContent));
                //     }
                //     return {
                //         domain: doc._id,
                //         rules: rules
                //     };
                // });
            }

            return result;
        } catch (err) {
            console.error(APP_NAME_WITH_SUFFIX, 'Error searching rules: ', err);
        }
    }

    async getAll() {
        try {
            const result = await this.db.allDocs({ include_docs: true, startkey: this.prefix });
            return result.rows.map(row => row.doc);
        } catch (err) {
            console.error(APP_NAME_WITH_SUFFIX, 'Error getting all rules: ', err);
        }
    }
}

class Rule {
    _id: string | undefined;
    domain: string;
    rules: Array<string> = [];
    constructor(domain: string, rules?: Array<string>) {
        this.domain = domain;
        if (rules != null) {
            this.rules = rules;
        }
    }
}

const serviceTokenMap = new Map<string, Token>()
let tokenUrl = "https://edge.microsoft.com/translate/auth"

function detectDefaultInterfaceLang(): InterfaceLang {
    const ui = browser.i18n?.getUILanguage?.() || ''
    return ui.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function normalizeInterfaceLang(v: unknown): InterfaceLang | undefined {
    return v === 'en' || v === 'zh-CN' ? v : undefined
}

enum CONTEXT_MENU {
    TRANSLATE_RESTORE_PAGE = 'translateRestorePage',
    TRANSLATE_RESTORE_PARA = 'translateRestorePara',
    TRANSLATE_TEXT_BOX = 'translateTextBox',
    TRANSLATE_SELECTION = 'translateSelection'
}
