// Per-shadow-root delivery of the translation stylesheet.
//
// `document.adoptedStyleSheets` and a `<style>` in `document.head` are scoped to
// the document tree ONLY. A `.duo-translation` node we insert inside a page's
// shadow root therefore gets none of it — no background, no border, no font
// colour — and `::highlight(duo-hl-*)` paints nothing, because a highlight rule
// must live in the tree scope of the text it paints. So the same CSS string
// `updateStyle` builds has to be delivered into every root we know about.
//
// Slotted content is the exception nobody should try to "fix": a light-DOM node
// assigned to a <slot> stays in the document's tree scope, so translations
// inserted next to it are already styled by the document sheet.
//
// Roots are styled EAGERLY on discovery rather than lazily on first insert:
// the `::highlight()` rule has to exist before the first hover paint (so a lazy
// path would need a second hook there anyway), the Chrome cost is one array push
// of a *shared* sheet, and lazy delivery would mean threading this through every
// write site — translateUnits, the restore sweeps, and both highlight painters.
import { IS_FIREFOX } from "@/main/constants";

/**
 * Style slots. One today; kept as a key so a second stylesheet (e.g. a site
 * rule's injectCss, if that is ever fanned out) cannot clobber this one —
 * `replaceSync` replaces a sheet's rules wholesale.
 */
type Slot = "translation";

const cssText = new Map<Slot, string>();
/** Chrome: one constructable sheet per slot, shared by every root. */
const sheets = new Map<Slot, CSSStyleSheet>();
/** Firefox / fallback: one <style> per (root, slot). */
const carriers = new Map<ShadowRoot, Map<Slot, HTMLStyleElement>>();
const styledRoots = new Set<ShadowRoot>();

/**
 * Whether the constructable-stylesheet path is usable for a *page-created* root.
 *
 * Our own roots are constructed by us and `loadTailwindIntoShadow` adopts into
 * them happily, but a page root's `adoptedStyleSheets` array lives in the page
 * realm — which is exactly the Xray failure mode that makes
 * `document.adoptedStyleSheets` read `undefined` from a Firefox content script.
 * jsdom also has no `adoptedStyleSheets` at all, so the probe doubles as the
 * test-environment guard. Resolved once per frame on first use.
 */
let adoptSupported: boolean | null = null;

function canAdopt(root: ShadowRoot): boolean {
    if (IS_FIREFOX) return false;
    if (adoptSupported !== null) return adoptSupported;
    try {
        adoptSupported = Array.isArray(root.adoptedStyleSheets) && typeof CSSStyleSheet === "function";
    } catch {
        adoptSupported = false;
    }
    return adoptSupported;
}

function sheetFor(slot: Slot): CSSStyleSheet | null {
    let sheet = sheets.get(slot);
    if (sheet) return sheet;
    try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText.get(slot) ?? "");
    } catch {
        return null;
    }
    sheets.set(slot, sheet);
    return sheet;
}

function carrierFor(root: ShadowRoot, slot: Slot): HTMLStyleElement | null {
    let bySlot = carriers.get(root);
    if (!bySlot) {
        bySlot = new Map();
        carriers.set(root, bySlot);
    }
    let el = bySlot.get(slot);
    if (el?.isConnected) return el;
    try {
        el = document.createElement("style");
        el.setAttribute("data-duo-shadow-css", slot);
        root.appendChild(el);
    } catch {
        return null;
    }
    bySlot.set(slot, el);
    return el;
}

function applySlot(root: ShadowRoot, slot: Slot): void {
    const css = cssText.get(slot);
    if (css === undefined) return;
    if (canAdopt(root)) {
        const sheet = sheetFor(slot);
        if (sheet) {
            try {
                if (!root.adoptedStyleSheets.includes(sheet)) {
                    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
                }
                return;
            } catch {
                // Fall through to the <style> carrier below.
            }
        }
    }
    const el = carrierFor(root, slot);
    if (el) el.textContent = css;
}

/** Apply every current slot to a newly discovered root. */
export function styleShadowRoot(root: ShadowRoot): void {
    styledRoots.add(root);
    for (const slot of cssText.keys()) applySlot(root, slot);
}

/** Drop everything we injected into `root` (it left the page, or we shut down). */
export function unstyleShadowRoot(root: ShadowRoot): void {
    styledRoots.delete(root);
    const bySlot = carriers.get(root);
    if (bySlot) {
        for (const el of bySlot.values()) el.remove();
        carriers.delete(root);
    }
    try {
        const mine = new Set(sheets.values());
        if (root.adoptedStyleSheets?.some((s) => mine.has(s))) {
            root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => !mine.has(s));
        }
    } catch {
        // Root already torn down — nothing to detach from.
    }
}

/**
 * Set (or update) a slot's CSS across every known root.
 *
 * On the Chrome path this is one `replaceSync` on the shared sheet no matter how
 * many roots exist — the same atomic-update win `updateStyle` already gets for
 * the document, which matters because the colour pickers in Options call this on
 * every drag tick.
 */
export function setShadowCss(slot: Slot, css: string): void {
    cssText.set(slot, css);
    const sheet = sheets.get(slot);
    if (sheet) {
        try {
            sheet.replaceSync(css);
        } catch {
            // Ignore: the carriers below still get the update.
        }
    }
    for (const root of styledRoots) applySlot(root, slot);
}

/** Remove a slot from every root. */
export function removeShadowCss(slot: Slot): void {
    cssText.delete(slot);
    const sheet = sheets.get(slot);
    sheets.delete(slot);
    for (const root of Array.from(styledRoots)) {
        const el = carriers.get(root)?.get(slot);
        if (el) {
            el.remove();
            carriers.get(root)!.delete(slot);
        }
        if (!sheet) continue;
        try {
            if (root.adoptedStyleSheets?.includes(sheet)) {
                root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
            }
        } catch {
            // Root already torn down.
        }
    }
}

/** Full teardown (global switch off). */
export function resetShadowCss(): void {
    for (const root of Array.from(styledRoots)) unstyleShadowRoot(root);
    styledRoots.clear();
    carriers.clear();
    sheets.clear();
    cssText.clear();
}
