import {createI18n} from 'vue-i18n';
// Use your default locale when importing the schema
import type schema from '~/assets/locales/en.json';
import messages from '@intlify/unplugin-vue-i18n/messages';

export type I18nSchema = typeof schema;
export type I18nLocales = 'zh' | 'en' | 'ja';

export default createI18n<[I18nSchema], I18nLocales>({
    // get locale from the browser
    locale: getBrowserLocale(),
    messages: messages as any,
});

function getBrowserLocale(): string {
    return navigator.language || navigator.languages[0] || 'en';
}