import { describe, expect, it, vi } from 'vitest';
import { CONFIG_KEY, TRANSLATE_SERVICE, configDefault } from '@/main/constants';

vi.mock('@/utils/db', () => ({
    getConfig: async (key: string) => configDefault(key),
    setConfig: vi.fn(),
}));

import { buildAiTranslateService, buildServiceOptions, getTranslateService } from '@/utils/service';

describe('Baidu service availability', () => {
    it('stays out of page and selection pickers until enabled', async () => {
        expect(configDefault(CONFIG_KEY.BAIDU_QPS)).toBe(1);
        const disabled = configDefault(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES);
        const page = await getTranslateService(undefined);
        const selection = buildAiTranslateService(undefined, [], disabled);
        for (const context of [page, selection]) {
            expect(buildServiceOptions(context.enabledTranslateServices, context.enabledAiProviders)
                .some((option) => option.value === TRANSLATE_SERVICE.BAIDU)).toBe(false);
        }
    });

    it('offers the same enabled Baidu option to selection, writing and subtitle pickers', () => {
        const disabled = (configDefault(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES) as string[])
            .filter((service) => service !== TRANSLATE_SERVICE.BAIDU);
        const context = buildAiTranslateService(TRANSLATE_SERVICE.BAIDU, [], disabled);
        expect(context.activeService).toBe(TRANSLATE_SERVICE.BAIDU);
        expect(buildServiceOptions(context.enabledTranslateServices, context.enabledAiProviders))
            .toContainEqual({
                value: 'baidu', iconId: 'baidu', isAi: false,
                i18nKey: 'baiduTranslator', label: 'Baidu',
            });
    });
});
