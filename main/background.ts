import {
    STATUS_FAIL,
    STATUS_SUCCESS,
    DOMAIN_STRATEGY,
    TRANSLATE_ACTION,
    TRANSLATE_SERVICE, CONFIG_KEY,
    TRANSLATE_STATUS_KEY,
    TAB_ACTION,
    DB_ACTION,
    STORAGE_ACTION,
    ACTION,
    VIEW_STRATEGY,
    APP_NAME_WITH_SUFFIX,
    SYNC_ACTION,
    SYNC_PROVIDER_ID,
    IS_FIREFOX,
} from "@/main/constants";
import { Browser, browser } from "wxt/browser";
import type { InterfaceLang } from "@/main/constants";
import { INTERFACE_LOCALES, detectInterfaceLang, normalizeInterfaceLang } from "@/utils/interfaceLang";
import { aiMessageHandlers, registerAiBridge } from "@/main/aiService";
import { translateMessageHandlers } from "@/main/translateService";
import { registerSiteRuleAlarms, siteRuleMessageHandlers } from "@/main/siteRules/siteRuleService";
import { getDomainWithPortFromUrl } from '@/utils/url';
import { configRepo, domainRepo, ruleRepo, type DomainDoc } from "@/main/storage/configStore";
import * as translationCache from "@/main/storage/translationCache";
import { synthesizeTts } from "@/main/ttsService";
import { migrateFromPouchIfNeeded } from "@/main/storage/migrateFromPouch";
import { buildSnapshot, applyImportedSnapshot, redactSecrets } from "@/main/storage/snapshot";
import {
    getAllProviders,
    getProviderById,
    syncNow,
} from "@/main/storage/sync/syncManager";
import { registerAutoSyncListeners, startAutoSync, applyAutoSyncConfig } from "@/main/storage/sync/autoSync";
import { getWebdavConfig, type WebDavCredentials } from "@/main/storage/sync/webdavProvider";
import { ABORT_SCOPE, handleAbort, handleAbortable, handleAsync } from "@/main/messageBridge";

