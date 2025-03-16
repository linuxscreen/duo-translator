import PouchDB from 'pouchdb';
import {
    STATUS_FAIL,
    STATUS_SUCCESS,
    DOMAIN_STRATEGY,
    VIEW_STRATEGY,
    TRANS_ACTION,
    TRANS_SERVICE, CONFIG_KEY
} from "@/entrypoints/constants";
import {Rule, SubRule} from "@/entrypoints/utils";
import {browser, Tabs} from "wxt/browser";
import {Token, translationServices} from "@/entrypoints/translateService";
import {Mutex} from "async-mutex";
import Tab = Tabs.Tab;
import {getConfig} from "@/utils/db";

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
        // @ts-ignore
        return this.db.get(this.prefix + name).then(doc => doc.value);
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
        return this.db.get(domain).then((doc) => {
            // console.log(`Domain found: ${domain}`);
            // console.log(`doc ${doc._id}`)
            return doc;
        }).catch((err) => {
            console.error(`Error finding domain: ${domain}`, err);
        });
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
        try {
            const doc: Rule = await this.db.get(domain);
            return doc.rules
        } catch (err) {
            console.error(`Error list rule from domain ${domain}: `, err);
        }
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
            const result = await this.db.allDocs({include_docs: true, startkey: this.prefix});
            return result.rows.map(row => row.doc);
        } catch (err) {
            console.error('Error getting all rules: ', err);
        }
    }
}

function translateHtml(service: string, texts: string[], targetLang: string, sourceLang: string) {
    switch (service) {
        case TRANS_SERVICE.MICROSOFT:
            break
        case TRANS_SERVICE.GOOGLE:
            break
    }
}

const serviceTokenMap = new Map<string, Token>()
let tokenUrl = "https://edge.microsoft.com/translate/auth"

