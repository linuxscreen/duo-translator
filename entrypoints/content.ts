import { content } from "@/main/content";
import { defineContentScript } from "wxt/utils/define-content-script";
export default defineContentScript({
    // matches: ['<all_urls>'],
    matches: ['https://*/*', 'http://*/*'],
    // runAt: "document_start",
    cssInjectionMode: 'manual',
    async main(ctx) {
        await content();
    }
})