export async function background() {
    //#region main
    console.log("background loaded")
    let translateStatus = false
    let paraTranslateStatus = false
    let paraContextMenuShowStatus = false

    // `contextMenuSwitch` / `currentInterfaceLang` are hydrated from storage by
    // the async bootstrap below, but must EXIST synchronously because the
    // message/port listeners registered further down close over them. Seed the
    // interface language from the browser UI language so getMsg() is usable even
    // before the stored value loads.
    let contextMenuSwitch = false
    let currentInterfaceLang: InterfaceLang = detectInterfaceLang()
    const getMsg = (key: string) => INTERFACE_LOCALES[currentInterfaceLang][key] ?? INTERFACE_LOCALES.en[key] ?? key


    // Register auto-sync alarm/storage listeners synchronously at SW startup so
    // an alarm that wakes the worker is always caught.
    registerAutoSyncListeners();

    // AI Writing streaming bridge (runtime.onConnect). Same first-synchronous-
    // turn requirement as the listeners above.
    registerAiBridge();

    // Periodic refresh of the website-rule subscriptions. Alarm listener, so
    // same first-synchronous-turn requirement as the ones above.
    registerSiteRuleAlarms();

    // Shortcut (commands) dispatch. MUST be registered here in the first
    // synchronous turn — same MV3 rule as onMessage below. A suspended
    // background is revived by the very event that needs it, and Firefox's
    // non-persistent event page only wakes for listeners registered during
    // initial script evaluation; registering it later (after an await, or
    // toggled with the global switch) means Firefox never restarts the page for
    // the shortcut, so shortcuts silently die once the extension goes idle. The
    // listener itself reads the global switch from storage at dispatch time.
    browser.commands.onCommand.addListener(shortcutKeyListener);

    // IMPORTANT (MV3): an idle SW is torn down and cold-started by the very event
    // that needs it. runtime.onMessage / onConnect listeners MUST be registered
    // during this first synchronous turn — if we `await` before reaching them,
    // Chrome dispatches the wake-up message before the listener exists, the
    // sender gets "receiving end does not exist", and (with no .catch on the
    // content side) that surfaces as translation requests timing out whenever
    // the extension had gone inactive. So the config load runs as a DETACHED
    // bootstrap, NOT awaited on the path to the listeners below.
    void (async () => {
        const [ctxMenu, interfaceLang, globalSwitch] = await Promise.all([
            configRepo.getT<boolean>(CONFIG_KEY.CONTEXT_MENU_SWITCH),
            configRepo.get(CONFIG_KEY.INTERFACE_LANGUAGE),
            configRepo.getT<boolean>(CONFIG_KEY.GLOBAL_SWITCH)
        ])
        contextMenuSwitch = ctxMenu
        currentInterfaceLang = normalizeInterfaceLang(interfaceLang) || currentInterfaceLang

        if (globalSwitch) {
            if (contextMenuSwitch) {
                initContextMenu()
            }
        }

        // Safety-net: in case the onInstalled-driven migration was killed by a
        // SW shutdown, retry on every boot. The migration module itself is
        // idempotent (flag-checked) so this is a near-free no-op once done.
        !IS_FIREFOX && await migrateFromPouchIfNeeded({ trigger: 'startup' });

        // Schedule periodic auto-sync + run the startup sync (if enabled) once
        // migration settled.
        void startAutoSync();
    })();
    //#endregion

    //#region message listener
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
        // Feature modules own their own handlers; background only dispatches.
        // A plain synchronous table lookup, so the MV3 first-turn registration
        // rule above is unaffected.
        const featureHandler = translateMessageHandlers[message.action]
            ?? aiMessageHandlers[message.action]
            ?? siteRuleMessageHandlers[message.action]
        if (featureHandler) return featureHandler(message, sendResponse)
        switch (message.action) {
            case DB_ACTION.RULE_ADD:
                ruleRepo.add(message.data.domain, message.data.data).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "add success" });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULE_DEL:
                try {
                    ruleRepo.delete(message.data.domain, message.data.data).then(() => {
                        sendResponse({ status: STATUS_SUCCESS, data: "delete success" });
                    })
                } catch (e) {
                    sendResponse({ status: STATUS_FAIL, data: "delete fail" });
                }
                return true
            case DB_ACTION.RULE_LIST:
                console.debug("list rule from domain", message.data.domain)
                ruleRepo.list(message.data.domain).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data: data });
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULE_GET_ALL:
                ruleRepo.getAll().then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                return true
            case DB_ACTION.RULE_SEARCH:
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
            case DB_ACTION.DOMAIN_UPSERT: {
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
            case SYNC_ACTION.AUTO_SYNC_CONFIG_CHANGED: {
                applyAutoSyncConfig().then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: null });
                }).catch((e) => sendResponse({ status: STATUS_FAIL, data: e?.message || String(e) }));
                return true
            }
            case TAB_ACTION.LANGUAGE_GET:
                // get the language of the tab
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
            case TAB_ACTION.TAB_DOMAIN_GET:
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
            case TAB_ACTION.ID_GET:
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
            case ACTION.INTERFACE_LANGUAGE_CHANGED: {
                const lang = normalizeInterfaceLang(message.data)
                if (lang) {
                    currentInterfaceLang = lang
                    // Refresh the context menu title if it exists.
                    if (paraContextMenuShowStatus) {
                        updateMenuQuietly(CONTEXT_MENU.TRANSLATE_RESTORE_PARA, {
                            title: paraContextMenuShowStatus
                                ? getMsg(CONTEXT_MENU_RESTORE_PARA_TITLE)
                                : getMsg(CONTEXT_MENU_TRANSLATE_PARA_TITLE)
                        })
                    } else {
                        updateMenuQuietly(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
                            title: translateStatus
                                ? getMsg(CONTEXT_MENU_RESTORE_TITLE)
                                : getMsg(CONTEXT_MENU_TRANSLATE_TITLE)
                        })
                    }
                    updateMenuQuietly(CONTEXT_MENU.TRANSLATE_INPUT_BOX, { title: getMsg(CONTEXT_MENU_TRANSLATE_INPUT_BOX_TITLE) })
                    updateMenuQuietly(CONTEXT_MENU.TRANSLATE_SELECTION, { title: getMsg(CONTEXT_MENU_TRANSLATE_SELECTION_TITLE) })
                }
                sendResponse({ status: STATUS_SUCCESS, data: null })
                break
            }
            case TRANSLATE_ACTION.TRANSLATE_STATUS_CHANGED:
                console.log('translateStatusChanged', message.data)
                if (typeof message.data.status === 'boolean') {
                    translateStatus = message.data.status
                    if (!contextMenuSwitch) return
                    updateContextMenu(message.data.status)
                }
                break
            case ACTION.REPORT_ERROR:
                // Draw a sub-frame's error bubble in the top frame: an iframe
                // has no room for a page-level notice and is often clipped to a
                // few pixels. Targeted at frameId 0 rather than broadcast, so
                // the reporting frame does not receive its own error back.
                if (sender.tab?.id) {
                    browser.tabs.sendMessage(
                        sender.tab.id,
                        { action: ACTION.REPORT_ERROR, data: message.data },
                        { frameId: 0 },
                    ).catch(() => { })
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
            case ACTION.SHOW_TRANSLATE_RESTORE_PARA_MENU:
                (async () => {
                    let translateStatus = message.data.translated as boolean
                    paraTranslateStatus = translateStatus
                    let msg = getMsg(translateStatus ? CONTEXT_MENU_RESTORE_PARA_TITLE : CONTEXT_MENU_TRANSLATE_PARA_TITLE)
                    if (paraContextMenuShowStatus) {
                        try {
                            await browser.contextMenus.update(CONTEXT_MENU.TRANSLATE_RESTORE_PARA, { title: msg })
                        } catch (e) {
                            console.log('Error updating context menu:', e);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        if (IS_FIREFOX) {
                            //@ts-ignore
                            browser.contextMenus.refresh()
                        }
                        sendResponse({ status: STATUS_SUCCESS });
                        return
                    }
                    try {
                        await browser.contextMenus.remove(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE)
                    } catch (e) {
                        console.log('Error removing context menu:', e);
                        sendResponse({ status: STATUS_FAIL });
                        return
                    }
                    browser.contextMenus.create({
                        id: CONTEXT_MENU.TRANSLATE_RESTORE_PARA,
                        title: msg,
                        contexts: ["page", "link"] //"selection"
                    }, () => {
                        if (browser.runtime.lastError) {
                            console.log('Error creating context menu:', browser.runtime.lastError.message);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        if (IS_FIREFOX) {
                            //@ts-ignore
                            browser.contextMenus.refresh()
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
                        console.log('Error removing context menu:', e);
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
                            console.log('Error creating context menu:', browser.runtime.lastError.message);
                            sendResponse({ status: STATUS_FAIL });
                            return
                        }
                        if (IS_FIREFOX) {
                            //@ts-ignore
                            browser.contextMenus.refresh()
                        }
                        sendResponse({ status: STATUS_SUCCESS });
                        paraContextMenuShowStatus = false
                    });
                })()

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
            case ACTION.TTS_SYNTHESIZE: {
                return handleAsync('TTS synthesize', sendResponse, async () => {
                    const { text, lang, service } = (message.data || {}) as {
                        text: string; lang: string; service: string;
                    };
                    return { audios: await synthesizeTts(text, lang, service) };
                });
            }
            case ACTION.CONFIG_CHANGED:
                if (typeof message.data !== 'object') return
                Object.entries(message.data).forEach(([key, value]) => {
                    onConfigChanged(key, value)
                })
            default:
                break
        }
        return
    });
    //#endregion

    //#region other listeners
    browser.webNavigation.onCommitted.addListener((details) => {
        if (!details.url.startsWith('http')) return
        if ((details.transitionType === 'reload' && !details.transitionQualifiers.includes('forward_back')) ||
            details.transitionType === 'typed') {
            browser.storage.session.remove(TRANSLATE_STATUS_KEY + details.tabId)
        }
    })

    browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
        // console.log('tab removed:', tabId, removeInfo);
        browser.storage.session.remove(TRANSLATE_STATUS_KEY + tabId)
    })

    //#endregion

    //#region functions
    function contextMenuClickLister(info: Browser.contextMenus.OnClickData, tab: Browser.tabs.Tab | undefined): void {
        console.log('contextMenus.onClicked', info, tab, translateStatus)
        if (!tab || !tab.id) {
            return
        }
        // `.catch` on every send: the tab may have no live content script (the
        // extension was reloaded/updated after the tab was opened, or it is a
        // page we never inject into). That rejection has no consumer here and
        // would only show up as an unhandled error in chrome://extensions.
        switch (info.menuItemId) {
            case CONTEXT_MENU.TRANSLATE_RESTORE_PAGE:
                if (!translateStatus) {
                    browser.tabs.sendMessage(tab.id, { action: TRANSLATE_ACTION.TRANSLATE }).catch(() => { });
                } else {
                    browser.tabs.sendMessage(tab.id, { action: TRANSLATE_ACTION.SHOW_ORIGINAL }).catch(() => { });
                }
                break
            case CONTEXT_MENU.TRANSLATE_INPUT_BOX:
                browser.tabs.sendMessage(tab.id, { action: TRANSLATE_ACTION.TRANSLATE_INPUT_BOX }).catch(() => { });
                break
            case CONTEXT_MENU.TRANSLATE_RESTORE_PARA:
                console.log('translatePara', info, tab)
                let act = paraTranslateStatus ? TRANSLATE_ACTION.SHOW_ORIGINAL_PARA : TRANSLATE_ACTION.TRANSLATE_PARA
                browser.tabs.sendMessage(tab.id, { action: act }).catch(() => { });
                break
            case CONTEXT_MENU.TRANSLATE_SELECTION:
                browser.tabs.sendMessage(tab.id, { action: TRANSLATE_ACTION.TRANSLATE_SELECTION, data: info.selectionText }).catch(() => { });
                break
        }

    }

    async function onConfigChanged(key: string, value: any) {
        switch (key) {
            case CONFIG_KEY.GLOBAL_SWITCH:
                console.log('global switch changed', value)
                let globalSwitch = value
                if (typeof globalSwitch === 'boolean') {
                    if (globalSwitch) {
                        initContextMenu()
                    } else {
                        removeContextMenu()
                    }
                }
                break
            case CONFIG_KEY.CONTEXT_MENU_SWITCH:
                console.log('contextMenuSwitch changed: ', value)
                if (typeof value !== 'boolean') return
                contextMenuSwitch = value
                if (contextMenuSwitch) {
                    rebuildContextMenus()
                } else {
                    browser.contextMenus.removeAll()
                }
                break
            default:
                break
        }
    }

    async function tabsActivatedListener(activeInfo: Browser.tabs.OnActivatedInfo) {
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
            if (!contextMenuSwitch) return
            updateContextMenu(translateStatus)
        })
    }

    function initContextMenu() {
        addAllContextMenus()

        browser.contextMenus.onClicked.addListener(contextMenuClickLister)
        // Listen for tab activation events
        browser.tabs.onActivated.addListener(tabsActivatedListener);
    }

    function rebuildContextMenus() {
        paraContextMenuShowStatus = false
        addAllContextMenus()
    }

    function addAllContextMenus() {
        let t: string = translateStatus ? CONTEXT_MENU_RESTORE_TITLE : CONTEXT_MENU_TRANSLATE_TITLE
        browser.contextMenus.removeAll()
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_RESTORE_PAGE,
            title: getMsg(t),
            contexts: ["page"] //"selection"
        });
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_INPUT_BOX,
            title: getMsg(CONTEXT_MENU_TRANSLATE_INPUT_BOX_TITLE),
            contexts: ["editable"]
        });
        browser.contextMenus.create({
            id: CONTEXT_MENU.TRANSLATE_SELECTION,
            title: getMsg(CONTEXT_MENU_TRANSLATE_SELECTION_TITLE),
            contexts: ["selection"]
        });
    }

    /**
     * `contextMenus.update` / `.remove` REJECT when the item does not exist
     * ("Cannot find menu item with id …"), and that is routine here: the
     * page/paragraph items swap in and out as the pointer moves, and the whole
     * set is torn down when the global switch goes off. No caller can act on
     * it, so the rejection only ever surfaced as an unhandled error in
     * chrome://extensions. Note a surrounding `try/catch` does NOT cover this —
     * these are async rejections, not synchronous throws.
     */
    function updateMenuQuietly(id: string, props: Parameters<typeof browser.contextMenus.update>[1]) {
        return browser.contextMenus.update(id, props).catch(() => { })
    }

    function removeMenuQuietly(id: string) {
        return browser.contextMenus.remove(id).catch(() => { })
    }

    function removeContextMenu() {
        removeMenuQuietly(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE)
        // Was a duplicated TRANSLATE_RESTORE_PAGE — the paragraph item is the
        // one that also needs removing, and it is created dynamically, so the
        // duplicate was guaranteed to reject while the para item leaked.
        removeMenuQuietly(CONTEXT_MENU.TRANSLATE_RESTORE_PARA)
        removeMenuQuietly(CONTEXT_MENU.TRANSLATE_SELECTION)
        removeMenuQuietly(CONTEXT_MENU.TRANSLATE_INPUT_BOX)
        browser.contextMenus.onClicked.removeListener(contextMenuClickLister)
        browser.tabs.onActivated.removeListener(tabsActivatedListener)
    }

    async function shortcutKeyListener(command: string) {
        // Global off ⇒ shortcuts inert. Read the switch from storage on each
        // press rather than a cached flag: this listener is registered
        // synchronously so it can wake a stopped background (see registration
        // site), and on such a cold start the async config bootstrap may not
        // have run yet — a cached flag would still read its initial `false` and
        // silently drop the first press. The read is async but shortcut presses
        // are user-paced, so the extra storage hit is negligible.
        const globalSwitch = await configRepo.getT<boolean>(CONFIG_KEY.GLOBAL_SWITCH)
        if (!globalSwitch) return
        let action = ""
        if (command === 'shortcut-translate-restore-page') {
            // send message to current tab, toggle translate status
            action = TRANSLATE_ACTION.TOGGLE
        } else if (command === 'shortcut-translate') {
            // send message to current tab, toggle translate status
            action = TRANSLATE_ACTION.TRANSLATE
        } else if (command === 'shortcut-restore') {
            // send message to current tab, restore page
            action = TRANSLATE_ACTION.SHOW_ORIGINAL
        } else if (command === 'shortcut-ai-workbench') {
            action = ACTION.AI_OPEN_WORKBENCH
        } else if (command === 'shortcut-translate-restore-paragraph') {
            action = TRANSLATE_ACTION.TOGGLE_TRANSLATE_PARA
        } else if (command === 'shortcut-translate-selection-input') {
            action = TRANSLATE_ACTION.TRANSLATE_SELECTION_INPUT_BOX
        }
        if (!action) return
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            if (tabs.length === 0) {
                return
            }
            let tab = tabs[0]
            if (!tab.id) {
                return
            }
            // Same as the context-menu path: a shortcut can fire on a tab whose
            // content script no longer exists (extension reloaded/updated).
            browser.tabs.sendMessage(tab.id, { action: action }).catch(() => { });
        });
    }

    function updateContextMenu(status: boolean) {
        console.log('updateContextMenu', status)
        if (paraContextMenuShowStatus) return

        updateMenuQuietly(CONTEXT_MENU.TRANSLATE_RESTORE_PAGE, {
            title: translateStatus ? getMsg(CONTEXT_MENU_RESTORE_TITLE) : getMsg(CONTEXT_MENU_TRANSLATE_TITLE),
        })
    }

    //#endregion
}

