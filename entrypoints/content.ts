import { content } from "@/main/content";
import { defineContentScript } from "wxt/utils/define-content-script";
export default defineContentScript({
    // matches: ['<all_urls>'],
    matches: ['https://*/*', 'http://*/*'],
    // Run in sub-frames as well so the AI Writing dot can mount inside the
    // iframe that owns the focused input. content() self-gates frame role.
    allFrames: true,
    // runAt: "document_start",
    cssInjectionMode: 'manual',
    async main(ctx) {
        await content();
    }
})