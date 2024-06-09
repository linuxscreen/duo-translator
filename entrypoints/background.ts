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
    constructor(domain: string, strategy? : DOMAIN_STRATEGY, viewStrategy?: VIEW_STRATEGY) {
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

    constructor() {
        this.db = new PouchDB('config');
        console.log("construct init db")
        // 获取 JWT 令牌（假设你已经从身份验证系统中获得了 JWT 令牌）
        const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1dWlkIjoiNzg3ZWY2OGItNzBmYi00YWNhLWI4NTItZDIwNDg2N2JiNWYxIiwiaWQiOjQsInVzZXJuYW1lIjoiemhlbmciLCJuaWNrTmFtZSI6InpoZW5nIiwiYXV0aG9yaXR5SWQiOjk5OSwicm9sZXMiOlsidXNlciJdLCJidWZmZXJUaW1lIjo4NjQwMCwiaXNzIjoicW1QbHVzIiwic3ViIjoiemhlbmciLCJhdWQiOlsiR1ZBIl0sImV4cCI6MTcxODQ1OTczOSwibmJmIjoxNzE3ODU0OTM5fQ.UsR9ePixj1YoYBcNUd8_rc9BXaX72HVMzguiKhv1vKg';
        //远程同步
        let url = 'http://localhost:5984/userdb-zheng';//每个用户一个数据库
        // let url = 'http://localhost:8080/api/customer/demo/config';
        let remoteDb = new PouchDB(url,{
            fetch: function (url, opts) {
                // 添加 JWT 令牌到请求头部
                opts.headers = {};
                opts.headers.Authorization = `Bearer ${jwtToken}`;
                opts.headers['Content-Type'] = 'application/json';
                return PouchDB.fetch(url, opts);
            }
        });
        //设置token
        this.db.sync(remoteDb,{
            live: true,
            retry: true
        }).on('change', function (change) {
            console.log('yo, something changed!');
            // yo, something changed!
        }).on('paused', function (info) {
            // replication was paused, usually because of a lost connection
        }).on('active', function (info) {
            // replication was resumed
        }).on('error', function (err) {
            // totally unhandled error (shouldn't happen)

        })
    }

    public static getInstance(): ConfigStorage {
        if (!ConfigStorage.instance) {
            ConfigStorage.instance = new ConfigStorage();
        }
        return ConfigStorage.instance;
    }

    async setConfigItem(name :string, value :string) {
        return this.db.put({
            _id: name,
            value: value,
            owner: 'wang'
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
        return this.db.get(name).then(doc => doc.value);
    }


}

class DomainStorage {
    private static instance: DomainStorage;
    db: PouchDB.Database;

    constructor() {
        this.db = new PouchDB('domains');
    }

    public static getInstance(): DomainStorage {
        if (!DomainStorage.instance) {
            DomainStorage.instance = new DomainStorage();
        }
        return DomainStorage.instance;
    }

    public add(domain :Domain) {
        console.log(domain)
        this.db.put({
            _id: domain.domain,
            strategy: domain.strategy,
            viewStrategy: domain.viewStrategy
        }).then(() => {
            console.log('Domain added successfully: ${domain.domain}');
        }).catch((err) => {
            console.error('Error adding domain: ${domain.strategy}', err);
        });
    }

    public get(domain: string) : Promise<any>  {
       return this.db.get(domain).then((doc) => {
            console.log(`Domain found: ${domain}`);
            console.log(`doc ${doc._id}`)
            return doc;
        }).catch((err) => {
            console.error(`Error finding domain: ${domain}`, err);
        });
    }

    public delete(domain: string) {
        this.db.get(domain).then((doc) => {
            return this.db.remove(doc);
        }).then(() => {
            console.log('Domain deleted successfully: ${domain}');
        }).catch((err) => {
            console.error('Error deleting domain: ${domain}', err);
        });
    }

    public update(domain :Domain)  {
        return this.db.get(domain.domain).then((doc) => {
            if (domain.strategy) {
                doc.strategy = domain.strategy;
            }
            if (domain.viewStrategy) {
                doc.viewStrategy = domain.viewStrategy;
            }
            console.log(doc)
            return this.db.put(doc);
        }).then(() => {
            console.log(`Domain updated successfully: ${domain.domain}`);
        }).catch((err) => {
            if (err.name === 'not_found') {
                this.add(domain)
            }else {
                console.error(`Error updating domain: ${domain.domain}`, err);
            }

        });
    }


}

class RuleStorage {
    private static instance: RuleStorage;
    db: PouchDB.Database;

    constructor() {
        this.db = new PouchDB('rules');
    }

    public static getInstance(): RuleStorage {
        if (!RuleStorage.instance) {
            RuleStorage.instance = new RuleStorage();
        }
        return RuleStorage.instance;
    }

    async add(domain: string, rule: SubRule) {
        try {
            const existingDoc: Rule = await this.db.get(domain);
            if (existingDoc.rules.some(r => r.content === rule.content)) {
                console.log('Rule ${rule.content} already exists in domain ${domain}.');
                return;
            }
            existingDoc.rules.push(rule);
            await this.db.put(existingDoc);
            console.log('Rules added successfully to domain ${rule.domain}.');
        } catch (err) {
            if (err.name == "not_found") {
                await this.db.put({
                    _id: domain,
                    rules: [rule]
                });
                console.log('Rules added successfully to domain ${rule.domain}.');
                return
            }
            console.error('Error adding rules to domain ${rule.domain}: ', err);
        }
    }

    async delete(domain: string, ruleContent: string) {
        try {
            const doc: Rule = await this.db.get(domain);
            console.log(ruleContent)
            doc.rules = doc.rules.filter(rule => rule.content !== ruleContent);
            console.log(doc.rules)
            await this.db.put(doc);
            console.log('Rule ${ruleTitle} deleted successfully from domain ${domain}.');
        } catch (err) {
            console.error('Error deleting rule ${ruleTitle} from domain ${domain}: ', err);
        }
    }

    async search(domain?: string, ruleTitle?: string, ruleContent?: string) {
        try {
            const allDocs = await this.db.allDocs({include_docs: true});
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
            const result = await this.db.allDocs({include_docs: true});
            return result.rows.map(row => row.doc);
        } catch (err) {
            console.error('Error getting all rules: ', err);
        }
    }
}

export default defineBackground(() => {
    console.log(browser.i18n.getMessage('extName'));
     console.log(i18n.global.t('some-key'));
    const db = RuleStorage.getInstance()
    const domainDb = DomainStorage.getInstance()
    const configDb = ConfigStorage.getInstance()
    // const db = RuleStorage.getInstance()
    // await db.add("www.qq.com",new SubRule("所有内容", "#content"))
    // let all = await db.search("www.qq.com")
    // console.log(all)
    // // let db = new PouchDB("urls")
    console.log('Hello background!', {id: browser.runtime.id});
// background.ts
//     browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
//         console.log(message); // "ping"
//
//         // Wait 1 second and respond with "pong"
//         setTimeout(() => sendResponse('pong'), 1000);
//         return true
//         // return Promise.resolve("hello")
//     });

    browser.runtime.onMessage.addListener((message, sender, sendResponse: (t: any) => void) => {
        //收到消息是操作db数据库，包括增删改查
        switch (message.action) {
            case "addRule":
                try {
                    db.add(message.data.domain, message.data.subRule).then(() => {
                        sendResponse({status: STATUS_SUCCESS, data: "add success"});
                    })
                } catch (e) {
                    sendResponse({status: STATUS_FAIL, data: "add fail"});
                }
                break
            case "deleteRule":
                try {
                    db.delete(message.data.domain, message.data.ruleContent).then(() => {
                        sendResponse({status: STATUS_SUCCESS, data: "delete success"});
                    })
                } catch (e) {
                    sendResponse({status: '500', data: "delete fail"});
                }
                break
            case "getAllRule":
                try {
                    let allRule = db.getAll().then(value => {
                        sendResponse({status: '200', data: value})
                    });
                    // sendResponse(allRule)

                    // sendResponse.bind({ status: '200', data: allRule  });
                } catch (e) {
                    console.log(e)
                    sendResponse({status: '500', data: null});
                }
                break
            case "searchRule":
                db.search(message.data.domain).then(value => {
                    sendResponse({status: '200', data: value})
                }).catch((e) => {
                    sendResponse({status: '500', data: e.message})
                });
                break
            case "getDomain":
                domainDb.get(message.data.domain).then(data=>{
                    sendResponse({status: STATUS_SUCCESS, data: data})
                }).catch((e)=>{
                    sendResponse({status: STATUS_FAIL, data: e.message})
                })

                // sendResponse({status: STATUS_SUCCESS, data: data})
                break
            case "updateDomain":
                domainDb.update(message.data).then(() => {
                    sendResponse({status: STATUS_SUCCESS, data: "insert success"});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: "insert fail"});
                });
                break
            // 获取配置
            case "getConfig":
                configDb.getConfigItem(message.data.name).then((value) => {
                    console.log(value)
                    sendResponse({status: STATUS_SUCCESS, data: value})
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: e.message})
                })
                break
            case "setConfig":
                configDb.setConfigItem(message.data.name, message.data.value).then(() => {
                    sendResponse({status: STATUS_SUCCESS, data: "insert success"});
                }).catch((e) => {
                    sendResponse({status: STATUS_FAIL, data: "insert fail"});
                });
                break
            // 获取标签的语言
            case "getTabLanguage":
                console.log(sender.tab?.id)
                browser.tabs.detectLanguage(sender.tab?.id).then((lang) => {
                    sendResponse({status: STATUS_SUCCESS, data: lang});
                })
                break;
            case "getTabDomain":
                browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
                    let tab = tabs[0]
                    let url = new URL(tab.url)
                    console.log(url)
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
                browser.storage.session.set({[key] : message.data.value}).then(() => {
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
    // browser.runtime.onInstalled.addListener(() => {
    //     // // if (reason === 'install') {
    //     // browser.storage.local.set({installDate: '2020'}).then(() => {
    //     //         console.log("success")
    //     //     }
    //     // )
    //     // //生成随机数
    //     // const randomNumber = Math.floor(Math.random() * 100);
    //     // console.log(randomNumber);
    //     // // 生产随机数
    //     // function getRandomInt(max: number) {
    //     //     return Math.floor(Math.random() * max);
    //     // }
    //     // // }
    // });

    // 用户获取tab页面的语言
    // browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    //     switch (message.action) {
    //         case "getTabLanguage":
    //             browser.tabs.detectLanguage(sender.tab.id).then((lang) => {
    //                 sendResponse(lang);
    //             })
    //             break;
    //         case "getTabDomain":
    //             browser.tabs.query({active: true, currentWindow: true}).then((tabs) => {
    //                 let tab = tabs[0]
    //                 let url = new URL(tab.url)
    //                 sendResponse({status: '200', data: url.hostname})
    //             }).catch((e) => {
    //                 sendResponse({status: '500', data: e.message})
    //             });
    //             break
    //         default:
    //             break;
    //     }
    //     return true;
    // });

});
