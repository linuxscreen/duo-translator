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
    SYNC_ACTION,
    SYNC_PROVIDER_ID,
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
import { storage } from 'wxt/utils/storage';
import { configRepo, domainRepo, ruleRepo, type DomainDoc } from "@/main/storage/configStore";
import { migrateFromPouchIfNeeded } from "@/main/storage/migrateFromPouch";
import { buildSnapshot, applySnapshot, redactSecrets } from "@/main/storage/snapshot";
import {
    getActiveProviderId,
    setActiveProvider,
    getProviderById,
    syncNow,
    syncOnStartup,
} from "@/main/storage/sync/syncManager";
import type { WebDavCredentials } from "@/main/storage/sync/webdavProvider";

// Module-top: react to install/update events. `update` triggers the one-shot
// PouchDB → chrome.storage.local migration. `install` skips it (no legacy data).
// MV3 SW can be killed mid-listener, so background() also fires a safety-net
// tail call on every boot.
browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') {
        void migrateFromPouchIfNeeded({ trigger: 'onInstalled' });
    } else if (reason === 'install') {
        // Fresh install — still mark the migration done so the startup tail
        // doesn't try to open PouchDB on every boot.
        void migrateFromPouchIfNeeded({ trigger: 'onInstalled' });
    }
});

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
    // Safety-net: in case the onInstalled-driven migration was killed by a SW
    // shutdown, retry on every boot. The migration module itself is idempotent
    // (flag-checked) so this is a near-free no-op once done.
    void migrateFromPouchIfNeeded({ trigger: 'startup' }).then(() => {
        // Pull from active sync provider (if configured) once migration settled.
        void syncOnStartup();
        initTokenMap();
    });
    let paraContextMenuShowStatus = false
    let isTranslateParaShowing = false

    let currentInterfaceLang: InterfaceLang = detectDefaultInterfaceLang()
    const getMsg = (key: string) => LOCALES[currentInterfaceLang][key] ?? key
    configRepo.get(CONFIG_KEY.INTERFACE_LANG).then((value) => {
        const lang = normalizeInterfaceLang(value)
        if (lang) currentInterfaceLang = lang
    })

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
                ruleRepo.add(message.data.domain, message.data.data).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "add success" });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_DEL:
                try {
                    ruleRepo.delete(message.data.domain, message.data.data).then(() => {
                        sendResponse({ status: STATUS_SUCCESS, data: "delete success" });
                    })
                } catch (e) {
                    sendResponse({ status: STATUS_FAIL, data: "delete fail" });
                }
                return true
            case DB_ACTION.RULES_LIST:
                console.debug("list rule from domain", message.data.domain)
                ruleRepo.list(message.data.domain).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data: data });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_GET_ALL:
                ruleRepo.getAll().then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULES_SEARCH:
                ruleRepo.search(message.data.domain).then(value => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                return true
            case DB_ACTION.DOMAIN_GET:
                domainRepo.get(message.data.domain).then(data => {
                    sendResponse({ status: STATUS_SUCCESS, data: data })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.DOMAIN_UPDATE: {
                const { domain: domainHost, ...patch } = (message.data ?? {}) as { domain: string } & DomainDoc;
                domainRepo.update(domainHost, patch as DomainDoc).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                return true
            }
            case DB_ACTION.DOMAIN_DELETE: {
                const fieldArg = message.data?.field as ('strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy' | undefined);
                const op = fieldArg
                    ? domainRepo.clearField(message.data.domain, fieldArg)
                    : domainRepo.delete(message.data.domain);
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
                domainRepo.list(filter).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data })
                }).catch((e) => {
                    errorResponse(e)
                });
                return true
            }
            // get the configuration
            case DB_ACTION.CONFIG_GET:
                console.log('getConfig', message.data)
                configRepo.get(message.data.name).then((value) => {
                    // console.log(value)
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.CONFIG_SET:
                configRepo.set(message.data.name, message.data.value).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                return true
            case DB_ACTION.BACKUP_EXPORT: {
                const includeSecrets = !!message.data?.includeSecrets;
                buildSnapshot({ includeSecrets: true }).then((snap) => {
                    const payload = includeSecrets ? snap : redactSecrets(snap);
                    sendResponse({ status: STATUS_SUCCESS, data: payload });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case DB_ACTION.BACKUP_IMPORT: {
                const snap = message.data?.snapshot;
                const mode: 'merge' | 'replace' = message.data?.mode === 'replace' ? 'replace' : 'merge';
                applySnapshot(snap, mode).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.SYNC_NOW: {
                syncNow().then((result) => {
                    sendResponse({ status: STATUS_SUCCESS, data: result });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.SYNC_STATUS: {
                (async () => {
                    const activeId = await getActiveProviderId();
                    let description: string | null = null;
                    let authenticated = false;
                    if (activeId) {
                        const provider = getProviderById(activeId);
                        authenticated = await provider.isAuthenticated();
                        if (authenticated) description = await provider.describe();
                    }
                    sendResponse({
                        status: STATUS_SUCCESS,
                        data: { activeId, authenticated, description },
                    });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.AUTH_GDRIVE: {
                (async () => {
                    const provider = getProviderById(SYNC_PROVIDER_ID.GDRIVE);
                    await provider.authenticate();
                    await setActiveProvider(SYNC_PROVIDER_ID.GDRIVE);
                    const description = await provider.describe();
                    sendResponse({ status: STATUS_SUCCESS, data: { description } });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.AUTH_WEBDAV: {
                (async () => {
                    const provider = getProviderById(SYNC_PROVIDER_ID.WEBDAV);
                    await provider.authenticate(message.data as WebDavCredentials);
                    await setActiveProvider(SYNC_PROVIDER_ID.WEBDAV);
                    const description = await provider.describe();
                    sendResponse({ status: STATUS_SUCCESS, data: { description } });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.DISCONNECT_PROVIDER: {
                (async () => {
                    const id = (message.data?.id as SYNC_PROVIDER_ID) ?? (await getActiveProviderId());
                    if (id) {
                        const provider = getProviderById(id);
                        await provider.disconnect();
                        const active = await getActiveProviderId();
                        if (active === id) await setActiveProvider(null);
                    }
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.SET_ACTIVE_PROVIDER: {
                const id = (message.data?.id as SYNC_PROVIDER_ID | null) ?? null;
                setActiveProvider(id).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.GET_ACTIVE_PROVIDER: {
                getActiveProviderId().then((id) => {
                    sendResponse({ status: STATUS_SUCCESS, data: { activeId: id } });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
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
    configRepo.get(CONFIG_KEY.CONTEXT_MENU_SWITCH).then((value) => {
        console.log("contextMenuSwitch", value);
        let contextMenuSwitch = value === undefined ? true : value
        // judge global switch
        configRepo.get(CONFIG_KEY.GLOBAL_SWITCH).then((globalSwitch) => {
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
            let tokenFromDB = (await configRepo.get(CONFIG_KEY.MICROSOFT_TOKEN)) as Token | null
            // if token is null or "" and token is expired, get token from server
            console.debug("getMicrosoftToken tokenFromDB", tokenFromDB)
            if (tokenFromDB == null || tokenFromDB.token == "" || (tokenFromDB.expireTime || 0) < Date.now()) {
                let token = await fetch(tokenUrl).then(response => response.text());
                // save token to db
                let freshToken = new Token(token, Date.now() + 10 * 60 * 1000)
                await configRepo.set(CONFIG_KEY.MICROSOFT_TOKEN, freshToken)
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
                const raw_list: any[] = ((await configRepo.get(CONFIG_KEY.AI_PROVIDERS)) as any[] | null) || [];
                const list: AiProvider[] = raw_list.map(normalizeProvider);
                let provider: AiProvider | undefined;
                if (list.length > 0) {
                    const id = providerId || (await configRepo.get(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
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
                const raw_list: any[] = ((await configRepo.get(CONFIG_KEY.AI_PROVIDERS)) as any[] | null) || [];
                const list: AiProvider[] = raw_list.map(normalizeProvider);
                // Selection: explicit providerId wins; otherwise stored active
                // id; otherwise the first ENABLED provider in the list.
                let provider: AiProvider | undefined;
                if (list.length > 0) {
                    const id = req.providerId || (await configRepo.get(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
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

export class Domain {
    constructor(domain: string, strategy?: DOMAIN_STRATEGY, aiWritingDisabled?: boolean, aiWritingEnabled?: boolean) {
        this.domain = domain
        this.strategy = strategy
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
