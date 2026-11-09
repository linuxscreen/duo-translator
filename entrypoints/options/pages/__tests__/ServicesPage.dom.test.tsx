// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION, CONFIG_KEY, DB_ACTION, DEFAULT_VALUE, STATUS_FAIL, STATUS_SUCCESS } from '@/main/constants';
import { ServicesPage } from '../ServicesPage';

const mocks = vi.hoisted(() => ({
    values: new Map<string, unknown>(),
    setConfig: vi.fn(),
    sendMessage: vi.fn(),
    translate: (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock('wxt/browser', () => ({
    browser: {
        runtime: {
            sendMessage: mocks.sendMessage,
            onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        },
    },
}));
// Keep credential writes on the real db → message bridge. Only storage reads
// and the background boundary are fixtures, so failures exercise STATUS_FAIL
// and runtime rejections rather than an invented rejecting setConfig mock.
vi.mock('@/utils/db', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/utils/db')>(),
    getConfig: async (key: string) => mocks.values.get(key),
    setConfig: mocks.setConfig,
}));
vi.mock('@/utils/service', async () => {
    const { TRANSLATE_SERVICES } = await import('@/main/constants');
    return {
        listTranslateServices: () => Array.from(TRANSLATE_SERVICES.values()),
        notifyUpdateActiveTranslateService: vi.fn(),
    };
});
vi.mock('@/components/options/BuiltinAiModelDialog', () => ({ BuiltinAiModelDialog: () => null }));
vi.mock('@/entrypoints/options/pages/AiProvidersCard', () => ({ AiProvidersCard: () => null }));

let root: Root;
let container: HTMLDivElement;

function button(label: string, within: ParentNode = document.body): HTMLButtonElement {
    const result = Array.from(within.querySelectorAll('button')).find((el) => el.textContent === label);
    expect(result, `button ${label}`).toBeDefined();
    return result!;
}

async function renderPage(service = 'Baidu') {
    await act(async () => { root.render(<ServicesPage />); });
    await openCredentialDialog(service);
}

async function openCredentialDialog(service = 'Baidu') {
    const name = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === service);
    const row = name?.closest('.grid')!;
    expect(row).toBeTruthy();
    await act(async () => { button('Edit', row).click(); });
}

async function input(id: string, value: string) {
    const element = document.getElementById(id) as HTMLInputElement;
    expect(element).toBeTruthy();
    await act(async () => {
        element.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function blur(id: string) {
    const element = document.getElementById(id) as HTMLInputElement;
    expect(element).toBeTruthy();
    await act(async () => {
        element.focus();
        element.blur();
    });
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.values.clear();
    mocks.values.set(CONFIG_KEY.DISABLED_TRANSLATE_SERVICES, DEFAULT_VALUE.DISABLED_TRANSLATE_SERVICES);
    mocks.values.set(CONFIG_KEY.BAIDU_QPS, DEFAULT_VALUE.BAIDU_QPS);
    mocks.sendMessage.mockReset().mockImplementation(async (message) => {
        if (message.action === DB_ACTION.CONFIG_SET) {
            mocks.values.set(message.data.name, message.data.value);
            return { status: STATUS_SUCCESS, data: message.data.value };
        }
        return { status: STATUS_SUCCESS, data: { reply: '示例译文' } };
    });
    mocks.setConfig.mockReset().mockImplementation(async (key: string, value: unknown) => {
        mocks.values.set(key, value);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('credential validation feedback', () => {
    it.each(['Baidu', 'DeepL', 'Azure', 'GoogleCloud'])(
        'does not show errors when opening %s or leaving an unchanged field',
        async (service) => {
            await renderPage(service);
            const id = service === 'Baidu' ? 'baidu-app-id' : 'translation-api-key';
            expect((document.getElementById(id) as HTMLInputElement).required).toBe(true);
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(true);
            expect(button('Test', button('Save').parentElement!).disabled).toBe(true);
            await blur(id);
            expect(document.querySelector('[role="alert"]')).toBeNull();
        },
    );

    it.each(['DeepL', 'Azure', 'GoogleCloud'])(
        'validates the %s API key after editing and blur, and resets on reopening',
        async (service) => {
            await renderPage(service);
            await input('translation-api-key', ' ');
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(true);
            await blur('translation-api-key');
            expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter an API key.');
            await input('translation-api-key', 'example-api-key');
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(false);
            await act(async () => { button('Cancel').click(); });
            await openCredentialDialog(service);
            expect(button('Save').disabled).toBe(true);
            await blur('translation-api-key');
            expect(document.querySelector('[role="alert"]')).toBeNull();
        },
    );

    it.each(['baidu-app-id', 'baidu-secret-key'])(
        'shows only edited and blurred Baidu credential errors for %s',
        async (id) => {
            await renderPage();
            await input(id, ' ');
            expect(document.querySelector('[role="alert"]')).toBeNull();
            await blur(id);
            expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter your Baidu AppID and secret key.');
            await input(id, 'example-credential');
            await blur(id);
            // The other required credential is still empty and untouched.
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(true);
            await act(async () => { button('Cancel').click(); });
            await openCredentialDialog();
            await blur(id);
            expect(document.querySelector('[role="alert"]')).toBeNull();
        },
    );

    it.each(['', '0', '1.5', '101'])(
        'shows the QPS error for %j after blur without exposing untouched credentials',
        async (value) => {
            await renderPage();
            await input('baidu-qps', value);
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(true);
            await blur('baidu-qps');
            expect(document.querySelector('[role="alert"]')?.textContent).toBe('QPS must be a whole number from 1 to 100.');
            await input('baidu-qps', '10');
            expect(document.querySelector('[role="alert"]')).toBeNull();
            expect(button('Save').disabled).toBe(true);
        },
    );

    it('does not carry API-key validation state into another service', async () => {
        await renderPage('DeepL');
        await input('translation-api-key', ' ');
        await blur('translation-api-key');
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter an API key.');
        await act(async () => { button('Cancel').click(); });
        await openCredentialDialog('Azure');
        await blur('translation-api-key');
        expect(document.querySelector('[role="alert"]')).toBeNull();
        expect(button('Save').disabled).toBe(true);
    });
});

describe('Baidu translation credentials', () => {
    it('requires both credentials and an integer QPS from 1 to 100 before saving or testing', async () => {
        await renderPage();
        expect(button('Save').disabled).toBe(true);
        expect(button('Test', button('Save').parentElement!).disabled).toBe(true);
        expect((document.getElementById('baidu-secret-key') as HTMLInputElement).type).toBe('password');
        expect((document.getElementById('baidu-qps') as HTMLInputElement).value).toBe('1');
        await input('baidu-app-id', '20260000000000000001');
        await input('baidu-secret-key', 'example-secret-not-a-real-key');
        for (const value of ['', '0', '1.5', '101']) {
            await input('baidu-qps', value);
            expect(button('Save').disabled).toBe(true);
        }
        await input('baidu-qps', '10');
        expect(button('Save').disabled).toBe(false);
        await act(async () => { button('Test', button('Save').parentElement!).click(); });
        expect(mocks.sendMessage).toHaveBeenCalledWith({
            action: ACTION.TRANSLATE_SERVICE_TEST,
            data: {
                service: 'baidu', targetLang: 'zh-CN',
                appId: '20260000000000000001', secretKey: 'example-secret-not-a-real-key', qps: 10,
            },
        });
        await act(async () => { button('Save').click(); });
        expect(mocks.values.get(CONFIG_KEY.BAIDU_APP_ID)).toBe('20260000000000000001');
        expect(mocks.values.get(CONFIG_KEY.BAIDU_SECRET_KEY)).toBe('example-secret-not-a-real-key');
        expect(mocks.values.get(CONFIG_KEY.BAIDU_QPS)).toBe(10);
        expect(mocks.sendMessage).toHaveBeenCalledWith({
            action: DB_ACTION.CONFIG_SET,
            data: { name: CONFIG_KEY.BAIDU_QPS, value: 10 },
        });
        expect(document.getElementById('baidu-app-id')).toBeNull();
    });

    it('loads stored credentials as text', async () => {
        mocks.values.set(CONFIG_KEY.BAIDU_APP_ID, '20260000000000000001');
        mocks.values.set(CONFIG_KEY.BAIDU_SECRET_KEY, 'example-secret-not-a-real-key');
        mocks.values.set(CONFIG_KEY.BAIDU_QPS, 5);
        await renderPage();
        expect((document.getElementById('baidu-app-id') as HTMLInputElement).value).toBe('20260000000000000001');
        expect((document.getElementById('baidu-qps') as HTMLInputElement).value).toBe('5');
    });

    it.each(['STATUS_FAIL', 'runtime rejection'] as const)(
        'keeps the draft and previous credentials after a real bridge %s',
        async (failure) => {
            await renderPage();
            await input('baidu-app-id', 'example-app-id');
            await input('baidu-secret-key', 'example-secret-not-a-real-key');
            const message = `Example ${failure}`;
            if (failure === 'STATUS_FAIL') {
                mocks.sendMessage.mockResolvedValue({ status: STATUS_FAIL, data: { message } });
            } else {
                mocks.sendMessage.mockRejectedValue(new Error(message));
            }
            await act(async () => { button('Save').click(); });
            expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
            expect((document.getElementById('baidu-app-id') as HTMLInputElement).value).toBe('example-app-id');
            expect(mocks.values.has(CONFIG_KEY.BAIDU_APP_ID)).toBe(false);
            // Reopening reads the component's saved-credential state. A failed
            // write must not populate it and make an unsaved service usable.
            await act(async () => { button('Cancel').click(); });
            await openCredentialDialog();
            expect((document.getElementById('baidu-app-id') as HTMLInputElement).value).toBe('');
            expect((document.getElementById('baidu-secret-key') as HTMLInputElement).value).toBe('');
        },
    );
});