export default defineBackground(() => {
    // let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiNzg3ZWY2OGItNzBmYi00YWNhLWI4NTItZDIwNDg2N2JiNWYxIiwiaWQiOjQsInVzZXJuYW1lIjoiemhlbmciLCJuaWNrTmFtZSI6InpoZW5nIiwiYXV0aG9yaXR5SWQiOjg4OCwicm9sZXMiOlsidXNlciJdLCJidWZmZXJUaW1lIjo4NjQwMCwiaXNzIjoicW1QbHVzIiwic3ViIjoiemhlbmciLCJhdWQiOlsiR1ZBIl0sImV4cCI6MTcxOTA0NDMxMCwibmJmIjoxNzE4NDM5NTEwfQ.Hcei36lYGdfG3H2DAwrpkfcGR5n_hvG4Ovjxi1avLx4"
    // // 创建一个新的fetch函数，该函数在每个请求中添加Authorization头
    // const authFetch = (url, opts) => {
    //     opts.headers.set('Authorization', `Bearer ${token}`);
    //     opts.headers.set('Content-Type', 'application/json');
    //     return fetch(url, opts);
    // };
    const mutex = new Mutex();
    initTokenMap()
    let username = 'zheng';
    // 创建一个使用自定义fetch函数的PouchDB实例
    // const remoteDb = new PouchDB('http://localhost:5984/userdb-' + username, {fetch: authFetch});
    const remoteDb = new PouchDB('http://localhost:5984/userdb-' + username, {
        auth: {
            username: 'admin',
            password: 'wang'
        }
    });
    let db = new PouchDB('userdb');
    // const remoteDb = new PouchDB('http://localhost:5984/userdb-' + "username", {auth:{username:'admin',password:'password'}});
    // todo synchronize with the remote database
    db.sync(remoteDb, {
        live: true,  // real time synchronization
        retry: true  // If the connection drops, it is automatically retried
    }).on('change', function (info) {
        // triggered every time the data changes
        // console.log('remote db change: ',info);
    }).on('paused', function (err) {
        // triggered when sync is paused (ERR is passed in if there are unresolved errors)
        // console.log(err);
    }).on('active', function () {
        // triggered when synchronization resumes
        // console.log('Sync resumed');
    }).on('denied', function (err) {
        // if a document cannot be copied for validation or security reasons, the denied event is triggered
        // console.log(err);
    }).on('complete', function (info) {
        // triggered when synchronization is complete
        // console.log(info);
    }).on('error', function (err) {
        // triggered when there is a synchronization error
        // console.log(err);
    });

    const ruleStorage = RuleStorage.getInstance(db)
    const domainStorage = DomainStorage.getInstance(db)
    const configStorage = ConfigStorage.getInstance(db)

    function updateContextMenu(tabId: number) {
        console.log('updateContextMenu', tabId)
        let tabTranslateStatusKey = "tabTranslateStatus#" + tabId
        // browser.contextMenus.update("translate", {
        //     title: browser.i18n.getMessage('contextMenuOriginal'),
        // })
        // return
        browser.storage.session.get(tabTranslateStatusKey).then((value) => {
            let isTranslate = value[tabTranslateStatusKey] as boolean
            console.log('isTranslate:', isTranslate, "value", value)
            if (isTranslate) {
                browser.contextMenus.update("translate", {
                    title: browser.i18n.getMessage('contextMenuOriginal'),
                })
            } else {
                browser.contextMenus.update("translate", {
                    title: browser.i18n.getMessage('contextMenuTranslate'),
                })
            }
        })
    }


    browser.runtime.onMessage.addListener((message, sender, sendResponse: (t: any) => void) => {
        // messages are received to manipulate the db database
        console.log('background onMessage', message)
        switch (message.action) {
            case "getAccessToken":
                // console.log("getAccessToken", serviceTokenMap.get("microsoft"))
                let service: string = message.data.service
                if (serviceTokenMap && serviceTokenMap.get(service) && (serviceTokenMap.get(service)?.expireTime || 0) > Date.now()) {
                    sendResponse({status: STATUS_SUCCESS, data: serviceTokenMap.get(service)})
                    return
                }
                // todo support other service
                getMicrosoftToken().then((token) => {
                    sendResponse({status: STATUS_SUCCESS, data: token})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: new Token("", 0)})
                })
                break
            case "translateHtml":
                // console.log("translateHtml", message)
                // let service: string = message.data.service || TRANS_SERVICE.MICROSOFT
                // //message.data.elements, message.data.targetLang, message.data.sourceLang
                // translateHtml(service, message.texts, message.data.targetLang, message.data.sourceLang)
                break
            case "addRule":
                try {
                    ruleStorage.add(message.data.domain, message.data.data).then(() => {
                        sendResponse({status: STATUS_SUCCESS, data: "add success"});
                    })
                } catch (e) {
                    sendResponse({status: STATUS_FAIL, data: "add fail"});
                }
                break
            case "deleteRule":
                try {
                    ruleStorage.delete(message.data.domain, message.data.data).then(() => {
                        sendResponse({status: STATUS_SUCCESS, data: "delete success"});
                    })
                } catch (e) {
                    sendResponse({status: '500', data: "delete fail"});
                }
                break
            case "listRule":
                try {
                    ruleStorage.list(message.data.domain).then((data) => {
                        sendResponse({status: STATUS_SUCCESS, data: data});
                    })
                } catch (e) {
                    sendResponse({status: '500', data: "list fail"});
                }
                break
            case "deleteRuleList":
                try {
                    ruleStorage.deleteList(message.data.domain, message.data.data).then(() => {
                        sendResponse({status: STATUS_SUCCESS, data: "delete success"});
                    })
                } catch (e) {
                    sendResponse({status: '500', data: "delete fail"});
                }
                break
            case "getAllRule":
                try {
                    let allRule = ruleStorage.getAll().then(value => {
                        sendResponse({status: '200', data: value})
                    });
                    // sendResponse(allRule)

                    // sendResponse.bind({ status: '200', data: allRule  });
                } catch (e) {
                    // console.log(e)
                    sendResponse({status: '500', data: null});
                }
                break
            case "searchRule":
                ruleStorage.search(message.data.domain).then(value => {
                    sendResponse({status: '200', data: value})
                }).catch((e) => {
                    sendResponse({status: '500', data: e.message})
                });
                break
            case "getDomain":
                domainStorage.get(message.data.domain).then(data => {
                    sendResponse({status: STATUS_SUCCESS, data: data})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                })

                // sendResponse({status: STATUS_SUCCESS, data: data})
                break
            case "updateDomain":
                domainStorage.update(message.data).then(() => {
                    sendResponse({status: STATUS_SUCCESS, data: "insert success"});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: "insert fail"});
                });
                break
            // get the configuration
            case "getConfig":
                console.log('getConfig', message.data)
                configStorage.getConfigItem(message.data.name).then((value) => {
                    // console.log(value)
                    sendResponse({status: STATUS_SUCCESS, data: value})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                })
                break
            case "setConfig":
                configStorage.setConfigItem(message.data.name, message.data.value).then(() => {
                    sendResponse({status: STATUS_SUCCESS, data: "insert success"});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: "insert fail"});
                });
                break
            // get the language of the tab
            case "getTabLanguage":
                // try get tabId from message data and sender tab
                let tabId = sender.tab?.id || message.data.id
                if (!tabId) {
                    sendResponse({status: STATUS_FAIL, data: "tabId is null"});
                    return
                }
                let url = sender.tab?.url || message.data.url
                if (!url.startsWith('http')) {
                    sendResponse({status: STATUS_FAIL, data: "url is not http or https"});
                    return
                }
                browser.tabs.detectLanguage(tabId).then((lang) => {
                    sendResponse({status: STATUS_SUCCESS, data: lang});
                })
                break;
            // get browser native language
            case "getNativeLanguage":
                // let lang = browser.i18n.getUILanguage()
                sendResponse({status: STATUS_SUCCESS, data: navigator.language});
                break
            case "getTabDomain":
                browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
                    let urlString = tabs?.[0]?.url
                    if (!urlString) {
                        sendResponse({status: STATUS_FAIL, data: "url is null"});
                        return
                    }
                    let url = new URL(urlString)
                    // console.log(url)
                    sendResponse({status: STATUS_SUCCESS, data: url.hostname})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                });
                break
            case "getTabId":
                browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
                    let tab = tabs[0].id
                    sendResponse({status: STATUS_SUCCESS, data: tab})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                });
                break
            case "setSessionStorage":
                let key = message.data.key
                if (!key || key.endsWith("null") || key.endsWith("undefined") || message.data.value == undefined || message.data.value === "" || message.data.value === "null" || message.data.value === "undefined") {
                    console.log('value is null or empty', key, message.data.value)
                    sendResponse({status: STATUS_FAIL, data: "value is null or empty"});
                    return
                }
                browser.storage.session.set({[key]: message.data.value}).then(() => {
                    sendResponse({status: STATUS_SUCCESS, data: "insert success"});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                });
                break
            case "getSessionStorage":
                browser.storage.session.get(message.data.key).then((value) => {
                    sendResponse({status: STATUS_SUCCESS, data: value[message.data.key]});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                });
                break
            case "showContextMenu":
                console.log('showContextMenu', message.data)
                // updateContextMenu(message.data as number)
                break
            case "contextMenuSwitch":
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
            default:
                break
        }
        return true
    });
    let isTranslate = false

    // add context menu to translate page
    configStorage.getConfigItem(CONFIG_KEY.CONTEXT_MENU_SWITCH).then((value) => {
        console.log("contextMenuSwitch", value);
        value = value === undefined ? true : value
        if (value) {
            browser.contextMenus.create({
                id: "translate",
                title: browser.i18n.getMessage('contextMenuTranslate'),
                contexts: ["selection", "page"]
            });
        }
    })

    browser.contextMenus.onClicked.addListener((info, tab) => {
        console.log('contextMenus.onClicked', info, tab)
        if (!tab || !tab.id) {
            return
        }
        if (!isTranslate) {
            browser.tabs.sendMessage(tab.id, {action: TRANS_ACTION.TRANSLATE});
        } else {
            browser.tabs.sendMessage(tab.id, {action: TRANS_ACTION.ORIGIN});
        }

    })

    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'session') {
            console.log('Storage updated:', changes);
            for (let changesKey in changes) {
                let tabStatus = changesKey.split("#")
                if (tabStatus.length !== 2) {
                    continue
                }
                if (tabStatus[0] === "tabTranslateStatus" && activeTabId === parseInt(tabStatus[1])) {
                    isTranslate = changes[changesKey].newValue as boolean
                    if (isTranslate) {
                        browser.contextMenus.update("translate", {
                            title: browser.i18n.getMessage('contextMenuOriginal'),
                        })
                    } else {
                        browser.contextMenus.update("translate", {
                            title: browser.i18n.getMessage('contextMenuTranslate'),
                        })
                    }

                }
            }
        }
    });

    let activeTabId: number = 0
    // Listen for tab activation events
    browser.tabs.onActivated.addListener(async (activeInfo) => {
        // only process http or https url
        let tab = await browser.tabs.get(activeInfo.tabId)
        if (!tab?.url?.startsWith('http')) {
            return
        }
        console.log('tabs.onActivated', activeInfo)
        // get current tab translate status
        let tabTranslateStatusKey = "tabTranslateStatus#" + activeInfo.tabId
        browser.storage.session.get(tabTranslateStatusKey).then((value) => {
            isTranslate = value[tabTranslateStatusKey] as boolean
            if (isTranslate) {
                browser.contextMenus.update("translate", {
                    title: browser.i18n.getMessage('contextMenuOriginal'),
                })
            }else {
                browser.contextMenus.update("translate", {
                    title: browser.i18n.getMessage('contextMenuTranslate'),
                })
            }
        })
        activeTabId = activeInfo.tabId;
    });

    // process shortcut key command
    browser.commands.onCommand.addListener((command) => {
        if (command === 'shortcut-toggle') {
            // send message to current tab, toggle translate status
            browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
                let tab: Tab = tabs[0]
                if (!tab || !tab.id) {
                    return
                }
                browser.tabs.sendMessage(tab.id, {action: TRANS_ACTION.TOGGLE});
            });
        }
    });

    async function getMicrosoftToken(): Promise<Token> {
        const release = await mutex.acquire(); // Acquire the lock
        try {
            let tokenFromDB: Token = await configStorage.getConfigItem(CONFIG_KEY.MICROSOFT_TOKEN)
            // if token is null or "" and token is expired, get token from server
            if (tokenFromDB == null || tokenFromDB.token == "" || (tokenFromDB.expireTime || 0) < Date.now()) {
                let token = await fetch(tokenUrl).then(response => response.text());
                // save token to db
                let freshToken = new Token(token, Date.now() + 10 * 60 * 1000)
                await configStorage.setConfigItem(CONFIG_KEY.MICROSOFT_TOKEN, freshToken)
                return freshToken
            }
            return tokenFromDB
        } catch (e) {
            console.error(e)
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
