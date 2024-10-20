import {defineConfig} from 'wxt';
import vue from '@vitejs/plugin-vue';
import vueI18n from '@intlify/unplugin-vue-i18n/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
    manifest: {
        name: '__MSG_extName__',
        description: '__MSG_extDescription__',
        default_locale: 'zh',
        permissions: ['storage', 'tabs', 'activeTab'],
        content_scripts: [
            {
                matches: ['<all_urls>'],
                css: ['assets/style.css']
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
            minify: 'terser',
            // Enabling sourcemaps with Vue during development is known to cause problems with Vue
            sourcemap: false,
            terserOptions: {
                compress: {
                    // production env will remove all console.* calls
                    // drop_console: true,
                    // drop_debugger: true,
                }
            }
        },
        // resolve: {
        //     alias: {
        //         'cld3-asm': 'cld3-asm/dist/cjs/index.js'
        //     }
        // }
    }),
    runner: {
        disabled: true,
    },
});
