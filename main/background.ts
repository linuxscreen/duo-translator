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
    chatCompleteNonStream,
    AiProvider,
    normalizeProvider,
} from "@/main/aiService";
import { getDomainWithPortFromUrl } from '@/utils/url';
import { storage } from 'wxt/utils/storage';
import { configRepo, domainRepo, getConfigItem, ruleRepo, type DomainDoc } from "@/main/storage/configStore";
import * as translationCache from "@/main/storage/translationCache";
import { migrateFromPouchIfNeeded } from "@/main/storage/migrateFromPouch";
import { buildSnapshot, applyImportedSnapshot, redactSecrets } from "@/main/storage/snapshot";
import {
    getAllProviders,
    getProviderById,
    syncNow,
} from "@/main/storage/sync/syncManager";
import { registerAutoSyncListeners, startAutoSync, applyAutoSyncConfig } from "@/main/storage/sync/autoSync";
import { getWebdavConfig, type WebDavCredentials } from "@/main/storage/sync/webdavProvider";
import { sendMessageToTab } from "@/utils/message";

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
const SEPARATOR_TAG = "<sep/>"
const CONTEXT_MENU_TRANSLATE_TITLE = 'contextMenuTranslate'
const CONTEXT_MENU_RESTORE_TITLE = 'contextMenuRestore'
const CONTEXT_MENU_TRANSLATE_PARA_TITLE = 'contextMenuTranslatePara'
const CONTEXT_MENU_RESTORE_PARA_TITLE = 'contextMenuRestorePara'
const CONTEXT_MENU_TRANSLATE_TEXT_BOX_TITLE = 'contextMenuTranslateTextBox'
const CONTEXT_MENU_TRANSLATE_SELECTION_TITLE = 'contextMenuTranslateSelection'


