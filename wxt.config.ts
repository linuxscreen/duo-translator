import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { inline } from '@floating-ui/dom';

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifest: {
        name: '__MSG_extName__',
        description: '__MSG_extDescription__',
        default_locale: 'en',
        permissions: ['storage', 'tabs', 'activeTab', 'contextMenus', 'identity', 'alarms'],
        host_permissions: [
            // firefox mv2 needs these
            // 'https://translate-pa.googleapis.com/*',
            // 'https://api.cognitive.microsofttranslator.com/*',
            // 'https://api-free.deepl.com/*',
            // google drive
            // 'https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*', 'https://accounts.google.com/*'
            // Text-to-speech endpoints. Fetched from the background service worker
            // (their responses carry no CORS headers, and Bing needs a token
            // scraped from its translator page). These are narrow, fixed origins,
            // so they do NOT trigger the broad "all sites" install warning.
            // 'https://translate.google.com/*',
            // 'https://www.bing.com/*',
        ],
        // WebDAV URL is user-supplied at runtime, so we request the matching
        // origin via `browser.permissions.request` on connect. <all_urls> here
        // is what we ask for at runtime, not granted at install time.
        optional_host_permissions: ['<all_urls>'],
        content_scripts: [
            {
                matches: ['https://*/*', 'http://*/*'],
                // Inject into sub-frames too — the AI Writing dot must live
                // inside the iframe whose input is focused (focus events don't
                // cross frame boundaries; fixed-positioning is per-frame). The
                // script self-gates: page translation / float ball stay
                // top-frame only (see main/content.ts).
                all_frames: true,
                css: ['assets/style.css']
            }
        ],
        commands: {
            "shortcut-translate-restore-page": {
                "suggested_key": {
                    "default": "Alt+S",
                    "linux": "Alt+S"
                },
                "description": '__MSG_shortcutTranslateRestorePage__'
            },
            "shortcut-translate": {
                "description": '__MSG_shortcutTranslate__'
            },
            "shortcut-restore": {
                "description": '__MSG_shortcutRestore__'
            },
            "shortcut-ai-workbench": {
                "suggested_key": {
                    "default": "Alt+W",
                    "linux": "Alt+W"
                },
                "description": '__MSG_shortcutAiWorkbench__'
            },
            "shortcut-translate-restore-paragraph": {
                "suggested_key": {
                    "default": "Alt+Q",
                    "linux": "Alt+Q"
                },
                "description": '__MSG_shortcutTranslateRestoreParagraph__'
            },
            "shortcut-translate-selection-input": {
                "suggested_key": {
                    "default": "Alt+A",
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
    },
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
    outDir: process.env.WXT_OUTDIR || '.output'
});
