// utils.js
import { browser } from "wxt/browser"
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
 * @returns the response of the active tab.
 */
export async function sendMessageToAllTabs(message: Message) {
    let tabs = await browser.tabs.query({})
    let activeTab = await browser.tabs.query({ active: true, currentWindow: true })
    if (activeTab.length !== 1) {
        return
    }
    let resp: any
    await Promise.all(tabs.map(tab => {
        if (!tab.url?.startsWith('http')) {
            return
        }
        if (tab.id == activeTab?.[0]?.id) {
            let messageCopy = structuredClone(message)
            messageCopy.active = true
            resp = browser.tabs.sendMessage(Number(tab.id), messageCopy)
            return;
        }
        browser.tabs.sendMessage(Number(tab.id), message)
    }))
    return resp
}