//#region outer
// Module-top: react to install/update events. `update` triggers the one-shot
// PouchDB → chrome.storage.local migration. `install` skips it (no legacy data).
// MV3 SW can be killed mid-listener, so background() also fires a safety-net
// tail call on every boot.
!IS_FIREFOX && browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'update') {
        void migrateFromPouchIfNeeded({ trigger: 'onInstalled' });
    } else if (reason === 'install') {
        // Fresh install — still mark the migration done so the startup tail
        // doesn't try to open PouchDB on every boot.
        void migrateFromPouchIfNeeded({ trigger: 'onInstalled' });
    }
});

// Background self-rendered strings (currently the context menu titles) look up
// INTERFACE_LOCALES from utils/interfaceLang.ts. Chrome's chrome.i18n.getMessage
// is locked to the browser UI language at install time, so for a
// user-overridable UI language we have to do the lookup ourselves.

const CONTEXT_MENU_TRANSLATE_TITLE = 'contextMenuTranslate'
const CONTEXT_MENU_RESTORE_TITLE = 'contextMenuRestore'
const CONTEXT_MENU_TRANSLATE_PARA_TITLE = 'contextMenuTranslatePara'
const CONTEXT_MENU_RESTORE_PARA_TITLE = 'contextMenuRestorePara'
const CONTEXT_MENU_TRANSLATE_INPUT_BOX_TITLE = 'contextMenuTranslateInputBox'
const CONTEXT_MENU_TRANSLATE_SELECTION_TITLE = 'contextMenuTranslateSelection'

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

enum CONTEXT_MENU {
    TRANSLATE_RESTORE_PAGE = 'translateRestorePage',
    TRANSLATE_RESTORE_PARA = 'translateRestorePara',
    TRANSLATE_INPUT_BOX = 'translateInputBox',
    TRANSLATE_SELECTION = 'translateSelection'
}
//#endregion