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
 * `browser.runtime.sendMessage` does not always return a promise: from an
 * orphaned context — a content script whose extension was reloaded or updated
 * while its page stayed open — it throws *synchronously* ("Extension context
 * invalidated.", and on some paths "Could not establish connection. Receiving
 * end does not exist."). A `.catch()` chained onto the call is then never
 * attached, and because both wrappers below issue the call inside a `new
 * Promise` executor the throw is converted into a rejection of that promise —
 * which every fire-and-forget caller (`void sendMessageToBackground(…)`)
 * reports as "Uncaught (in promise)".
 *
 * So the call has to be made inside a try/catch, and the failure normalized to
 * the same shape as an async rejection.
 */
export function runtimeSendMessage(message: Message): Promise<any> {
    try {
        return browser.runtime.sendMessage(message)
    } catch (e) {
        return Promise.reject(e)
    }
}

/**
 * Fire-and-forget notification to the background: never throws, never rejects,
 * returns nothing. Use it instead of a bare
 * `browser.runtime.sendMessage(…).catch(() => {})` — that idiom is repeated all
 * over the UI surfaces and, as {@link runtimeSendMessage} explains, it does not
 * actually cover the synchronous-throw case it was written for.
 */
export function notifyBackground(message: Message): void {
    runtimeSendMessage(message).catch(() => { })
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
            runtimeSendMessage(message).then((response) => {
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
                    console.log(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} ${response.data}`);
                }
            }).catch((e) => {
                // A rejection here (e.g. "Could not establish connection / receiving
                // end does not exist" during an MV3 SW cold-start race) would
                // otherwise be swallowed and hang until the timeout below. Fail
                // fast instead of waiting out the full timeout.
                clearTimeout(timeoutId)
                resolve(undefined)
                console.log(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} error`, e)
            });
        }),
        new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                resolve(undefined)
                console.log(APP_NAME_WITH_SUFFIX, `sendMessageToBackground ${message.action} Request timeout`)
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
 * An error that was actually raised in the background service worker.
 *
 * The throw crosses a process boundary, so the local stack only records the
 * `sendMessage` call — useless for diagnosis. `failResponse` in
 * main/messageBridge.ts ships the originating name/stack/scope over the wire
 * and they are re-attached here, so whoever reports this error can print where
 * it really came from. See main/errorReport.ts, which consumes these fields.
 */
export class BackgroundRequestError extends Error {
    /** ACTION that was being handled. */
    readonly action: string
    /** Handler label from the background side, e.g. "Translate texts". */
    readonly scope?: string
    /** `error.name` as thrown in background (e.g. "TypeError"). */
    readonly originalName?: string
    /** `error.stack` as thrown in background. */
    readonly backgroundStack?: string
    /**
     * Structured payload attached by the thrower, for failures the caller can
     * act on instead of only display (see `failResponse` in
     * main/messageBridge.ts). Pair this with {@link originalName} to know what
     * shape to expect.
     */
    readonly detail?: Record<string, any>

    constructor(action: string, data: any) {
        super(failureMessage(action, data))
        this.name = 'BackgroundRequestError'
        this.action = action
        if (data && typeof data === 'object') {
            this.scope = typeof data.scope === 'string' ? data.scope : undefined
            this.originalName = typeof data.name === 'string' ? data.name : undefined
            this.backgroundStack = typeof data.stack === 'string' ? data.stack : undefined
            this.detail = data.detail && typeof data.detail === 'object' ? data.detail : undefined
        }
    }
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
            runtimeSendMessage(message).then((response) => {
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
                    reject(new BackgroundRequestError(message.action, response.data))
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
 * Deliver a message to one tab, treating "nobody is listening" as a normal
 * outcome rather than an error.
 *
 * `tabs.sendMessage` rejects with "Could not establish connection. Receiving end
 * does not exist." whenever the target tab has no live content script. A URL
 * check cannot rule that out: reloading or updating the extension orphans the
 * content script of every already-open tab (the page keeps its old http URL but
 * the script is gone), and injection also fails on the PDF viewer, the Chrome
 * Web Store and any page that was open before install. Every caller here is
 * fire-and-forget with nothing to retry, so the rejection has no consumer — left
 * unhandled it surfaces as "Uncaught (in promise) Error: Could not establish
 * connection" in the popup and lands in chrome://extensions › Errors. Worse, in
 * `App.tsx` it skipped the `.then(() => window.close())` after a translate
 * toggle, leaving the popup stuck open.
 *
 * Real errors (a throwing content handler) are still logged.
 */
function sendToTabQuietly(tabId: number, message: Message): Promise<any> {
    return browser.tabs.sendMessage(tabId, message).catch((e) => {
        const reason = e instanceof Error ? e.message : String(e)
        if (!reason.includes('Receiving end does not exist') &&
            !reason.includes('Could not establish connection')) {
            console.log(APP_NAME_WITH_SUFFIX, `sendMessageToTab ${message.action} error`, e)
        }
        return null
    })
}

/**
 * Sends a message to the currently active and valid tab.
 *
 * @param message The message to send.
 * @returns A promise that resolves with the response data, or null when the tab
 *          has no content script to receive it.
 */
export async function sendMessageToTab(message: Message) {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true })
    if (tabs.length === 0) {
        return null
    }
    console.log("sendMessageToTab:", tabs[0]?.id, tabs[0]?.url);
    if (!tabs[0].id || !tabs[0].url?.startsWith('http')) {
        return null
    }
    return sendToTabQuietly(tabs[0].id, message)
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
    // Deliberately NOT awaited: the content-side onMessage listener is `async`,
    // so its reply only arrives once the handler finishes — for TRANSLATE that
    // is a whole page translation. Awaiting every tab would stall the caller
    // (and the popup) for seconds. Only the delivery failure is handled, via
    // sendToTabQuietly.
    tabs.forEach(tab => {
        if (!tab.id || !tab.url?.startsWith('http')) {
            return
        }
        if (tab.id == activeTab?.id) {
            let messageCopy = structuredClone(message)
            messageCopy.active = true
            resp = sendToTabQuietly(tab.id, messageCopy)
            return;
        }
        sendToTabQuietly(tab.id, message)
    })
    return resp
}