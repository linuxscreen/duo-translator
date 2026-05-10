import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

const detectLng = () => {
  const ui = browser.i18n?.getUILanguage?.() || navigator.language;
  return ui.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
};

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

export default i18n;
