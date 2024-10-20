import PouchDB from 'pouchdb';
import {STATUS_FAIL, STATUS_SUCCESS, DOMAIN_STRATEGY, VIEW_STRATEGY} from "@/entrypoints/constants";
import {Rule, SubRule} from "@/entrypoints/utils";
import {browser} from "wxt/browser";

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

    async setConfigItem(name: string, value: string) {
        name = this.prefix + name;
        return this.db.put({
            _id: name,
            value: value,
        }).catch(err => {
            if (err.name === 'conflict') {
                return this.db.get(name).then(doc => {
                    doc.value = value;
                    return this.db.put(doc);
                });
            } else {
                throw err;
            }
        });
    }

    async getConfigItem(name: string) {
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
                doc.strategy = domain.strategy;
            }
            if (domain.viewStrategy) {
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
        } catch (err) {
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
            let existRules  = doc.rules
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
                result = result.filter(doc => doc._id.includes(domain));
            }

            if (ruleTitle || ruleContent) {
                result = result.map(doc => {
                    let rules;
                    if (ruleTitle && ruleContent) {
                        rules = doc.rules.filter(rule => rule.title.includes(ruleTitle) && rule.content.includes(ruleContent));
                    } else if (ruleTitle) {
                        rules = doc.rules.filter(rule => rule.title.includes(ruleTitle));
                    } else if (ruleContent) {
                        rules = doc.rules.filter(rule => rule.content.includes(ruleContent));
                    }
                    return {
                        domain: doc._id,
                        rules: rules
                    };
                });
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

export default defineBackground(() => {
    let db = new PouchDB('userdb');
    // const remoteDb = new PouchDB('http://localhost:5984/userdb-' + "username", {auth:{username:'admin',password:'password'}});
    // todo synchronize with the remote database
    // db.sync(remoteDb, {
    //     live: true,  // real time synchronization
    //     retry: true  // If the connection drops, it is automatically retried
    // }).on('change', function (info) {
    //     // triggered every time the data changes
    //     // console.log('remote db change: ',info);
    // }).on('paused', function (err) {
    //     // triggered when sync is paused (ERR is passed in if there are unresolved errors)
    //     // console.log(err);
    // }).on('active', function () {
    //     // triggered when synchronization resumes
    //     // console.log('Sync resumed');
    // }).on('denied', function (err) {
    //     // if a document cannot be copied for validation or security reasons, the denied event is triggered
    //     // console.log(err);
    // }).on('complete', function (info) {
    //     // triggered when synchronization is complete
    //     // console.log(info);
    // }).on('error', function (err) {
    //     // triggered when there is a synchronization error
    //     // console.log(err);
    // });

    const ruleStorage = RuleStorage.getInstance(db)
    const domainStorage = DomainStorage.getInstance(db)
    const configStorage = ConfigStorage.getInstance(db)

    browser.runtime.onMessage.addListener((message, sender, sendResponse: (t: any) => void) => {
        // messages are received to manipulate the db database
        switch (message.action) {
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
                if (!url.startsWith('http')){
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
            default:
                break
        }
        return true
    });

});
