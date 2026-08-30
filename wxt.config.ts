import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { inline } from '@floating-ui/dom';

const GOOGLE_OAUTH_SCOPES = [
    // Must stay in lock-step with SCOPE in main/storage/sync/googleDriveProvider.ts.
    // Both are non-sensitive scopes; adding anything broader (drive.file, …)
    // would drag the OAuth client into Google's verification queue.
    'https://www.googleapis.com/auth/drive.appdata',
    'email',
];

// Safari's background is a page, not a service worker — see the hooks below.
const SAFARI_BACKGROUND_PAGE = 'background.html';
const SAFARI_BACKGROUND_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body><script src="background.js"></script></body>
</html>
`;

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifest: ({ browser, mode }) => ({
        name: '__MSG_extName__',
        description: '__MSG_extDescription__',
        default_locale: 'en',
        // 'identity' powers Google Drive sync (launchWebAuthFlow everywhere,
        // getAuthToken on Chrome). It shows no user-visible install warning.
        permissions: ['storage', 'tabs', 'activeTab', 'contextMenus', 'alarms', 'webNavigation', 'identity'],
        host_permissions: [
            // firefox needs these (the firefox target is MV3 too -- see the
            // `--mv3` flag on the firefox scripts in package.json)
            // 'https://translate-pa.googleapis.com/*',
            // 'https://api.cognitive.microsofttranslator.com/*',
            // 'https://api-free.deepl.com/*',
            //
            // Google Drive sync: the Drive REST API + the userinfo endpoint,
            // both called from the background. accounts.google.com and
            // oauth2.googleapis.com are deliberately NOT here — the consent
            // screen is a real browser navigation driven by launchWebAuthFlow
            // (host permissions don't apply), and we never call the token
            // endpoint at all (no client_secret, see googleDriveProvider.ts).
            'https://www.googleapis.com/*',
            // Text-to-speech AND dictionary endpoints. Fetched from the
            // background service worker, which is subject to CORS for any origin
            // NOT listed here — and neither host sends CORS headers (Bing's
            // dictionary is a plain HTML page; Google's translate_a/single and
            // translate_tts answer a browser, not a cross-origin caller). Bing
            // additionally needs a token scraped from its translator page.
            //
            // These are narrow, fixed origins, so they do NOT trigger the broad
            // "all sites" install warning.
            'https://translate.google.com/*',
            'https://www.bing.com/*',
        ],
        // WebDAV URL is user-supplied at runtime, so we request the matching
        // origin via `browser.permissions.request` on connect. <all_urls> here
        // is what we ask for at runtime, not granted at install time.
        optional_host_permissions: ['<all_urls>'],
        // `mac` is spelled out even though it repeats `default`, because the
        // interesting fact is what it is NOT: Chrome silently rewrites `Ctrl`
        // to `Command` on macOS, and Command+S / +W / +Q / +A are Save / Close
        // window / Quit / Select all — all four of our letters are taken. Alt
        // (the Option key, which is what the settings page now labels it) is
        // the only modifier left that is free on every platform, so the mac
        // bindings are deliberately identical to the default ones. Leaving the
        // key out would work the same but invites someone to "fix" it later by
        // mapping to Command.
        commands: {
            "shortcut-translate-restore-page": {
                "suggested_key": {
                    "default": "Alt+S",
                    "mac": "Alt+S",
                    "linux": "Alt+S"
                },
                "description": '__MSG_shortcutTranslateRestorePage__'
            },
            "shortcut-ai-workbench": {
                "suggested_key": {
                    "default": "Alt+W",
                    "mac": "Alt+W",
                    "linux": "Alt+W"
                },
                "description": '__MSG_shortcutAiWorkbench__'
            },
            "shortcut-translate-restore-paragraph": {
                "suggested_key": {
                    "default": "Alt+Q",
                    "mac": "Alt+Q",
                    "linux": "Alt+Q"
                },
                "description": '__MSG_shortcutTranslateRestoreParagraph__'
            },
            "shortcut-translate-selection-input": {
                "suggested_key": {
                    "default": "Alt+A",
                    "mac": "Alt+A",
                    "linux": "Alt+A"
                },
                "description": '__MSG_shortcutTranslateSelectionInput__'
            }
        },
        // fix chrome load extension error: DevTools failed to load source map: Could not load:ERR_BLOCKED_BY_CLIENT
        // web_accessible_resources: [
        //     {
        //         "resources": ["*/*"],
        //         "matches": ["<all_urls>"]
        //     }
        // ]
        browser_specific_settings: {
            gecko: {
                // Dev builds get their own add-on ID so a test build installs
                // side by side with the released add-on instead of taking over
                // its ID (and its stored config). `wxt build` / `wxt zip`
                // default to mode "production" and keep the real ID; the dev
                // server, the e2e build (`--mode development`) and the Safari
                // debug build all fall to the -dev ID.
                id: mode === 'production'
                    ? 'duo-translator@duotranslator.com'
                    : 'duo-translator-dev@duotranslator.com',
                data_collection_permissions: {
                    required: ['websiteContent'],
                },
            },
        },
        // Chrome-only: the prerequisite for `identity.getAuthToken`, which is
        // how Chrome (and ONLY Chrome — not Edge/Brave/Vivaldi) gets a Drive
        // token without us ever touching a client_secret. Its client is of type
        // "Chrome extension" and is bound to the extension id, so the id has to
        // be stable: set CHROME_EXTENSION_KEY in .env for unpacked dev builds
        // (the store assigns the id for published ones).
        //
        // The env read MUST stay inside this function: WXT calls its own
        // `loadEnv()` (which is what copies .env into process.env) while
        // resolving the config, i.e. AFTER this module has been imported. A
        // module-level `const … = process.env.X` therefore captures undefined
        // and the key silently vanishes from the manifest — no error, nothing
        // in the build log, just a getAuthToken that never works.
        ...(browser === 'chrome' && process.env.VITE_GOOGLE_CLIENT_ID_CHROME
            ? {
                oauth2: {
                    client_id: process.env.VITE_GOOGLE_CLIENT_ID_CHROME,
                    scopes: GOOGLE_OAUTH_SCOPES,
                },
            }
            : {}),
        ...(browser === 'chrome' && process.env.CHROME_EXTENSION_KEY
            ? { key: process.env.CHROME_EXTENSION_KEY }
            : {}),
    }),
    imports: false, // auto import cause sourcemap error, unable to set breakpoint into function
    vite: () => ({
        plugins: [
            // Must run before Vite's built-in resolver so we win against
            // the `browser` field in `immediate/package.json` which maps
            // `./lib/nextTick` to `false`. In Vite 8 that mapping produces
            // a Proxy stub that throws on any property access, breaking
            // immediate's strategy probe (`mod && mod.test && mod.test()`).
            {
                name: 'fix-immediate-nextTick',
                enforce: 'pre',
                resolveId(id, importer) {
                    if (
                        (id === './nextTick' || id === './nextTick.js') &&
                        importer && /[\\/]immediate[\\/]lib[\\/]/.test(importer)
                    ) {
                        return resolve(__dirname, 'shims/empty-module.js');
                    }
                    return null;
                },
            },
            react({ include: [/\.[jt]sx$/] }),
            tailwindcss(),
            nodePolyfills({
                include: ['process'],
                globals: { process: true },
            }),
        ],
        define: {
            // 'import.meta.env.VITE_ENV': JSON.stringify(process.env.VITE_ENV)
            // pouchdb and other Node-style deps reference `global`; vite 8 no longer
            // polyfills this implicitly, so map it to globalThis for SW/browser runtime.
            global: 'globalThis',
        },
        build: {
            // No `<link rel="modulepreload">` in popup.html / options.html.
            // Chrome (>= 152, seen on 153 dev) refuses to match a modulepreload
            // against the later real import of the same chunk on an extension
            // page — "A preload for '…/chunks/service-*.js' is found, but is not
            // used because it is a cross-world extension resource mismatch" —
            // so the chunk is fetched twice and two warnings land in
            // chrome://extensions › Errors. Every asset here is a local file in
            // the packaged extension, so the preload hint buys nothing anyway.
            modulePreload: false,
            minify: process.env.NODE_ENV !== 'production' ? false : 'terser',
            sourcemap: process.env.NODE_ENV !== 'production' && 'inline',
            terserOptions: {
                compress: {
                    pure_funcs: ['console.log', 'console.debug', 'console.info', 'console.trace'], // retain warn and error
                    // production env will remove all console.* calls
                    // drop_console: process.env.NODE_ENV == 'production',
                    drop_debugger: process.env.NODE_ENV == 'production',
                }
            }
        },
        // resolve: {
        //     alias: {
        //         'cld3-asm': 'cld3-asm/dist/cjs/index.js'
        //     }
        // }
    }),
    hooks: {
        // Safari: ship the background as a non-persistent background PAGE
        // instead of a service worker. Still MV3 — Safari accepts both forms,
        // and this is the same shape the Firefox MV3 target already uses.
        //
        // Reason it is worth a special case: with `background.service_worker`,
        // Safari lists the background NOWHERE in the Develop menu — not under
        // "Web Extension Background Content" (that submenu is for background
        // pages) and not under "Service Workers" either. There is no console,
        // and a service worker's network requests are not recorded in the Web
        // Inspector's Network tab, so the background is completely opaque:
        // every provider request, every sync run, every error we deliberately
        // log is invisible on the one browser whose quirks need the most
        // digging. Chrome / Edge / Firefox all inspect theirs fine.
        //
        // Applied unconditionally rather than only in development: if the two
        // modes ran different background shapes, anything specific to one of
        // them could not be reproduced in the other, which defeats the point.
        //
        // Safe because nothing in the background depends on being a service
        // worker — no skipWaiting / importScripts / clients / install +
        // activate handlers — and the code already runs as an event page on
        // Firefox, so the "listeners must be registered in the first
        // synchronous round" rule (see CLAUDE.local.md) is already honored.
        // The page has to be ours rather than the one the browser generates from
        // `background.scripts`, and the reason is one line of it: <meta charset>.
        // background.js carries the bundled zh-CN locale, i.e. ~376k raw UTF-8
        // sequences. A classic script takes its encoding from the HTTP charset,
        // then its own charset attribute, then THE DOCUMENT'S — and the document
        // Safari generates for `scripts` does not declare UTF-8, so every
        // Chinese string in the background decodes as mojibake (first seen in
        // the context menu). Service workers never hit this because SW scripts
        // are decoded as UTF-8 unconditionally, which is why switching away from
        // one surfaced it. Forcing ASCII-only codegen instead is not available:
        // Vite 8 bundles with rolldown, which ignores `esbuild.charset` (tried)
        // and has no ASCII option of its own; terser's `ascii_only` would only
        // cover production, and the Safari workflow builds with --mode
        // development.
        //
        // `persistent` is deliberately absent: MDN BCD marks it "Manifest V2
        // only" for Safari, so in MV3 it is noise at best.
        'build:publicAssets': (wxt, files) => {
            if (wxt.config.browser !== 'safari') return;
            files.push({ relativeDest: SAFARI_BACKGROUND_PAGE, contents: SAFARI_BACKGROUND_HTML });
        },
        'build:manifestGenerated': (wxt, manifest) => {
            if (wxt.config.browser !== 'safari') return;
            const background = manifest.background as { service_worker?: string } | undefined;
            if (!background?.service_worker) return;
            manifest.background = { page: SAFARI_BACKGROUND_PAGE } as typeof manifest.background;
        },
    },
    outDir: process.env.WXT_OUTDIR || '.output',
    zip: {
        excludeSources: ['CLAUDE.local.md', 'AGENTS.md']
    }
});
