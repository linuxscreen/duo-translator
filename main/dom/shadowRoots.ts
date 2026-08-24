// Registry of the page's shadow roots, plus the "this one is ours" ownership
// set that keeps the marking scan out of our own UI.
//
// Two halves, deliberately in one module because they answer the same question
// from opposite sides:
//
//   - **ownership** — the six Shadow DOM surfaces the extension mounts itself
//     (float ball, AI dot, workbench, selection popup, video-subtitle menu, rule
//     hint dialog). The moment the marking scan learns to pierce shadow roots it
//     would otherwise walk straight into them and *translate our own interface*,
//     and main/lang.ts would sample our UI copy into the page-language vote.
//     A registry — not an attribute selector — is the authority here: the hosts
//     do not share one marker attribute (`data-duo-ai-ui` vs `data-duo-rule-ui`
//     vs `data-duo-float-ball`) and the video-subtitle host is mounted *inside*
//     page content, where the scan really does reach it.
//
//   - **discovery** — every page-owned root we know about, so the content
//     MutationObserver can observe it, styles can be injected into it, and the
//     deep queries below have somewhere to look.
//
// Discovery has two sources:
//   1. the marking scan, via `noteElement` on each visited element (one property
//      read) — covers everything present when a scan runs;
//   2. the content MutationObserver — a host inserted with its root already
//      attached gets scanned through the normal pending-roots path.
//
// There used to be a third: a MAIN-world content script that wrapped
// `Element.prototype.attachShadow`, the only notification point for a root
// attached to an ALREADY-CONNECTED element (that emits no mutation record of
// any kind). **It is gone, and must not come back in that form.** Replacing a
// native DOM method is exactly what anti-bot fingerprinting looks for — the
// patched function fails the `[native code]` check on `toString()`, and an
// anonymous function assigned to a member expression also reports `name: ""`
// where the native one reports `"attachShadow"`. On leetcode.com's login page
// that got Cloudflare to answer 600010 ("Bot behavior detected"), telling the
// user they were a bot with nothing on screen pointing at a translation
// extension. Bisected: with a second DOM-heavy extension held installed,
// removing the patch was the single change that flipped fail → pass; keeping
// the patch but skipping the notification did not.
//
// What that costs is small, because (2) covers more than it looks like:
// `connectedCallback` runs synchronously during insertion, and our observer
// callback is a microtask that runs after that task — so by the time we scan,
// the root a custom element attached is already there. That is Lit, Stencil,
// FAST and every mainstream design system. What is genuinely lost is a root
// attached to an element that has been connected for a while, where no light-DOM
// mutation follows near it (an interaction-triggered `attachShadow` that touches
// nothing else). Even that self-heals on the next mutation under that host,
// since `noteElement` runs on every element every scan.
//
// A periodic idle sweep would buy those cases back for ~1 ms a pass, and was
// deliberately NOT added: it means a permanent background timer on every page,
// and no real site has been shown to need it. Add it when one is.
import { deepContains, isShadowRoot, parentOrHost } from "@/main/dom/shadowTraversal";

export interface ShadowDiscoveryHandlers {
    /**
     * A page root we had not seen before. Fired once per root.
     *
     * Every root now arrives from the marking scan, which is already about to
     * descend into it — so the handler only has to style and observe it, never
     * to queue it for a scan of its own.
     */
    onRootAdded?: (root: ShadowRoot) => void;
    /** A page root whose host left the document. */
    onRootRemoved?: (root: ShadowRoot) => void;
}

const pageRoots = new Set<ShadowRoot>();
const ownHosts = new WeakSet<Element>();
const ownRoots = new WeakSet<ShadowRoot>();

let handlers: ShadowDiscoveryHandlers = {};

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Attach (or reuse) a shadow root for one of our own UI surfaces, registering it
 * as ours in the same breath.
 *
 * This is the only supported way for the extension to create a shadow root: the
 * registration has to happen atomically with the attach, because a scan running
 * in between would see an unregistered host and mark our interface as page
 * content. Every new persistent surface must go through here.
 */
export function attachOwnShadow(
    host: Element,
    init: ShadowRootInit = { mode: "open" },
): ShadowRoot {
    ownHosts.add(host);
    const root = host.shadowRoot ?? host.attachShadow(init);
    ownRoots.add(root);
    return root;
}

/** Whether `el` hosts one of our own UI surfaces. */
export function isOwnHost(node: Node | null | undefined): boolean {
    return !!node && ownHosts.has(node as Element);
}

/** Whether `root` is one of our own UI surfaces' roots. */
export function isOwnShadowRoot(node: Node | null | undefined): boolean {
    return !!node && isShadowRoot(node) && ownRoots.has(node);
}

/**
 * Whether `node` is our own UI, or lives inside it. Climbs the composed
 * ancestry, so it answers correctly from deep inside a surface's React tree.
 */
