import { CONFIG_KEY, DB_ACTION } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";

export async function setConfig(key: CONFIG_KEY, value: any) {
    return sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: { name: key, value: value }
    });
}

export async function getConfig(key: CONFIG_KEY): Promise<any> {
    return sendMessageToBackground({
        action: DB_ACTION.CONFIG_GET,
        data: { name: key }
    });
}

export function addRuleToDB(domain : string, rule: string) {
    sendMessageToBackground({ action: DB_ACTION.RULES_ADD, data: { domain: domain, data: rule } })
}

export function listRuleFromDB(domain : string) {
    return sendMessageToBackground({ action: DB_ACTION.RULES_LIST, data: { domain: domain } })
}

export function deleteRuleFromDB(domain : string, rule: string) {
    sendMessageToBackground({ action: DB_ACTION.RULES_DEL, data: { domain: domain, data: rule } })
}