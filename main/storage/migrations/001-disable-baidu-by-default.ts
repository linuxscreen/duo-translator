import { CONFIG_KEY, TRANSLATE_SERVICE } from '@/main/constants';
import { STORAGE_PREFIX } from '../configStore';
import type { Migration } from './types';

const DISABLED_SERVICES = `${STORAGE_PREFIX.CONFIG}${CONFIG_KEY.DISABLED_TRANSLATE_SERVICES}`;

/**
 * Baidu needs credentials, so it starts out disabled like DeepL / Azure /
 * Google Cloud. The default list says so, but a list that was stored before
 * Baidu existed does not mention it, which would present it as enabled.
 *
 * Deliberately NOT conditional on the Baidu credentials being absent: the
 * secret is not synced, so a second device would decide differently from the
 * first and push its answer back. Whoever enables Baidu afterwards does so
 * with a newer clock than this write, and that is what keeps it enabled.
 */
export const disableBaiduByDefault: Migration = {
    version: 1,
    name: 'disable-baidu-by-default',
    // The day Baidu support was merged (#69) — before any release carrying it.
    epoch: Date.UTC(2026, 10, 9),
    async run(ctx) {
        // No stored list: the default applies, and it already lists Baidu.
        if (!Array.isArray(await ctx.get(DISABLED_SERVICES))) return;
        await ctx.addElement(DISABLED_SERVICES, TRANSLATE_SERVICE.BAIDU);
    },
};
