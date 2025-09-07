import PouchDB from 'pouchdb';
import {
    STATUS_FAIL,
    STATUS_SUCCESS,
    DOMAIN_STRATEGY,
    VIEW_STRATEGY,
    TRANS_ACTION,
    TRANS_SERVICE, CONFIG_KEY,
    TRANSLATE_STATUS_KEY,
    TB_ACTION,
    DB_ACTION,
    STORAGE_ACTION,
    ACTION
} from "@/entrypoints/constants";
import { Rule } from "@/entrypoints/utils";
import { browser } from "wxt/browser";
import { Token } from "@/entrypoints/translateService";
import { Mutex } from "async-mutex";

export class Sub {
    constructor(title: string, content: string) {
        this.title = title
        this.content = content
    }

    title: string
    content: string
}

export class Domain {
    constructor(domain: string, strategy?: DOMAIN_STRATEGY, viewStrategy?: VIEW_STRATEGY) {
        this.domain = domain
        this.strategy = strategy
        this.viewStrategy = viewStrategy
    }

    domain: string
    strategy?: DOMAIN_STRATEGY
    viewStrategy?: VIEW_STRATEGY
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
                console.error(`Error getting config item ${name}:`, err);
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
            viewStrategy: domain.viewStrategy
        }).then(() => {
            // console.log('Domain added successfully: ${domain.domain}');
        }).catch((err) => {
            console.error('Error adding domain: ${domain.strategy}', err);
        });
    }

    public get(domain: string): Promise<any> {
        domain = this.prefix + domain;
        return this.db.get(domain)
    }

    public delete(domain: string) {
        domain = this.prefix + domain;
        this.db.get(domain).then((doc) => {
            return this.db.remove(doc);
        }).then(() => {
            // console.log('Domain deleted successfully: ${domain}');
        }).catch((err) => {
            console.error('Error deleting domain: ${domain}', err);
        });
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
            // console.log(doc)
            return this.db.put(doc);
        }).then(() => {
            // console.log(`Domain updated successfully: ${domain.domain}`);
        }).catch((err) => {
            if (err.name === 'not_found') {
                this.add(domain)
            } else {
                console.error(`Error updating domain: ${domain.domain}`, err);
            }

        });
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
            console.error('Error adding rules to domain ${rule.domain}: ', err);
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
            console.error(`Error deleting rule ${ruleContent} from domain ${domain}: `, err);
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
            console.error('Error deleting rule ${ruleTitle} from domain ${domain}: ', err);
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
            console.error('Error searching rules: ', err);
        }
    }

    async getAll() {
        try {
            const result = await this.db.allDocs({ include_docs: true, startkey: this.prefix });
            return result.rows.map(row => row.doc);
        } catch (err) {
            console.error('Error getting all rules: ', err);
        }
    }
}

const serviceTokenMap = new Map<string, Token>()
let tokenUrl = "https://edge.microsoft.com/translate/auth"