export function isInOwnUi(node: Node | null | undefined): boolean {
    for (let cur: Node | null = node ?? null; cur; cur = parentOrHost(cur)) {
        if (isOwnHost(cur) || isOwnShadowRoot(cur)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Probe `el` for a page-owned shadow root, registering it on first sight.
 * Returns the root so the caller can descend into it, or null when there is
 * none — or when it is one of ours.
 *
 * Called once per element visited by the marking scan, so it must stay at one
 * property read plus a Set lookup.
 */
export function noteElement(el: Element): ShadowRoot | null {
    const root = (el as HTMLElement).shadowRoot;
    if (!root) return null;
    if (ownHosts.has(el) || ownRoots.has(root)) return null;
    if (!pageRoots.has(root)) {
        pageRoots.add(root);
        handlers.onRootAdded?.(root);
    }
    return root;
}

/** The page-owned shadow root of `el`, without registering anything. */
export function pageShadowRootOf(el: Element): ShadowRoot | null {
    const root = (el as HTMLElement).shadowRoot;
    if (!root || ownHosts.has(el) || ownRoots.has(root)) return null;
    return root;
}

/** Whether we already know about this root. */
export function isKnownRoot(root: ShadowRoot): boolean {
    return pageRoots.has(root);
}

/**
 * Every registered page root, sweeping the ones whose host has left the
 * document — the same self-healing `allParagraphs()` does for marks, and what
 * keeps an SPA navigation from leaking detached trees through this Set.
 */
export function knownRoots(): ShadowRoot[] {
    forgetDisconnectedRoots();
    return Array.from(pageRoots);
}

/** Drop a root we know is gone (removal is observable before disconnection). */
export function forgetRoot(root: ShadowRoot): void {
    if (!pageRoots.delete(root)) return;
    handlers.onRootRemoved?.(root);
}

/**
 * Drop every root whose host has left the document. Called once per mutation
 * batch from content.ts, and by `knownRoots()` on its way past.
 *
 * This replaced a `forgetRootsUnder(removed)` called once per removed node,
 * which tested `deepContains(removed, root.host)` against the whole registry —
 * the same O(removed x registry x depth) shape that made the marks sweep cost
 * seconds per keystroke (see the note on `deepContains`). `isConnected` has
 * already flipped by the time the observer runs, so it was always the cheaper
 * question to ask, and it is the one `knownRoots()` has asked all along.
 */
export function forgetDisconnectedRoots(): void {
    if (pageRoots.size === 0) return;
    for (const root of Array.from(pageRoots)) {
        if (!root.isConnected) forgetRoot(root);
    }
}

/** Register the discovery callbacks. Returns a disposer. */
export function startShadowDiscovery(next: ShadowDiscoveryHandlers): () => void {
    handlers = next;
    return () => {
        handlers = {};
    };
}

/** Forget every page root (global switch off / full teardown). */
export function resetShadowRoots(): void {
    for (const root of Array.from(pageRoots)) forgetRoot(root);
    pageRoots.clear();
}

// ---------------------------------------------------------------------------
// Deep queries
//
// These live here rather than in shadowTraversal.ts because they are answered
// from the registry: one `querySelectorAll` per known root instead of a walk
// over every element. They therefore only see *registered* roots — which is all
// of them once a scan has run, and all of them from document_start once the
// bridge is live.
// ---------------------------------------------------------------------------

function collectInto(out: Element[], scope: ParentNode, selector: string): void {
    try {
        out.push(...Array.from(scope.querySelectorAll(selector)));
    } catch {
        // Invalid selector — the same silent drop compileSelectorList applies.
    }
}

/**
 * `querySelectorAll` across the light DOM and every known shadow root. Results
 * are grouped by tree, NOT in composed document order — callers that enumerate
 * (`.duo-selected`, leftover sweeps) do not care, and imposing an order would
 * cost a full composed-tree walk.
 */
export function deepQuerySelectorAll(selector: string, scope: ParentNode = document): Element[] {
    const out: Element[] = [];
    collectInto(out, scope, selector);
    const scoped = scope !== document;
    for (const root of knownRoots()) {
        if (scoped && !deepContains(scope as Node, root.host)) continue;
        collectInto(out, root, selector);
    }
    return out;
}

/** First match across the light DOM and every known shadow root. */
export function deepQuerySelector(selector: string, scope: ParentNode = document): Element | null {
    try {
        const hit = scope.querySelector(selector);
        if (hit) return hit;
    } catch {
        return null;
    }
    const scoped = scope !== document;
    for (const root of knownRoots()) {
        if (scoped && !deepContains(scope as Node, root.host)) continue;
        const hit = root.querySelector(selector);
        if (hit) return hit;
    }
    return null;
}
