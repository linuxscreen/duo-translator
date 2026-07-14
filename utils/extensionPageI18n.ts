import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ACTION, CONFIG_KEY } from '@/main/constants';
import { getConfig } from '@/utils/db';
import {
  INTERFACE_LOCALES,
  detectInterfaceLang,
  normalizeInterfaceLang,
} from '@/utils/interfaceLang';

// Shared i18next bootstrap for the extension pages (popup + options). Each
// entrypoint bundle gets its own instance; both follow the same source of
// truth: CONFIG_KEY.INTERFACE_LANGUAGE, falling back to the browser UI language.
void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(INTERFACE_LOCALES).map(([lang, dict]) => [lang, { translation: dict }]),
  ),
  lng: detectInterfaceLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

void (async () => {
  const stored = normalizeInterfaceLang(await getConfig(CONFIG_KEY.INTERFACE_LANGUAGE));
  if (stored && stored !== i18n.language) {
    await i18n.changeLanguage(stored);
  }
})();

browser.runtime.onMessage.addListener((msg: any) => {
  if (msg?.action !== ACTION.INTERFACE_LANGUAGE_CHANGED) return;
  const lang = normalizeInterfaceLang(msg.data);
  if (lang) void i18n.changeLanguage(lang);
});

export default i18n;
