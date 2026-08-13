import { deepContains } from "./shadowTraversal";

/**
 * Our own panels whose text is READING MATERIAL, not chrome.
 *
 * The selection icon hides itself for anything inside our own UI — offering to
 * translate our own buttons would be noise — and that blanket rule is right for
 * every surface except the few that exist to be read. The selection-translate
 * popup is special-cased in the icon rather than registered here (a selection
 * made inside it re-uses the card in place); the panels registered here are the
 * general case: their selections behave exactly like page text.
 *
 * Registered by HOST, not by ShadowRoot, so `deepContains` answers correctly
 * for an event target that has been retargeted to the host.
 */
const surfaces = new Set<HTMLElement>();

/** Returns the disposer; call it from the surface's teardown path. */
export function registerSelectableSurface(host: HTMLElement): () => void {
    surfaces.add(host);
    return () => {
        surfaces.delete(host);
    };
}

export function isInSelectableSurface(node: Node | null | undefined): boolean {
    for (const host of surfaces) {
        if (deepContains(host, node)) return true;
    }
    return false;
}

