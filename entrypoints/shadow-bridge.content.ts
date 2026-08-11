import { defineContentScript } from "wxt/utils/define-content-script";
import {
    SHADOW_ATTACH_EVENT,
    SHADOW_BRIDGE_HELLO,
    SHADOW_BRIDGE_READY,
    type ShadowAttachDetail,
} from "@/main/dom/shadowBridgeProtocol";

/**
 * MAIN-world bridge for Shadow DOM support. Two jobs, both impossible from the
 * isolated world:
 *
 * 1. **Closed roots.** `attachShadow({mode:"closed"})` returns a root the page
 *    keeps in a closure and never exposes — `host.shadowRoot` is `null` for
 *    everyone, us included, so its content simply cannot be reached. Patching
 *    the constructor to hand out an open root is the only interception point
 *    there is. Patching it from the isolated world would do nothing: content
 *    scripts get their own `Element.prototype`, so the page's calls never see it.
 *
 * 2. **Roots attached to already-connected elements.** Attaching a shadow root
 *    produces NO mutation record of any kind, so a component that renders on a
 *    delay (or on first interaction) is invisible until something unrelated
 *    happens to re-scan that subtree. This is why the bridge earns its keep even
 *    on pages that only use open roots.
 *
 * Must stay dependency-free (no `browser.*`, no extension imports beyond the
 * shared protocol constants) and must never throw into the page: this patches a
 * global on every page in every frame, and an exception here breaks the site.
 *
 * Deliberately accepted: forcing `mode: "open"` is observable — page code can
 * read `host.shadowRoot` where it expected `null`. Hiding that would mean also
 * patching the `shadowRoot` getter, which in turn changes what a second
 * `attachShadow` call does. Not worth it until a real site breaks.
 *
 * Out of reach, unfixable here: declarative Shadow DOM with
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

        function notify(host: Element, forcedOpen: boolean) {
            if (!ready) {
                if (pending.length < PENDING_LIMIT) pending.push(host);
                return;
            }
            try {
                const detail: ShadowAttachDetail = { forcedOpen };
                host.dispatchEvent(
                    new CustomEvent(SHADOW_ATTACH_EVENT, {
                        bubbles: true,
                        composed: true,
                        detail,
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
                const forcedOpen = init?.mode === "closed";
                const root = native.call(this, forcedOpen ? { ...init, mode: "open" } : init);
                notify(this, forcedOpen);
                return root;
            };
        } catch {
            // Frozen prototype / hardened page — degrade to open roots only.
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
                if (host.isConnected) notify(host, false);
            }
        });
    },
});
