import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG_KEY, TRANSLATE_SERVICE } from '@/main/constants';

const { store, setItem } = vi.hoisted(() => ({
    store: new Map<string, unknown>(),
    setItem: vi.fn(),
}));

vi.mock('wxt/utils/storage', () => ({
    storage: {
        getItem: vi.fn(async (key: string) => structuredClone(store.get(key) ?? null)),
        setItem: setItem.mockImplementation(async (key: string, value: unknown) => {
            store.set(key, structuredClone(value));
        }),
    },
}));

import { configRepo, getSyncMeta, migrateBaiduServiceDefault } from '@/main/storage/configStore';

const key = (name: CONFIG_KEY) => `local:config_${name}`;
const disabledKey = key(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES);
const dataKey = `config_${CONFIG_KEY.DISABLED_TRANSLATE_SERVICES}`;
const legacyDisabled = ['deepl', 'azure', 'googleCloud'];
const credentials = { appId: 'baidu-test-app', secretKey: 'baidu-test-secret' };

beforeEach(() => {
    store.clear();
    setItem.mockClear();
});

describe('Baidu default for existing installations', () => {
    it('adds only Baidu to a legacy list and records its collection clock', async () => {
        store.set(disabledKey, legacyDisabled);
        store.set('local:__sync_meta', {
            clocks: { [dataKey]: 100 }, tombstones: {}, elements: {},
        });

        await migrateBaiduServiceDefault();

        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES))
            .toEqual([...legacyDisabled, TRANSLATE_SERVICE.BAIDU]);
        expect(legacyDisabled).toEqual(['deepl', 'azure', 'googleCloud']);
        const meta = await getSyncMeta();
        expect(meta.clocks[dataKey]).toBeGreaterThan(100);
        expect(meta.elements[dataKey].clocks.deepl).toBe(100);
        expect(meta.elements[dataKey].clocks.baidu).toBe(meta.clocks[dataKey]);

        setItem.mockClear();
        await migrateBaiduServiceDefault();
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each([
        [undefined, credentials.secretKey],
        [credentials.appId, undefined],
        ['  ', credentials.secretKey],
        [credentials.appId, '\t'],
        [123, credentials.secretKey],
    ])('disables Baidu when either credential is missing or blank (%s, %s)', async (appId, secretKey) => {
        store.set(disabledKey, []);
        store.set(key(CONFIG_KEY.BAIDU_APP_ID), appId);
        store.set(key(CONFIG_KEY.BAIDU_SECRET_KEY), secretKey);

        await migrateBaiduServiceDefault();

        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES))
            .toEqual([TRANSLATE_SERVICE.BAIDU]);
    });

    it('preserves a configured and explicitly enabled service', async () => {
        store.set(disabledKey, legacyDisabled);
        store.set(key(CONFIG_KEY.BAIDU_APP_ID), credentials.appId);
        store.set(key(CONFIG_KEY.BAIDU_SECRET_KEY), credentials.secretKey);

        await migrateBaiduServiceDefault();

        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES)).toEqual(legacyDisabled);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('keeps a configured service disabled when the user turned it off', async () => {
        store.set(disabledKey, [TRANSLATE_SERVICE.BAIDU]);
        store.set(key(CONFIG_KEY.BAIDU_APP_ID), credentials.appId);
        store.set(key(CONFIG_KEY.BAIDU_SECRET_KEY), credentials.secretKey);

        await migrateBaiduServiceDefault();

        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES)).toEqual([TRANSLATE_SERVICE.BAIDU]);
        expect(setItem).not.toHaveBeenCalled();
    });

    it('leaves a fresh install on the shipped disabled default without a write', async () => {
        await migrateBaiduServiceDefault();

        expect(await configRepo.get(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES)).toContain(TRANSLATE_SERVICE.BAIDU);
        expect(setItem).not.toHaveBeenCalled();
    });
});