export default defineBackground(() => {
    const mutex = new Mutex();
    initTokenMap()
    let db = new PouchDB('userdb');

    const ruleStorage = RuleStorage.getInstance(db)
    const domainStorage = DomainStorage.getInstance(db)
    const configStorage = ConfigStorage.getInstance(db)


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
                break
            case ACTION.TRANSLATE_HTML:
                // todo
                break
            case DB_ACTION.RULES_ADD:
                    ruleStorage.add(message.data.domain, message.data.data).then(() => {
                        sendResponse({ status: STATUS_SUCCESS, data: "add success" });
                    }).catch((e)=>{
                        errorResponse(e)
                    })
                break
            case DB_ACTION.RULES_DEL:
                try {
                    ruleStorage.delete(message.data.domain, message.data.data).then(() => {
                        sendResponse({ status: STATUS_SUCCESS, data: "delete success" });
                    })
                } catch (e) {
                    sendResponse({ status: STATUS_FAIL, data: "delete fail" });
                }
                break
            case DB_ACTION.RULES_LIST:
                console.debug("list rule from domain", message.data.domain)
                ruleStorage.list(message.data.domain).then((data) => {
                    sendResponse({ status: STATUS_SUCCESS, data: data });
                }).catch((e) => {
                    errorResponse(e)
                })
                break
            case DB_ACTION.RULES_GET_ALL:
                ruleStorage.getAll().then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                break
            case DB_ACTION.RULES_SEARCH:
                ruleStorage.search(message.data.domain).then(value => {
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                break
            case DB_ACTION.DOMAIN_GET:
                domainStorage.get(message.data.domain).then(data => {
                    sendResponse({ status: STATUS_SUCCESS, data: data })
                }).catch((e) => {
                    errorResponse(e)
                })

                // sendResponse({status: STATUS_SUCCESS, data: data})
                break
            case DB_ACTION.DOMAIN_UPDATE:
                domainStorage.update(message.data).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                break
            // get the configuration
            case DB_ACTION.CONFIG_GET:
                console.log('getConfig', message.data)
                configStorage.getConfigItem(message.data.name).then((value) => {
                    // console.log(value)
                    sendResponse({ status: STATUS_SUCCESS, data: value })
                }).catch((e) => {
                    errorResponse(e)
                })
                break
            case DB_ACTION.CONFIG_SET:
                configStorage.setConfigItem(message.data.name, message.data.value).then(() => {
                    sendResponse({ status: STATUS_SUCCESS, data: "insert success" });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: "insert fail" });
                });
                break
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
                browser.tabs.detectLanguage((lang: string)=>{
                    sendResponse({ status: STATUS_SUCCESS, data: lang });
                })
                break;
            // get browser native language
            case TB_ACTION.NATIVE_LANGUAGE_GET:
                // let lang = browser.i18n.getUILanguage()
                sendResponse({ status: STATUS_SUCCESS, data: navigator.language });
                break
            case TB_ACTION.TAB_DOMAIN_GET:
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    let urlString = tabs?.[0]?.url
                    if (!urlString) {
                        sendResponse({ status: STATUS_FAIL, data: "url is null" });
                        return
                    }
                    let url = new URL(urlString)
                    // console.log(url)
                    sendResponse({ status: STATUS_SUCCESS, data: url.hostname })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                break
            case TB_ACTION.ID_GET:
                browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
                    let tab = tabs[0].id
                    sendResponse({ status: STATUS_SUCCESS, data: tab })
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                break
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
                break
            case STORAGE_ACTION.SESSION_GET:
                browser.storage.session.get(message.data.key).then((value) => {
                    sendResponse({ status: STATUS_SUCCESS, data: value[message.data.key] });
                }).catch((e) => {
                    sendResponse({ status: STATUS_FAIL, data: e.message })
                });
                break
            case TB_ACTION.CONTEXT_MENU_SHOW:
                console.log('showContextMenu', message.data)
                // updateContextMenu(message.data as number)
                break
            case TB_ACTION.CONTEXT_MENU_SWITCH:
                console.log('contextMenuSwitch', message.data)
                let contextMenuSwitch = message.data.contextMenuSwitch
                if (contextMenuSwitch) {
                    browser.contextMenus.create({
                        id: "translate",
                        title: browser.i18n.getMessage('contextMenuTranslate'),
                        contexts: ["selection", "page"]
                    });
                } else {
                    browser.contextMenus.remove("translate")
                }
                break
            case TRANS_ACTION.TRANSLATE_STATUS_CHANGE:
                console.log('translateStatusChange', message.data)
                if (typeof message.data.status === 'boolean') {
                    updateContextMenu(message.data.status)
                }
                break
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
            default:
                break
        }
        return true
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

    // @ts-ignore
    let contextMenuClickLister = (info, tab) => {
        console.log('contextMenus.onClicked', info, tab, translateStatus)
        if (!tab || !tab.id) {
            return
        }
        if (!translateStatus) {
            browser.tabs.sendMessage(tab.id, { action: TRANS_ACTION.TRANSLATE });
        } else {
            browser.tabs.sendMessage(tab.id, { action: TRANS_ACTION.ORIGIN });
        }

    }

    function initContextMenu() {
        let t: string = 'contextMenuTranslate'
        if (translateStatus) {
            t = 'contextMenuOriginal'
        }
        browser.contextMenus.create({
            id: "translate",
            // @ts-ignore
            title: browser.i18n.getMessage(t),
            contexts: ["selection", "page"]
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
                    browser.contextMenus.update("translate", {
                        title: browser.i18n.getMessage('contextMenuOriginal'),
                    })
                } else {
                    browser.contextMenus.update("translate", {
                        title: browser.i18n.getMessage('contextMenuTranslate'),
                    })
                }
            })
        });
    }

    function removeContextMenu() {
        browser.contextMenus.remove("translate")
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
            action = TRANS_ACTION.ORIGIN
        }
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
            browser.contextMenus.update("translate", {
                title: browser.i18n.getMessage('contextMenuOriginal'),
            })
        } else {
            browser.contextMenus.update("translate", {
                title: browser.i18n.getMessage('contextMenuTranslate'),
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
            console.error("getMicrosoftToken error", e)
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
});
