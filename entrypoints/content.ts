import { defineContentScript } from "wxt/utils/define-content-script";
import { isHtmlDocument } from "@/utils/dom";
export default defineContentScript({
    // matches: ['<all_urls>'],
    matches: ['https://*/*', 'http://*/*'],
    // Run in sub-frames as well so the AI Writing dot can mount inside the
    // iframe that owns the focused input. content() self-gates frame role.
    allFrames: true,
    // runAt: "document_start",
    cssInjectionMode: 'manual',
    async main(ctx) {
        // SVG / raw XML documents: nothing to translate, and the pipeline
        // cannot even be evaluated there (see isHtmlDocument). The import MUST
        // stay dynamic — that is what defers evaluating the pipeline's module
        // graph (React DOM included) until after this check: the bundler
        // inlines it behind a lazy initializer, as with errorToast. A static
        // import would evaluate it at injection and crash those frames again.
        // Still the same task as injection, so content()'s first-round
        // listener registration (see startupReady) is unaffected.
        if (!isHtmlDocument()) return;
        const { content } = await import("@/main/content");
        await content();
    }
})
