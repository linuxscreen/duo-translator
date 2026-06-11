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
        permissions: ['storage', 'tabs', 'activeTab', 'contextMenus', 'commands', 'identity', 'alarms'],
        host_permissions: ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*', 'https://accounts.google.com/*'],
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
            "shortcut-toggle": {
                "suggested_key": {
                    "default": "Ctrl+Shift+E",
                    "linux": "Ctrl+Shift+E"
                },
                "description": '__MSG_shortcutToggleTranslation__'
            },
            "shortcut-translate": {
                "suggested_key": {
                    "default": "Ctrl+Shift+T",
                    "linux": "Ctrl+Shift+T"
                },
                "description": '__MSG_shortcutTranslate__'
            },
            "shortcut-restore": {
                "suggested_key": {
                    "default": "Ctrl+Shift+R",
                    "linux": "Ctrl+Shift+R"
                },
                "description": '__MSG_shortcutRestore__'
            },
            "shortcut-ai-workbench": {
                "suggested_key": {
                    "default": "Ctrl+Shift+W",
                    "linux": "Ctrl+Shift+W"
                },
                "description": '__MSG_shortcutAiWorkbench__'
            },
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
