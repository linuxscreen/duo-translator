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
// Discovery has three sources, and all three are needed:
//   1. the marking scan, via `noteElement` on each visited element (one property
//      read) — covers everything present when a scan runs;
//   2. the content MutationObserver — a host inserted with its root already
//      attached gets scanned through the normal pending-roots path;
//   3. the MAIN-world bridge — the ONLY way to learn about `attachShadow` called
//      on an already-connected element, which produces no mutation record at
//      all. That is the bridge's whole purpose; it does NOT open closed roots.
import { deepContains, isShadowRoot, parentOrHost } from "@/main/dom/shadowTraversal";
import { SHADOW_ATTACH_EVENT, SHADOW_BRIDGE_READY } from "@/main/dom/shadowBridgeProtocol";

/** Where a root came from — the caller needs to know whether to scan it. */
export type RootSource =
    /** Found by the marking scan, which is already about to descend into it. */
    | "scan"
    /** Reported by the MAIN-world bridge; nothing has scanned it yet. */
    | "bridge";

export interface ShadowDiscoveryHandlers {
    /** A page root we had not seen before. Fired once per root. */
    onRootAdded?: (root: ShadowRoot, source: RootSource) => void;
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
export function noteElement(el: Element, source: RootSource = "scan"): ShadowRoot | null {
    const root = (el as HTMLElement).shadowRoot;
    if (!root) return null;
    if (ownHosts.has(el) || ownRoots.has(root)) return null;
    if (!pageRoots.has(root)) {
        pageRoots.add(root);
        handlers.onRootAdded?.(root, source);
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
    const out: ShadowRoot[] = [];
    for (const root of pageRoots) {
        if (!root.isConnected) {
            pageRoots.delete(root);
            handlers.onRootRemoved?.(root);
            continue;
        }
        out.push(root);
    }
    return out;
}

/** Drop a root we know is gone (removal is observable before disconnection). */
export function forgetRoot(root: ShadowRoot): void {
    if (!pageRoots.delete(root)) return;
    handlers.onRootRemoved?.(root);
}

/**
 * Drop every root under `removed` (inclusive). Called from the MutationObserver
 * while the removed subtree is still identifiable — `root.isConnected` has
 * already flipped by then, but the tree is still walkable.
 */
export function forgetRootsUnder(removed: Node): void {
    if (pageRoots.size === 0) return;
    for (const root of Array.from(pageRoots)) {
        if (deepContains(removed, root.host)) forgetRoot(root);
    }
}

/**
 * Register the discovery callbacks and open the MAIN-world bridge. Returns a
 * disposer.
 *
 * Must be called in `content()`'s FIRST synchronous pass. The bridge runs at
 * document_start and buffers hosts until we say we are listening; components
 * attach most of their roots long before `content()` finishes awaiting its
 * config reads, so a late handshake means a late (or, past the buffer cap,
 * lost) replay.
 */
export function startShadowDiscovery(next: ShadowDiscoveryHandlers): () => void {
    handlers = next;
    const stopBridge = startShadowBridge();
    return () => {
        handlers = {};
        stopBridge();
    };
}

// ---------------------------------------------------------------------------
// MAIN-world bridge (isolated side)
// ---------------------------------------------------------------------------

/** Probes allowed per window before we assume the page is flooding us. */
const PROBE_RATE_LIMIT = 500;
const PROBE_WINDOW_MS = 1000;
/** How long to stay deaf after tripping the limit. */
const PROBE_COOLDOWN_MS = 5000;

function startShadowBridge(): () => void {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return () => { };
    }

    const queued = new Set<Element>();
    let flushScheduled = false;
    let windowStart = 0;
    let windowCount = 0;
    let deafUntil = 0;

    const flush = () => {
        flushScheduled = false;
        for (const host of queued) noteElement(host, "bridge");
        queued.clear();
    };

    const onAttach = (e: Event) => {
        const now = Date.now();
        if (now < deafUntil) return;
        // A page script can dispatch this event too. Nothing privileged sits
        // behind it — the worst it buys is a probe of a node we would probe
        // anyway — so the only real risk is CPU. Hence a rate limit rather than
        // a nonce, which the page could simply read off the event it observes.
        if (now - windowStart > PROBE_WINDOW_MS) {
            windowStart = now;
            windowCount = 0;
        }
        if (++windowCount > PROBE_RATE_LIMIT) {
            deafUntil = now + PROBE_COOLDOWN_MS;
            queued.clear();
            return;
        }
        const host = (e as CustomEvent).composedPath?.()[0];
        if (!host || (host as Node).nodeType !== Node.ELEMENT_NODE) return;
        if (!(host as HTMLElement).shadowRoot) return;
        queued.add(host as Element);
        if (!flushScheduled) {
            flushScheduled = true;
            // Coalesced into one batch: a component tree mounting attaches many
            // roots in one synchronous burst.
            queueMicrotask(flush);
        }
    };

    document.addEventListener(SHADOW_ATTACH_EVENT, onAttach, true);
    try {
        window.postMessage({ type: SHADOW_BRIDGE_READY }, "*");
    } catch {
        // Bridge absent (older browser, hardened page) — open roots still get
        // found by the marking scan, we just lose late attachments.
    }

    return () => {
        document.removeEventListener(SHADOW_ATTACH_EVENT, onAttach, true);
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
