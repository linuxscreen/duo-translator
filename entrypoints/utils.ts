// utils.js
import {ifError} from "node:assert";
import {DB_ACTION, STATUS_SUCCESS} from "@/entrypoints/constants";

export default defineUnlistedScript(
    () => {
    }
)

export function rgbToHex(rgb :string) {
    // Extract the RGB values
    const result = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
    return result ? "#" +
        ("0" + parseInt(result[1], 10).toString(16)).slice(-2) +
        ("0" + parseInt(result[2], 10).toString(16)).slice(-2) +
        ("0" + parseInt(result[3], 10).toString(16)).slice(-2) : rgb;
}

export class SubRule {
    constructor(title: string, content: string) {
        this.title = title
        this.content = content
    }

    title: string
    content: string
}

export class Rule {
    domain: string;
    rules: Array<SubRule> = [];

    constructor(domain: string, rules?: Array<SubRule>) {
        this.domain = domain;
        if (rules != null) {
            this.rules = rules;
        }
    }
}

type Message = {
    // request: string | ""
    action: DB_ACTION | string
    data?: any
}

/**
 * Sends a message to the background script.
 *
 * @param {Message} message The message to send.
 * @param timeout
 * @returns {Promise<any>} A promise that resolves with the response data.
 * @throws {Error} When the response status is not STATUS_SUCCESS.
 */
export function sendMessageToBackground(message: Message, timeout: number = 5000): Promise<any> {
    let timeoutId: NodeJS.Timeout;
    return Promise.race([
        new Promise((resolve) => {
            browser.runtime.sendMessage(message).then((response) => {
                clearTimeout(timeoutId)
                if (response.status === STATUS_SUCCESS) {
                    resolve(response.data);
                } else {
                    resolve(null)
                    console.warn(`sendMessageToBackground ${message.action} ${response.data}`);
                }
            });
        }),
        new Promise((resolve) => {
            timeoutId = setTimeout(() => {
                resolve(null)
                console.warn(`sendMessageToBackground ${message.action} Request timeout`)
            }, timeout)
        })
    ]);
}

// 给当前活动的tab发送消息
export async function sendMessageToTab(message: Message) {
    let tabs = await browser.tabs.query({active: true, currentWindow: true})
    console.log(tabs)
    browser.tabs.sendMessage(Number(tabs[0].id), message).then((response) => {
        console.log(response)
    });
}


