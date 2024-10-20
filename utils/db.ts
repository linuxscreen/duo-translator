import {CONFIG_KEY, DB_ACTION} from "@/entrypoints/constants";
import {sendMessageToBackground} from "@/entrypoints/utils";

export async function setConfig(key: CONFIG_KEY, value: any) {
    return sendMessageToBackground({
        action: DB_ACTION.CONFIG_SET,
        data: {name: key, value: value}
    });
}

export async function getConfig(key: CONFIG_KEY): Promise<any> {
    return sendMessageToBackground({
        action: DB_ACTION.CONFIG_GET,
        data: {name: key}
    });
}