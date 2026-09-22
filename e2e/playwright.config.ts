import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Static file server root for the local fixture pages.
const FIXTURE_DIR = resolve(__dirname, 'fixtures/pages');
// Launched with node directly, NOT through `pnpm exec`. Playwright stops the
// web server by SIGKILLing its process group and then waits for the stdio pipes
// to close. Since pnpm 11.27.1, `pnpm exec` puts the command in a process group
// of its own (to forward signals itself), so the kill only reaches pnpm: the
// orphaned http-server keeps the pipes open and the run hangs forever after the
// last test passes.
const HTTP_SERVER_BIN = resolve(__dirname, '../node_modules/http-server/bin/http-server');
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
    // One retry in CI, for infrastructure hiccups only (browser launch, fixture
    // server). Deliberately NOT higher: the startup races this suite used to hit
    // were a real product bug, and a generous retry budget is exactly what would
    // hide the next one. Playwright still reports a retried test as "flaky" even
    // when the run goes green — treat that as a defect report, not as noise.
    retries: process.env.CI ? 1 : 0,
    // The HTML report is what gets uploaded as a CI artifact; `list` stays for
    // readable step logs in both places.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        baseURL: FIXTURE_ORIGIN,
        trace: 'retain-on-failure',
    },
    // Serve the fixture HTML pages over http so the content script injects with
    // a real http(s) origin (matches `https://*/*` / `http://*/*`).
    webServer: {
        command: `"${process.execPath}" "${HTTP_SERVER_BIN}" "${FIXTURE_DIR}" -p ${FIXTURE_PORT} -c-1 --silent`,
        url: FIXTURE_ORIGIN,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
