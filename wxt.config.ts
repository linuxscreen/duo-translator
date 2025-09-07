import {defineConfig} from 'wxt';
import vue from '@vitejs/plugin-vue';
import vueI18n from '@intlify/unplugin-vue-i18n/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifest: {
        name: '__MSG_extName__',
        description: '__MSG_extDescription__',
        default_locale: 'en',
        permissions: ['storage', 'tabs', 'activeTab','contextMenus','commands'],
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
        web_accessible_resources: [
            {
                "resources": ["*/*"],
                "matches": ["<all_urls>"]
            }
        ]
    },
    imports: {
        addons: {
            vueTemplate: true,
        },
    },
    vite: () => ({
        plugins: [
            vue(),
            vueI18n({
                include: 'assets/locales/*.json',
            }),
        ],
        define: {
            // 'import.meta.env.VITE_ENV': JSON.stringify(process.env.VITE_ENV)
        },
        build: {
            // minify: 'terser',
            // Enabling sourcemaps with Vue during development is known to cause problems with Vue
            sourcemap: true,
            terserOptions: {
                compress: {
                    // production env will remove all console.* calls
                    drop_console: true,
                    drop_debugger: true,
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
        disabled: true,
    },
});
