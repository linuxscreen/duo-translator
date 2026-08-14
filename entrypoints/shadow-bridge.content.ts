import { defineContentScript } from "wxt/utils/define-content-script";
import {
    SHADOW_ATTACH_EVENT,
    SHADOW_BRIDGE_HELLO,
    SHADOW_BRIDGE_READY,
} from "@/main/dom/shadowBridgeProtocol";

/**
 * MAIN-world bridge for Shadow DOM support. Its one job is impossible from the
 * isolated world: **discovering roots attached to already-connected elements.**
 * Attaching a shadow root produces NO mutation record of any kind, so a
 * component that renders on a delay (or on first interaction) is invisible until
 * something unrelated happens to re-scan that subtree. Wrapping `attachShadow`
 * is the only notification point there is, and wrapping it from the isolated
 * world would do nothing: content scripts get their own `Element.prototype`, so
 * the page's calls never see the patch. This matters for plain OPEN roots — it
 * is not about closed ones.
 *
 * Must stay dependency-free (no `browser.*`, no extension imports beyond the
 * shared protocol constants) and must never throw into the page: this patches a
 * global on every page in every frame, and an exception here breaks the site.
 *
 * **Closed roots are deliberately NOT supported, and rewriting `mode` back to
 * `"open"` must not be reintroduced.** It used to, and it made Cloudflare's
 * challenge fail (Turnstile builds its widget in a closed root inside the
 * *calling* page, specifically so nothing can reach in). The failure mode is the
 * worst kind there is: the site tells the user they are a bot, and nothing points
 * at a translation extension. A per-site allow-list cannot fix it either —
 * the challenge is served from whatever domain the user was visiting, and at
 * `document_start` there is no way to know a page will host one. The same
 * closed-root-as-a-fence pattern shows up in hCaptcha/reCAPTCHA, Stripe Elements
 * and SSO popups; an author choosing `closed` is saying "stay out", and those are
 * exactly the widgets we should not be translating. The cost of honoring that is
 * small and legible (some region of a rare site goes untranslated) because the
 * mainstream component frameworks — Lit, Stencil, the usual design systems — all
 * default to open.
 *
 * Cloaking the forced mode (patching the `shadowRoot` getter so the page reads
 * `null`) was considered and rejected: we never established whether Cloudflare
 * detects the readable root or simply breaks when our pipeline mutates the
 * challenge's DOM, so it may fix nothing; and it means patching a hot-path getter
 * on every page plus faking a second `attachShadow` call, which natively throws.
 * If that question is ever worth answering, the experiment is to force open again
 * but `markNoTranslate` the whole forced root and see whether the challenge
 * passes — "passes" means our DOM writes were the problem, "fails" means
 * detection.
 *
 * Out of reach regardless: declarative Shadow DOM with
 * `shadowrootmode="closed"` — the parser attaches it and `attachShadow` is never
 * called, so there is no interception point at all.
 */
export default defineContentScript({
    matches: ["https://*/*", "http://*/*"],
    world: "MAIN",
    runAt: "document_start",
    allFrames: true,
    main() {
        // World self-check. `content_scripts.world` needs Chrome 111+ /
        // Firefox 128+; an older browser silently ignores the key and runs this
        // file in the ISOLATED world, where patching our own realm's prototype
        // would do nothing at all and the buffer would never fill — a failure
        // with no symptom. Extension APIs are the reliable discriminator: the
        // MAIN world has no `chrome.runtime.id`.
        //
        // The handshake cannot detect this: in the isolated world both sides
        // share a realm, so `postMessage` would succeed and prove nothing.
        try {
            if ((globalThis as any).chrome?.runtime?.id) return;
        } catch {
            // Access threw — we are in the page world, which is what we want.
        }

        const native = Element.prototype.attachShadow;
        if (typeof native !== "function") return;

        /** Hosts that got a root before the isolated world was listening. */
        const pending: Element[] = [];
        const PENDING_LIMIT = 2000;
        let ready = false;

        function notify(host: Element) {
            if (!ready) {
                if (pending.length < PENDING_LIMIT) pending.push(host);
                return;
            }
            try {
                host.dispatchEvent(
                    new CustomEvent(SHADOW_ATTACH_EVENT, {
                        bubbles: true,
                        composed: true,
                    }),
                );
            } catch {
                // Never let our notification surface in the page.
            }
        }

        try {
            Element.prototype.attachShadow = function (
                this: Element,
                init: ShadowRootInit,
            ): ShadowRoot {
                // `init` is passed through untouched — see the header on why
                // `mode: "closed"` must stay closed. Closed hosts still notify;
                // the isolated side drops them because `host.shadowRoot` is null.
                const root = native.call(this, init);
                notify(this);
                return root;
            };
        } catch {
            // Frozen prototype / hardened page — late attachments go unnoticed;
            // the marking scan still finds roots that exist when it runs.
            return;
        }

        window.addEventListener("message", (ev: MessageEvent) => {
            if (ev.source !== window) return;
            if (ev.data?.type !== SHADOW_BRIDGE_READY) return;
            ready = true;
            try {
                window.postMessage({ type: SHADOW_BRIDGE_HELLO }, "*");
            } catch {
                // Ignore.
            }
            for (const host of pending.splice(0)) {
                if (host.isConnected) notify(host);
            }
        });
    },
});
