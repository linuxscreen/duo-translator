import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Built extension produced by `pnpm e2e:build` (see package.json). We point at
// the dedicated e2e output dir so we never collide with the user's HMR dev
// profile in .output/chrome-mv3-dev.
// `--mode development` (see the e2e:build script) emits the `-dev` suffix.
const EXTENSION_PATH = resolve(__dirname, '../../.output/e2e-build/chrome-mv3-dev');

/** Config seeded into chrome.storage.local before navigation. */
export type SeedConfig = Record<string, unknown>;

// Deterministic baseline so page translation runs a known path:
//  - globalSwitch on + defaultStrategy "always"  => always translate
//  - targetLanguage zh-CN (no DEFAULT_VALUE entry, must be explicit)
//  - translateService "google" => single, content-script fetch path
//  - aiUseForTranslatePage off => never route page translation through AI
//  - translationCacheSwitch off => results never served from a stale cache
export const DEFAULT_SEED: SeedConfig = {
    config_globalSwitch: true,
    config_defaultStrategy: 'always',
    config_targetLanguage: 'zh-CN',
    config_translateService: 'google',
    config_aiUseForTranslatePage: false,
    config_translationCacheSwitch: false,
    config_floatBallSwitch: false,
};

export const test = base.extend<{
    context: BrowserContext;
    extensionId: string;
    serviceWorker: Worker;
    seedConfig: (cfg?: SeedConfig) => Promise<void>;
}>({
    // eslint-disable-next-line no-empty-pattern
    context: async ({}, use) => {
        // Headed vs headless is a launch OPTION, not a chromium arg. Default to
        // headless (CI-friendly); set HEADED=1 (or pass --headed) to watch it in
        // a real window. `--headed` in `args` does nothing — Chrome ignores it.
        const headed = !!process.env.HEADED || process.argv.includes('--headed');
        const context = await chromium.launchPersistentContext('', {
            channel: 'chromium',
            headless: !headed,
            args: [
                // Old headless can't load the extension service worker; the new
                // headless mode can. Omit when headed (would force headless).
                ...(headed ? [] : ['--headless=new']),
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
            ],
        });
        await use(context);
        await context.close();
    },

    serviceWorker: async ({ context }, use) => {
        let [sw] = context.serviceWorkers();
        if (!sw) sw = await context.waitForEvent('serviceworker');
        await use(sw);
    },

    extensionId: async ({ serviceWorker }, use) => {
        // chrome-extension://<id>/background.js  ->  <id>
        const id = new URL(serviceWorker.url()).host;
        await use(id);
    },

    seedConfig: async ({ context }, use) => {
        const seed = async (cfg: SeedConfig = {}) => {
            // Re-resolve the SW each call — it may have been suspended/restarted
            // between navigations.
            let [sw] = context.serviceWorkers();
            if (!sw) sw = await context.waitForEvent('serviceworker');
            await sw.evaluate(async (kv) => {
                await chrome.storage.local.set(kv);
            }, { ...DEFAULT_SEED, ...cfg });
        };
        await use(seed);
    },
});

export const expect = test.expect;
