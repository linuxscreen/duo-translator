import { useSyncExternalStore } from "react";
import { browser } from "wxt/browser";
import { ACTION, CONFIG_KEY } from "@/main/constants";
import { getConfig } from "@/utils/db";
import enJson from "@/assets/locales/en.json";
import zhCNJson from "@/assets/locales/zh-CN.json";

/**
 * Reactive i18n for the AI Writing content-script UI.
 *
 * Why not `browser.i18n.getMessage` (chrome `_locales`): that API resolves
 * against the *browser UI language*, ignoring the user's choice made in
 * Options. The popup/options pages drive their own i18next from
 * `CONFIG_KEY.INTERFACE_LANGUAGE` and broadcast config value
 * when the user changes it — content scripts must follow the same source
 * of truth, or the floating dot stays English when Options is switched to
 * Chinese.
 *
 * Why not full react-i18next: each content-script Shadow DOM mount would
 * need its own provider, and we only need 2 languages with flat keys. A
 * 60-line subscription is enough.
 */

type Lang = "en" | "zh-CN";
type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = {
    "en": enJson as Dict,
    "zh-CN": zhCNJson as Dict,
};

function detectInitial(): Lang {
    const ui = (browser.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase();
    return ui.startsWith("zh") ? "zh-CN" : "en";
}

let currentLang: Lang = detectInitial();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((cb) => cb());

const setLang = (next: unknown) => {
    if ((next === "en" || next === "zh-CN") && next !== currentLang) {
        currentLang = next;
        notify();
    }
};

// One-shot hydration from db. db value wins over browser UI lang.
void getConfig(CONFIG_KEY.INTERFACE_LANGUAGE).then((stored) => setLang(stored));

// Live updates broadcast from the options page when the user changes language.
browser.runtime.onMessage.addListener((msg: any) => {
    if (msg?.action === ACTION.INTERFACE_LANGUAGE_CHANGED) setLang(msg.data);
});

/**
 * Pure string lookup against the current language, with an English
 * fallback. Safe to call from anywhere (event handlers, plain helpers).
 * Components that call this inside render must also subscribe via
 * `useLang()` so they re-render on language changes.
 */
export function t(key: string, fallback: string): string {
    return DICTS[currentLang][key] ?? DICTS.en[key] ?? fallback;
}

/**
 * React hook — subscribes the calling component to language changes so its
 * `t(...)` calls produce fresh translations after a switch. Return value
 * is the current language code (rarely needed; usually called for the
 * subscription side-effect).
 */
export function useLang(): Lang {
    return useSyncExternalStore(
        (cb) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
        () => currentLang,
    );
}
