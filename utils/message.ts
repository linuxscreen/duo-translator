// utils.js
import { Browser, browser } from "wxt/browser"
import { APP_NAME_WITH_SUFFIX, STATUS_SUCCESS } from "@/main/constants";

type Message = {
    // request: string | ""
    active?: boolean; // identify the active status of tab
    action: string
    data?: any
}

/**
 * Sends a message to the background script.
 *
 * @param {Message} message The message to send.
 * @param timeout
 * @returns {Promise<any>} A promise that resolves with the response data. Probably is undefined
 * @throws {Error} When the response status is not STATUS_SUCCESS.
 */
export function sendMessageToBackground(message: Message, timeout: number = 5000): Promise<any> {
    let timeoutId: NodeJS.Timeout;
    return Promise.race([
        new Promise((resolve) => {
            browser.runtime.sendMessage(message).then((response) => {
                console.log("sendMessageToBackground response:", response, message);
                clearTimeout(timeoutId)
                if (!response) {
                    resolve(undefined)
                    return
                }
                if (response.status === STATUS_SUCCESS) {
                    resolve(response.data);
                } else {
                    resolve(undefined)
                    console.warn(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} ${response.data}`);
                }
            }).catch((e) => {
                // A rejection here (e.g. "Could not establish connection / receiving
                // end does not exist" during an MV3 SW cold-start race) would
                // otherwise be swallowed and hang until the timeout below. Fail
                // fast instead of waiting out the full timeout.
                clearTimeout(timeoutId)
                resolve(undefined)
                console.warn(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} error`, e)
            });
        }),
        new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                resolve(undefined)
                console.warn(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} Request timeout`)
            }, timeout)
        })
    ]);
}

/**
 * Extract a human-readable reason from a STATUS_FAIL response's `data`.
 *
 * Handlers are inconsistent about the shape: the network handlers reply
 * `{ message }` while the sync handlers reply a bare string. `String(data)` on
 * the former yields "[object Object]", destroying the real error at exactly the
 * point it was meant to be preserved — so unwrap both shapes explicitly.
 */
function failureMessage(action: string, data: any): string {
    if (data && typeof data === 'object' && typeof data.message === 'string' && data.message) {
        return data.message
    }
    if (typeof data === 'string' && data) return data
    return `${action} failed`
}

/**
 * Like {@link sendMessageToBackground}, but rejects with the background's error
 * message on a STATUS_FAIL response (or a timeout) instead of silently
 * resolving `undefined`. Use this when the caller needs to surface the real
 * failure reason (e.g. WebDAV auth errors), not just a generic message.
 *
 * @param {Message} message The message to send.
 * @param timeout
 * @returns {Promise<any>} A promise that resolves with the response data.
 * @throws {Error} When the response status is not STATUS_SUCCESS or on timeout.
 */
export function sendMessageToBackgroundOrThrow(message: Message, timeout: number = 5000): Promise<any> {
    let timeoutId: NodeJS.Timeout;
    return Promise.race([
        new Promise((resolve, reject) => {
            browser.runtime.sendMessage(message).then((response) => {
                clearTimeout(timeoutId)
                // An empty response is the MV3 service-worker cold-start race
                // ("Could not establish connection"). Resolving undefined here
                // would make the OrThrow variant silently not throw on the most
                // common failure of all — reject instead.
                if (!response) {
                    reject(new Error(`${message.action}: no response from background`))
                    return
                }
                if (response.status === STATUS_SUCCESS) {
                    resolve(response.data);
                } else {
                    reject(new Error(failureMessage(message.action, response.data)))
                }
            }).catch((e) => {
                clearTimeout(timeoutId)
                reject(e)
            });
        }),
        new Promise((_resolve, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${message.action} request timeout`))
            }, timeout)
        })
    ]);
}

/**
 * Sends a message to the currently active and valid tab.
 *
 * @param message The message to send.
 * @returns A promise that resolves with the response data.
 */
export async function sendMessageToTab(message: Message) {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true })
    if (tabs.length === 0) {
        return Promise.resolve(null)
    }
    console.log("sendMessageToTab:", tabs[0]?.id, tabs[0]?.url, tabs?.[0].id);
    if (tabs?.[0].url?.startsWith('http')) {
        return browser.tabs.sendMessage(Number(tabs?.[0].id), message)
    } else {
        return Promise.resolve(null)
    }

}

/**
 * send a message to all tabs.
 * If the tab is active, set the active flag to true.
 * @param message The message to send.
 * @param sendActiveFlag If false, the active flag will not be set.
 * @returns the response of the active tab.
 */
export async function sendMessageToAllTabs(message: Message, sendActiveFlag: boolean = true) {
    let tabs = await browser.tabs.query({})
    let activeTab : Browser.tabs.Tab | undefined
    if (sendActiveFlag) {
        let activeTabs = await browser.tabs.query({ active: true, currentWindow: true })
        if (activeTabs.length < 1) {
            return
        }
        activeTab = activeTabs[0]
    }
    let resp: any
    await Promise.all(tabs.map(tab => {
        if (!tab.url?.startsWith('http')) {
            return
        }
        if (tab.id == activeTab?.id) {
            let messageCopy = structuredClone(message)
            messageCopy.active = true
            resp = browser.tabs.sendMessage(Number(tab.id), messageCopy)
            return;
        }
        browser.tabs.sendMessage(Number(tab.id), message)
    }))
    return resp
}