// vitest.config.ts
import {defineConfig} from 'vitest/config';
import {WxtVitest} from 'wxt/testing';

export default defineConfig({
    plugins: [WxtVitest()],
    test: {
        // e2e/ holds Playwright specs (also *.spec.ts); they must not be run by
        // Vitest — they import @playwright/test and only run via `pnpm e2e`.
        exclude: ['**/node_modules/**', '**/.output/**', 'e2e/**'],
    },
});
