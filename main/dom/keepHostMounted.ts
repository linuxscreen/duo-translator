/**
 * Keep a top-level UI host attached to <html> even when the page rewrites the
 * document root.
 *
 * SPA frameworks that hydrate/re-render at the document root (e.g. a Next.js
 * hydration-mismatch recovery rebuilds every child of <html> — hub.docker.com
 * does this ~2s after load) silently remove extension nodes injected there,
 * taking the float ball / AI dot / workbench down with them. Re-appending the
 * SAME host element preserves its ShadowRoot and the React root inside, so the
 * surface survives without any re-render or state loss.
 */

// Give up when the page keeps removing us — a persistent removal storm means
// fighting it would just burn CPU (normal hydration removes the host once).
const MAX_REATTACHES_PER_WINDOW = 10;
const WINDOW_MS = 10_000;

export function keepHostMounted(host: HTMLElement): () => void {
    let reattachScheduled = false;
    let attempts = 0;
    let windowStart = 0;

    const observer = new MutationObserver(() => {
        if (host.isConnected || reattachScheduled) return;
        const now = Date.now();
        if (now - windowStart > WINDOW_MS) {
            windowStart = now;
            attempts = 0;
        }
        if (++attempts > MAX_REATTACHES_PER_WINDOW) {
            observer.disconnect();
            return;
        }
        reattachScheduled = true;
        // Re-append asynchronously: the framework may still be mid-rebuild in
        // this mutation batch; inserting synchronously from the observer
        // callback could interleave with its own DOM writes.
        queueMicrotask(() => {
            reattachScheduled = false;
            if (!host.isConnected) document.documentElement.appendChild(host);
        });
    });
    // The host is always a direct child of <html>, so a plain childList
    // observation (no subtree) is enough to see it being removed.
    observer.observe(document.documentElement, { childList: true });
    return () => observer.disconnect();
}