export function background() {
    console.log("background loaded")
    const mutex = new Mutex();
    let translateStatus = false
    let paraTranslateStatus = false
    let paraContextMenuShowStatus = false

    let currentInterfaceLang: InterfaceLang = detectDefaultInterfaceLang()
    // Register auto-sync alarm/storage listeners synchronously at SW startup so
    // an alarm that wakes the worker is always caught.
    registerAutoSyncListeners();
    // Safety-net: in case the onInstalled-driven migration was killed by a SW
    // shutdown, retry on every boot. The migration module itself is idempotent
    // (flag-checked) so this is a near-free no-op once done.
    void migrateFromPouchIfNeeded({ trigger: 'startup' }).then(() => {
        // Schedule periodic auto-sync + run the startup sync (if enabled) once
        // migration settled.
        void startAutoSync();
        initTokenMap();
    });
    const getMsg = (key: string) => LOCALES[currentInterfaceLang][key] ?? key
    configRepo.get(CONFIG_KEY.INTERFACE_LANGUAGE).then((value) => {
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
                const fieldArg = message.data?.field as ('strategy' | 'aiWritingDisabled' | 'aiWritingEnabled' | 'viewStrategy' | 'floatBallDisabled' | undefined);
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
                    floatBallDisabled: message.data?.floatBallDisabled,
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
                applyImportedSnapshot(snap).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.SYNC_NOW: {
                const id = message.data?.id as SYNC_PROVIDER_ID;
                syncNow(id).then((result) => {
                    sendResponse({ status: STATUS_SUCCESS, data: result });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.SYNC_STATUS: {
                (async () => {
                    // Per-provider connection state — providers coexist, any
                    // number can be connected at once.
                    const providers: Record<string, { authenticated: boolean; description: string | null }> = {};
                    for (const provider of getAllProviders()) {
                        const authenticated = await provider.isAuthenticated();
                        const description = authenticated ? await provider.describe() : null;
                        providers[provider.id] = { authenticated, description };
                    }
                    sendResponse({ status: STATUS_SUCCESS, data: { providers } });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.AUTH_GDRIVE: {
                (async () => {
                    const provider = getProviderById(SYNC_PROVIDER_ID.GDRIVE);
                    await provider.authenticate();
                    const description = await provider.describe();
                    sendResponse({ status: STATUS_SUCCESS, data: { description } });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.AUTH_WEBDAV: {
                (async () => {
                    const provider = getProviderById(SYNC_PROVIDER_ID.WEBDAV);
                    await provider.authenticate(message.data as WebDavCredentials);
                    const description = await provider.describe();
                    sendResponse({ status: STATUS_SUCCESS, data: { description } });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.DISCONNECT_PROVIDER: {
                (async () => {
                    const id = message.data?.id as SYNC_PROVIDER_ID | undefined;
                    if (id) {
                        await getProviderById(id).disconnect();
                    }
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.REMOTE_INFO: {
                (async () => {
                    const id = message.data?.id as SYNC_PROVIDER_ID;
                    const provider = getProviderById(id);
                    const info = provider.getRemoteInfo ? await provider.getRemoteInfo() : null;
                    sendResponse({ status: STATUS_SUCCESS, data: info });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.REMOTE_DOWNLOAD: {
                (async () => {
                    const id = message.data?.id as SYNC_PROVIDER_ID;
                    const snap = await getProviderById(id).pull();
                    sendResponse({ status: STATUS_SUCCESS, data: snap });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.REMOTE_DELETE: {
                (async () => {
                    const id = message.data?.id as SYNC_PROVIDER_ID;
                    const provider = getProviderById(id);
                    if (provider.deleteRemote) await provider.deleteRemote();
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                })().catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.WEBDAV_CONFIG_GET: {
                getWebdavConfig().then((cfg) => {
                    sendResponse({ status: STATUS_SUCCESS, data: cfg });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case SYNC_ACTION.AUTO_CONFIG_CHANGED: {
                applyAutoSyncConfig().then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: null });
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
                        title: getMsg(CONTEXT_MENU_TRANSLATE_TITLE),
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
                    try {
                        if (paraContextMenuShowStatus) {
                            browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PARA, {
                                title: paraContextMenuShowStatus
                                    ? getMsg(CONTEXT_MENU_RESTORE_PARA_TITLE)
                                    : getMsg(CONTEXT_MENU_TRANSLATE_PARA_TITLE)
                            })
                        } else {
                            browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                                title: translateStatus
                                    ? getMsg(CONTEXT_MENU_RESTORE_TITLE)
                                    : getMsg(CONTEXT_MENU_TRANSLATE_TITLE)
                            })
                        }
                        browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_TEXT_BOX, { title: getMsg(CONTEXT_MENU_TRANSLATE_TEXT_BOX_TITLE) })
                    } catch { }
                }
                sendResponse({ status: STATUS_SUCCESS, data: null })
                break
            }
            case TRANS_ACTION.TRANSLATE_STATUS_CHANGE:
                console.log('translateStatusChange', message.data)
                if (typeof message.data.status === 'boolean') {
                    translateStatus = message.data.status
                    updateContextMenu(message.data.status)
                }
                break
            case ACTION.RELAY_FRAMES:
                // Re-broadcast an inner action to every frame of the sender's
                // tab. The top-frame content script uses this to fan a
                // translate/restore out to (cross-origin) sub-frames it cannot
                // message directly. `message.data` is the inner Message.
                if (sender.tab?.id && message.data?.action) {
                    browser.tabs.sendMessage(sender.tab.id, message.data).catch(() => { })
                }
                break
            case ACTION.OPEN_OPTIONS_PAGE: {
                const optionsTab = message?.data?.tab
                const optionsUrl = optionsTab ? `options.html#${optionsTab}` : 'options.html'
                browser.tabs.create({ url: optionsUrl }).then(
                    () => sendResponse({ status: STATUS_SUCCESS, data: null }),
                    (e: any) => sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } }),
                )
                return true
            }
            case ACTION.OPEN_POPUP:
                // Opens the toolbar action popup anchored to the extension icon
                // (Chrome 127+). Must target the sender's window so it pops over
                // the page the float ball lives on.
                (async () => {
                    try {
                        const windowId = sender?.tab?.windowId
                        // openPopup is Chrome 127+; the polyfill may not type it.
                        const action = (browser as any).action
                        await action.openPopup(windowId !== undefined ? { windowId } : undefined)
                        sendResponse({ status: STATUS_SUCCESS, data: null })
                    } catch (e: any) {
                        sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } })
                    }
                })()
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
            case ACTION.TRANSLATE_SERVICE_TEST: {
                (async () => {
                    try {
                        const svc: string = message.data?.service;
                        const targetLang: string = message.data?.targetLang || 'zh-CN';
                        const sample = 'Hello, world.';
                        let reply = '';
                        if (svc === TRANS_SERVICE.GOOGLE) {
                            const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(sample)}`);
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            const j = await r.json();
                            reply = j?.[0]?.[0]?.[0] || 'OK';
                        } else if (svc === TRANS_SERVICE.MICROSOFT) {
                            const token = await getMicrosoftToken();
                            if (!token?.token) throw new Error('Failed to obtain Microsoft token');
                            const r = await fetch(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(targetLang)}`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token.token },
                                body: JSON.stringify([{ Text: sample }]),
                            });
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            const j = await r.json();
                            reply = j?.[0]?.translations?.[0]?.text || 'OK';
                        } else if (svc === TRANS_SERVICE.DEEPL) {
                            const key: string = (message.data?.apiKey ?? '') || ((await configRepo.get(CONFIG_KEY.DEEPL_API_KEY)) as string) || '';
                            if (!key) throw new Error('DeepL API key is not configured');
                            const url = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
                            const params = new URLSearchParams();
                            params.append('text', sample);
                            params.append('target_lang', (targetLang.split('-')[0] || 'EN').toUpperCase());
                            const r = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `DeepL-Auth-Key ${key}` },
                                body: params.toString(),
                            });
                            if (!r.ok) {
                                let detail = '';
                                try { detail = (await r.text()).slice(0, 200); } catch { }
                                throw new Error(`HTTP ${r.status}${detail ? ': ' + detail : ''}`);
                            }
                            const j = await r.json();
                            reply = j?.translations?.[0]?.text || 'OK';
                        } else {
                            throw new Error(`Unknown service: ${svc}`);
                        }
                        sendResponse({ status: STATUS_SUCCESS, data: { reply } });
                    } catch (e: any) {
                        sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } });
                    }
                })();
                return true;
            }
            case ACTION.DEEPL_REQUEST: {
                // CORS proxy for DeepL: content sends the JSON request body,
                // background attaches the configured key + endpoint and fetches.
                (async () => {
                    try {
                        const body = message.data?.body;
                        const key = ((await configRepo.get(CONFIG_KEY.DEEPL_API_KEY)) as string) || '';
                        if (!key) throw new Error('DeepL API key is not configured');
                        const url = key.endsWith(':fx')
                            ? 'https://api-free.deepl.com/v2/translate'
                            : 'https://api.deepl.com/v2/translate';
                        const r = await fetch(url, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `DeepL-Auth-Key ${key}`,
                            },
                            body: JSON.stringify(body),
                        });
                        if (r.status !== 200) {
                            let detail = '';
                            try { detail = (await r.text()).slice(0, 200); } catch { }
                            throw new Error(`HTTP ${r.status}${detail ? ': ' + detail : ''}`);
                        }
                        const payload = await r.json();
                        sendResponse({ status: STATUS_SUCCESS, data: payload });
                    } catch (e: any) {
                        console.error(APP_NAME_WITH_SUFFIX, 'DeepL request failed:', e?.message || e);
                        sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } });
                    }
                })();
                return true;
            }
            case ACTION.AI_TRANSLATE_TEXT: {
                // One-shot (non-streaming) page-translation via AI. content sends
                // { requestId, providerId?, texts, targetLang }; we return the
                // translations array. Cancellation: an AbortController is stored
                // under requestId and its signal is forwarded to the upstream
                // fetch, so an AI_TRANSLATE_ABORT for the same id cancels it.
                (async () => {
                    const { requestId, providerId, texts, targetLang } = (message.data || {}) as {
                        requestId?: string;
                        providerId?: string;
                        texts: string[];
                        targetLang: string;
                    };
                    const controller = new AbortController();
                    if (requestId) aiTranslateAborters.set(requestId, controller);
                    try {
                        const translations = await aiPageTranslate(providerId, texts, targetLang, controller.signal);
                        sendResponse({ status: STATUS_SUCCESS, data: translations });
                    } catch (e: any) {
                        console.error(APP_NAME_WITH_SUFFIX, 'AI translate failed:', e?.message || e);
                        sendResponse({ status: STATUS_FAIL, data: { message: e?.message || String(e) } });
                    } finally {
                        if (requestId) aiTranslateAborters.delete(requestId);
                    }
                })();
                return true;
            }
            case ACTION.AI_TRANSLATE_ABORT: {
                // Cancel the in-flight AI_TRANSLATE_TEXT fetch for this requestId.
                const requestId: string | undefined = message.data?.requestId;
                const controller = requestId ? aiTranslateAborters.get(requestId) : undefined;
                if (controller) {
                    controller.abort();
                    aiTranslateAborters.delete(requestId!);
                }
                sendResponse({ status: STATUS_SUCCESS });
                break;
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
                (async () => {
                    let translateStatus = message.data.translated as boolean
                    paraTranslateStatus = translateStatus
                    let msg = getMsg(translateStatus ? CONTEXT_MENU_RESTORE_PARA_TITLE : CONTEXT_MENU_TRANSLATE_PARA_TITLE)
                    if (paraContextMenuShowStatus) {
                        try {
                            await browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PARA, { title: msg })
                        } catch (e) {
                            console.error('Error updating context menu:', e);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        sendResponse({ status: STATUS_SUCCESS });
                        return
                    }
                    try {
                        await browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE)
                    } catch (e) {
                        console.error('Error removing context menu:', e);
                        sendResponse({ status: STATUS_FAIL });
                        return
                    }
                    browser.contextMenus.create({
                        id: CONTEXT_MENU.TRANSLATE_RESTORE_PARA,
                        title: msg,
                        contexts: ["page", "link"] //"selection"
                    }, () => {
                        if (browser.runtime.lastError) {
                            console.error('Error creating context menu:', browser.runtime.lastError.message);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        sendResponse({ status: STATUS_SUCCESS });
                        paraContextMenuShowStatus = true;
                    });

                })()


                return true
            case ACTION.HIDE_TRANSLATE_RESTORE_PARA_MENU:
                (async () => {
                    if (!paraContextMenuShowStatus) return
                    try {
                        await browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PARA)
                    } catch (e) {
                        console.error('Error removing context menu:', e);
                        sendResponse({ status: STATUS_FAIL });
                        return
                    }

                    let t: string = translateStatus ? CONTEXT_MENU_RESTORE_TITLE : CONTEXT_MENU_TRANSLATE_TITLE
                    browser.contextMenus.create({
                        id: CONTEXT_MENU.TRANSLATE_RESTORE_PAGE,
                        title: getMsg(t),
                        contexts: ["page"] //"selection"
                    }, () => {
                        if (browser.runtime.lastError) {
                            console.error('Error creating context menu:', browser.runtime.lastError.message);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        sendResponse({ status: STATUS_SUCCESS });
                        paraContextMenuShowStatus = false
                    });
                })()

                return true
            case ACTION.TRANSLATION_CACHE_GET:
                translationCache.getMany(
                    message.data.service,
                    message.data.targetLang,
                    message.data.texts ?? [],
                ).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: { name: e?.name, message: e?.message } })
                })
                return true
            case ACTION.TRANSLATION_CACHE_PUT:
                translationCache.putMany(
                    message.data.service,
                    message.data.targetLang,
                    message.data.entries ?? [],
                ).then(() => {
                    sendResponse({ status: STATUS_SUCCESS })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: { name: e?.name, message: e?.message } })
                })
                return true
            case ACTION.TRANSLATION_CACHE_CLEAR:
                translationCache.clearAll().then(() => {
                    sendResponse({ status: STATUS_SUCCESS })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: { name: e?.name, message: e?.message } })
                })
                return true
            case ACTION.TRANSLATION_CACHE_SIZE:
                translationCache.getTotalBytes().then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: { name: e?.name, message: e?.message } })
                })
                return true
            default:
                break
        }
        return
    });

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
                let act = paraTranslateStatus ? TRANS_ACTION.SHOW_ORIGINAL_PARA : TRANS_ACTION.TRANSLATE_PARA
                browser.tabs.sendMessage(tab.id, { action: act });
                break
        }


    }

    function initContextMenu() {
        let t: string = translateStatus ? CONTEXT_MENU_RESTORE_TITLE : CONTEXT_MENU_TRANSLATE_TITLE
        browser.contextMenus.removeAll()
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_RESTORE_PAGE,
            title: getMsg(t),
            contexts: ["page"] //"selection"
        });
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_TEXT_BOX,
            title: getMsg(CONTEXT_MENU_TRANSLATE_TEXT_BOX_TITLE),
            contexts: ["editable"]
        });
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_SELECTION,
            title: getMsg(CONTEXT_MENU_TRANSLATE_SELECTION_TITLE),
            contexts: ["selection"]
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
                translateStatus = !!value[tabTranslateStatusKey]
                updateContextMenu(translateStatus)
            })
            // browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_TEXT_BOX, { title : ''})
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
        if (paraContextMenuShowStatus) return

        browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
            title: translateStatus ? getMsg(CONTEXT_MENU_RESTORE_TITLE) : getMsg(CONTEXT_MENU_TRANSLATE_TITLE),
        })
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
                    payload: { text: texts.join(SEPARATOR_TAG), targetLang },
                });
                const full = await chatComplete(provider, messages, { signal: controller.signal });
                if (disposed) return;
                send({ type: "result", translations: full.split(SEPARATOR_TAG).filter((s) => s.length > 0) });
            } catch (e: any) {
                send({ type: "error", message: e?.message || String(e) });
                // if (controller.signal.aborted) return;
            } finally {
                try { port.disconnect(); } catch { }
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

// In-flight AbortControllers for one-shot AI_TRANSLATE_TEXT requests, keyed by
// the content-supplied requestId. AI_TRANSLATE_ABORT looks one up to cancel the
// upstream fetch. Entries are removed when the request settles.
const aiTranslateAborters = new Map<string, AbortController>();

/**
 * Run a page-translation request against the configured AI provider and return
 * the translations array. Shared by both the port-based streaming bridge
 * (PORT_NAME.AI_TRANSLATE) and the one-shot ACTION.AI_TRANSLATE_TEXT handler.
 * Throws on misconfiguration or a non-array model response.
 */
// Batch texts up to this many characters per upstream request. The concurrency
// cap is enforced globally inside chatCompleteNonStream (a shared semaphore), so
// firing every batch at once here is fine — the limiter throttles the actual
// requests across all callers, not just this one invocation.
const AI_PAGE_TRANSLATE_BATCH_CHARS = 500;

async function aiPageTranslate(
    providerId: string | undefined,
    texts: string[],
    targetLang: string,
    signal?: AbortSignal,
): Promise<string[]> {
    const raw_list: any[] = ((await configRepo.get(CONFIG_KEY.AI_PROVIDERS)) as any[] | null) || [];
    const list: AiProvider[] = raw_list.map(normalizeProvider);
    let provider: AiProvider | undefined;
    if (list.length > 0) {
        const id = providerId || (await configRepo.get(CONFIG_KEY.AI_ACTIVE_PROVIDER_ID));
        provider = list.find((p) => p.id === id && p.enabled !== false)
            || list.find((p) => p.enabled !== false);
    }
    if (!provider) throw new Error("No enabled AI provider configured.");

    let temperature = 0; // todo support use defined temperature
    let params: any; // todo support use defined params
    if (provider.type === "deepseek") {
        params = { thinking: { type: "disabled" } }
    }

    const all = texts ?? [];
    if (all.length === 0) return [];

    // Split into batches of <= AI_PAGE_TRANSLATE_BATCH_CHARS characters. Each
    // batch is a contiguous slice so results can be written back into their
    // original positions regardless of completion order. Concurrency is capped
    // downstream by chatCompleteNonStream's global semaphore.
    const batches: { start: number; texts: string[] }[] = [];
    let cur: string[] = [];
    let curStart = 0;
    let curChars = 0;
    for (let i = 0; i < all.length; i++) {
        const len = all[i].length;
        // Close the current batch if appending this text would exceed the
        // char budget — unless the batch is empty (a single oversized text
        // still has to go out on its own).
        if (cur.length > 0 && curChars + len > AI_PAGE_TRANSLATE_BATCH_CHARS) {
            batches.push({ start: curStart, texts: cur });
            cur = [];
            curStart = i;
            curChars = 0;
        }
        cur.push(all[i]);
        curChars += len;
    }
    if (cur.length > 0) batches.push({ start: curStart, texts: cur });

    const results: string[] = new Array(all.length);

    // Translate one batch and write its results back at the right offset.
    const runBatch = async (batch: { start: number; texts: string[] }) => {
        const messages = buildPrompt({
            task: AI_TASK.PAGE_TRANSLATE,
            providerId: provider!.id,
            payload: { text: batch.texts.join(SEPARATOR_TAG), targetLang },
        });
        // Non-streaming: the upstream request is sent with stream:false (see
        // chatCompleteNonStream) — page translation wants the full result in
        // one response, not an SSE stream.
        const full = await chatCompleteNonStream(provider!, messages, { temperature, signal, params });
        const outs = full.split(SEPARATOR_TAG).filter((s) => s.length > 0);
        // if (outs.length != texts.length) throw new Error(`Expected ${texts.length} translations, got ${outs.length}`)

        for (let i = 0; i < batch.texts.length; i++) {
            // Guard against a short response — fall back to the source text so
            // indices never drift out of alignment with the input array.
            // todo fallback to machine translation
            results[batch.start + i] = i < outs.length ? outs[i] : batch.texts[i];
        }
    };

    // Fire every batch; the global semaphore in chatCompleteNonStream caps how
    // many actually hit the network at once.
    await Promise.all(batches.map(runBatch));

    return results;
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
