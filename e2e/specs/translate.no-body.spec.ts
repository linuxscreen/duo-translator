import type { CDPSession } from '@playwright/test';
import { test, expect } from '../fixtures/extension';
import { mockTranslateProviders, ZH } from '../mocks/translateRoutes';

// Documents without a <body> used to crash the content script, silently:
//  - no-body.xhtml: HTML namespace, but `document.body === null`, so the first
//    marking scan threw "null ... isConnected" and startup aborted;
//  - no-body.svg: createElement() yields elements without `.style`, so the
//    bundle threw at MODULE EVALUATION (React DOM), before content() ran.
// Neither leaves anything observable on the page, and a timed "no error seen"
// would race the injection. So this asks the bundle itself: WXT emits
// `var content = (function () { ... })()`, whose value is the promise of the
// entrypoint's main() — a definitive per-frame verdict, read over CDP from the
// extension's isolated world.
const VERDICT = `(typeof content === 'undefined')
    ? 'not-evaluated'
    : Promise.race([
        Promise.resolve(content).then(() => 'ok', (e) => 'crashed: ' + (e && e.message)),
        new Promise((r) => setTimeout(() => r('pending'), 10000)),
    ])`;

type World = { contextId: number; frameId: string };

// `type: 'isolated'` alone does not identify our world: Playwright creates its
// own isolated `__playwright_utility_world__` in every frame, and picking that
// one reads as "not-evaluated". Ask each candidate whose extension it is.
async function extensionWorld(cdp: CDPSession, worlds: World[], frameId: string, extensionId: string) {
    for (const w of worlds) {
        if (w.frameId !== frameId) continue;
        const r = await cdp.send('Runtime.evaluate', {
            expression: `typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null`,
            contextId: w.contextId,
            returnByValue: true,
        }).catch(() => undefined); // context torn down meanwhile
        if (r?.result.value === extensionId) return w;
    }
    return undefined;
}

async function frameIdOf(cdp: CDPSession, suffix: string): Promise<string | undefined> {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const stack = [frameTree];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.frame.url.endsWith(suffix)) return node.frame.id;
        stack.push(...(node.childFrames ?? []));
    }
    return undefined;
}

test.describe('@no-body documents without a <body>', () => {
    test.beforeEach(async ({ context, seedConfig }) => {
        await mockTranslateProviders(context);
        await seedConfig();
    });

    test('the content script starts cleanly in XHTML-without-body and SVG frames', async ({ context, page, extensionId }) => {
        const cdp = await context.newCDPSession(page);
        let worlds: World[] = [];
        const exceptions: string[] = [];
        cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
            const aux = c.auxData as { frameId?: string; type?: string } | undefined;
            if (aux?.type === 'isolated' && aux.frameId) worlds.push({ contextId: c.id, frameId: aux.frameId });
        });
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
            worlds = worlds.filter((w) => w.contextId !== executionContextId);
        });
        cdp.on('Runtime.executionContextsCleared', () => { worlds = []; });
        cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
            exceptions.push(d.exception?.description ?? d.text);
        });
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');

        await page.goto('/no-body.html');
        // Positive sync point: the ordinary top frame still translates.
        await expect(page.locator('#top .duo-translation')).toContainText(ZH);

        for (const file of ['no-body.xhtml', 'no-body.svg']) {
            const frameId = await frameIdOf(cdp, file);
            expect(frameId, `${file} frame`).toBeTruthy();
            // Positive sync point: our content script was injected into this frame.
            let world: World | undefined;
            await expect.poll(async () => {
                world = await extensionWorld(cdp, worlds, frameId!, extensionId);
                return !!world;
            }, { message: `${file} injected` }).toBe(true);
            const { result } = await cdp.send('Runtime.evaluate', {
                expression: VERDICT,
                contextId: world!.contextId,
                awaitPromise: true,
                returnByValue: true,
            });
            expect(result.value, file).toBe('ok');
        }

        expect(exceptions).toEqual([]);
    });
});
