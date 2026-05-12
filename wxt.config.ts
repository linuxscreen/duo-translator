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
        permissions: ['storage', 'tabs', 'activeTab', 'contextMenus', 'commands'],
        content_scripts: [
            {
                matches: ['https://*/*', 'http://*/*'],
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
            // minify: 'terser',
            minify: false,
            // sourcemap: process.env.NODE_ENV !== 'production',
            sourcemap: 'inline',
            terserOptions: {
                compress: {
                    // production env will remove all console.* calls
                    drop_console: process.env.NODE_ENV == 'production',
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
    webExt: {
        disabled: false,
        binaries: {
            chrome: "C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe",
        },
        chromiumProfile: resolve('F:\\code\\duo-translator\\.wxt\\chrome-data'),
        keepProfileChanges: true,
        chromiumArgs: [
            '--remote-debugging-port=9222'
        ]
    },
});
