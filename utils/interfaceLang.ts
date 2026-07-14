import { browser } from 'wxt/browser';
import { INTERFACE_LANGUAGES, type InterfaceLang } from '@/main/constants';
import en from '@/assets/locales/en.json';
import zhCN from '@/assets/locales/zh-CN.json';
import zhTW from '@/assets/locales/zh-TW.json';
import ja from '@/assets/locales/ja.json';
import ko from '@/assets/locales/ko.json';
import fr from '@/assets/locales/fr.json';
import de from '@/assets/locales/de.json';
import es from '@/assets/locales/es.json';
import pt from '@/assets/locales/pt.json';
import it from '@/assets/locales/it.json';
import ru from '@/assets/locales/ru.json';
import hi from '@/assets/locales/hi.json';

/**
 * Single source of truth for interface-language dictionaries and language
 * resolution, shared by every surface (popup/options i18next, the AI Writing
 * content-script i18n, and the background's context-menu strings). Adding a
 * language = generate its JSON via .dev/generateI18nJsonFile.ts, add it to
 * INTERFACE_LANGUAGES in main/constants.ts, and import it here — nothing
 * else needs to change.
 */
export const INTERFACE_LOCALES: Record<InterfaceLang, Record<string, string>> = {
    'en': en as Record<string, string>,
    'zh-CN': zhCN as Record<string, string>,
    'zh-TW': zhTW as Record<string, string>,
    'ja': ja as Record<string, string>,
    'ko': ko as Record<string, string>,
    'fr': fr as Record<string, string>,
    'de': de as Record<string, string>,
    'es': es as Record<string, string>,
    'pt': pt as Record<string, string>,
    'it': it as Record<string, string>,
    'ru': ru as Record<string, string>,
    'hi': hi as Record<string, string>,
};

/** Validate an arbitrary value (config/db/message payload) as a supported language. */
export function normalizeInterfaceLang(v: unknown): InterfaceLang | undefined {
    return INTERFACE_LANGUAGES.some((l) => l.value === v) ? (v as InterfaceLang) : undefined;
}

/**
 * Map the browser UI language to the closest supported interface language.
 * Traditional-script Chinese (zh-TW / zh-HK / zh-Hant-*) maps to zh-TW, any
 * other zh to zh-CN; every other language matches on its base code.
 */
export function detectInterfaceLang(): InterfaceLang {
    const ui = (browser.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en').toLowerCase();
    if (ui.startsWith('zh')) {
        return /^zh-(tw|hk|mo|hant)/.test(ui) ? 'zh-TW' : 'zh-CN';
    }
    const base = ui.split('-')[0];
    return normalizeInterfaceLang(base) ?? 'en';
}
