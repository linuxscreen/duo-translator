import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Static file server root for the local fixture pages.
const FIXTURE_DIR = resolve(__dirname, 'fixtures/pages');
export const FIXTURE_PORT = 5566;
export const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;

export default defineConfig({
    testDir: resolve(__dirname, 'specs'),
    // The extension runs in a single persistent context per worker; running
    // workers in parallel would fight over the shared chrome.storage config we
    // seed. Keep it serial.
    workers: 1,
    fullyParallel: false,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    reporter: [['list']],
    use: {
        baseURL: FIXTURE_ORIGIN,
        trace: 'retain-on-failure',
    },
    // Serve the fixture HTML pages over http so the content script injects with
    // a real http(s) origin (matches `https://*/*` / `http://*/*`).
    webServer: {
        command: `pnpm exec http-server "${FIXTURE_DIR}" -p ${FIXTURE_PORT} -c-1 --silent`,
        url: FIXTURE_ORIGIN,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
