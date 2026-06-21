import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/assets/locales/en.json';
import zhCN from '@/assets/locales/zh-CN.json';
import { browser } from 'wxt/browser';
import { ACTION, CONFIG_KEY } from '@/main/constants';
import { getConfig } from '@/utils/db';

const detectLng = () => {
  const ui = browser.i18n?.getUILanguage?.() || navigator.language;
  return ui.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

const isSupported = (v: unknown): v is 'en' | 'zh-CN' =>
  v === 'en' || v === 'zh-CN';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: detectLng(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

void (async () => {
  const stored = await getConfig(CONFIG_KEY.INTERFACE_LANGUAGE);
  if (isSupported(stored) && stored !== i18n.language) {
    await i18n.changeLanguage(stored);
  }
})();

browser.runtime.onMessage.addListener((msg: any) => {
  if (msg?.action === ACTION.INTERFACE_LANGUAGE_CHANGED && isSupported(msg.data)) {
    void i18n.changeLanguage(msg.data);
  }
});

export default i18n;
