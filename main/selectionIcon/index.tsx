import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Languages, X } from "lucide-react";
import { CONFIG_KEY, DB_ACTION, DEFAULT_VALUE } from "@/main/constants";
import { getConfig, setConfig } from "@/utils/db";
import { sendMessageToBackground } from "@/utils/message";
import { attachOwnShadow, isInOwnUi } from "@/main/dom/shadowRoots";
import { keepHostMounted } from "@/main/dom/keepHostMounted";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import { openSelectionTranslate } from "@/main/aiWriting/selectionPopup";

/**
 * Selection translate icon — the small button that appears under a text
 * selection and opens the selection-translate popup.
 *
 * ONE implementation for the whole extension. The video-subtitle overlay used
 * to draw its own copy inside the player; it now relies on this surface, so
 * `CONFIG_KEY.SELECTION_ICON_SWITCH` and the per-site disable govern the icon
 * everywhere — including subtitle text selected inside a player. The overlay
 * keeps only what is genuinely its own (pause-on-select).
 *
 * Mounted per frame (a selection belongs to the document it lives in), and
 * lazily: nothing but three document listeners exists until the user actually
 * selects something, so an ad iframe never pays for a React root.
 */

const HOST_ID = "duo-selection-icon-host";

/**
 * Side of the icon button, px. Deliberately small: the pill sits on top of the
 * page's own text, so it has to read as an affordance next to the selection
 * rather than as a widget covering the line below it.
 */
const ICON_PX = 21;
/** Side of the close button revealed on hover. */
const CLOSE_PX = 18;
/** Padding inside the pill, the gap between its buttons, and its border. */
const PILL_PAD_PX = 2;
const PILL_GAP_PX = 2;
const PILL_BORDER_PX = 1;
/**
 * Widest and tallest the pill ever gets — the clamps below reserve this much
 * so revealing the close button can never push it off an edge. Derived rather
 * than written out, so resizing a button can't silently invalidate the clamp.
 */
const PILL_MAX_W =
    ICON_PX + PILL_GAP_PX + CLOSE_PX + 2 * PILL_PAD_PX + 2 * PILL_BORDER_PX;
const PILL_H = ICON_PX + 2 * PILL_PAD_PX + 2 * PILL_BORDER_PX;
/** Gap between the selection and the pill. */
const GAP_PX = 6;
/** Keep this clear of every viewport edge. */
const MARGIN_PX = 6;

interface IconAnchor {
    /** Viewport coordinates of the pill's top-left corner. */
    x: number;
    y: number;
    text: string;
    /** Bounding rect of the selection — the popup anchors to it, not to us. */
    rect: DOMRect | null;
}

let iconHost: HTMLElement | null = null;
let iconRoot: Root | null = null;
let stopKeepAlive: (() => void) | null = null;
let showSignal: ((a: IconAnchor) => void) | null = null;
let hideSignal: (() => void) | null = null;
/**
 * The very first selection builds the React root and asks it to show in the
 * same tick — before the effect that publishes `showSignal` has run. Parking
 * the anchor here (rather than polling for the signal) makes the first icon
 * appear on the first commit instead of a retry later.
 */
let pendingAnchor: IconAnchor | null = null;
/**
 * "Hide until reload" — module lifetime on purpose. The content script is
 * never unloaded, so this outlives every selection but not a page load.
 */
let sessionHidden = false;
/**
 * Set by the component while the close menu is open. The controller consults
 * it before hiding: the menu must survive the selection going away underneath
 * it (a click on a menu item is not a click on the page's text).
 */
let menuOpen = false;
/**
 * Set by the controller so the surface can dismiss itself for good (the user
 * clicked Translate, or a disable choice). Going through the controller is
 * what drops the stored range — hiding the React state alone would leave the
 * next scroll free to bring the pill back.
 */
let controllerDismiss: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Mount entry point — called once per frame from main/content.ts
// ---------------------------------------------------------------------------

export interface MountOptions {
    /** Hostname (with port) for the per-site disable lookup. */
    domain: string;
}

export async function mountSelectionIcon(opts: MountOptions): Promise<() => void> {
    const [enabledConfig, domainDoc] = await Promise.all([
        getConfig(CONFIG_KEY.SELECTION_ICON_SWITCH),
        sendMessageToBackground({ action: DB_ACTION.DOMAIN_GET, data: { domain: opts.domain } }),
    ]);
    const enabled = enabledConfig === undefined
        ? !!DEFAULT_VALUE.SELECTION_ICON_SWITCH
        : !!enabledConfig;
    if (!enabled) return () => { };
    // Per-site disable: "Disable on this site" from the icon's close menu.
    if (domainDoc?.selectionIconDisabled) return () => { };

    // A fresh mount is either page load or the feature being switched back on
    // — both mean the previous "hide until reload" no longer applies.
    sessionHidden = false;
    return startController(opts.domain);
}

// ---------------------------------------------------------------------------
// Controller — selection tracking and placement (no React until first show)
// ---------------------------------------------------------------------------

/** A selection's focus boundary — where the drag ENDED, not where it started. */
interface FocusPoint {
    node: Node;
    offset: number;
}

/**
 * Line box of the caret at a selection's focus point.
 *
 * This is what makes the pill land near the pointer regardless of drag
 * direction. `getClientRects()` on the range itself is in DOCUMENT order, so
 * its last rect is the selection's rightmost/lowest end — for a right-to-left
 * (backward) drag that is where the pointer STARTED, and the pill appeared at
 * the far side of the selection from the cursor. The focus boundary is the
 * moving end of a drag in either direction.
 *
 * Returns null when the caret has no geometry (an element-node boundary, a
 * detached node), leaving the caller on its document-order fallback.
 */
function caretRectOf(focus: FocusPoint): DOMRect | null {
    try {
        const r = document.createRange();
        r.setStart(focus.node, focus.offset);
        r.collapse(true);
        // A caret at a soft-wrap boundary reports two rects (end of one line,
        // start of the next); the first matches where the range itself ends.
        const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
        // A caret is zero-WIDTH by definition, so only height decides here.
        return rect && rect.height > 0 ? rect : null;
    } catch {
        return null;
    }
}

function startController(domain: string): () => void {
    /** Live clone of the selected range, so scrolling can re-measure it. */
    let anchorRange: Range | null = null;
    /** Where the selection's focus (caret) ended up — see `caretRectOf`. */
    let anchorFocus: FocusPoint | null = null;
    let selecting = false;
    let rafId: number | null = null;
    let settleTimer: number | null = null;
    let disposed = false;

    const hide = () => {
        anchorRange = null;
        anchorFocus = null;
        pendingAnchor = null;
        hideSignal?.();
    };
    controllerDismiss = hide;

    /**
     * Place the pill just under the line the pointer finished on — the caret at
     * the selection's focus, falling back to the selection's document-order end
     * when that caret can't be measured. Every edge is handled: the pill flips
     * above that same line when it would fall off the bottom, and its left is
     * clamped against both side edges using the pill's WIDEST state so
     * revealing the close button can never push it off-screen.
     */
    const anchorFor = (range: Range, text: string, focus: FocusPoint | null): IconAnchor | null => {
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
        const bounding = range.getBoundingClientRect();
        const spot = (focus && caretRectOf(focus)) ?? rects[rects.length - 1] ?? bounding;
        // A selection with no geometry at all (collapsed, display:none, or a
        // detached range) has nothing to point at.
        if (!spot || (spot.width === 0 && spot.height === 0)) return null;

        // `right` is the caret itself on the focus path and the selection's end
        // on the fallback; centring the icon on it puts the pill under the
        // pointer either way.
        let x = spot.right - ICON_PX / 2;
        x = Math.max(MARGIN_PX, Math.min(x, window.innerWidth - PILL_MAX_W - MARGIN_PX));

        let y = spot.bottom + GAP_PX;
        if (y + PILL_H > window.innerHeight - MARGIN_PX) {
            // No room below — sit above that line instead. Above the same line,
            // not above the whole selection: staying next to the pointer is the
            // point, and a tall selection would put it a screenful away.
            y = spot.top - GAP_PX - PILL_H;
        }
        y = Math.max(MARGIN_PX, Math.min(y, window.innerHeight - PILL_H - MARGIN_PX));

        return { x, y, text, rect: bounding.width > 0 || bounding.height > 0 ? bounding : null };
    };

    /** Re-evaluate the current selection and show/hide accordingly. */
    const sync = () => {
        if (disposed || sessionHidden) return;
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.rangeCount === 0 || text === "") {
            if (!menuOpen) hide();
            return;
        }
        // A selection inside one of our own panels (the translate popup's own
        // result text, the workbench) is not page content — offering to
        // translate it again would be noise.
        if (isInOwnUi(sel.anchorNode) || isInOwnUi(sel.focusNode)) {
            if (!menuOpen) hide();
            return;
        }
        const range = sel.getRangeAt(sel.rangeCount - 1);
        const focus: FocusPoint | null = sel.focusNode
            ? { node: sel.focusNode, offset: sel.focusOffset }
            : null;
        const anchor = anchorFor(range, text, focus);
        if (!anchor) {
            if (!menuOpen) hide();
            return;
        }
        anchorRange = range.cloneRange();
        anchorFocus = focus;
        ensureMounted(domain);
        if (showSignal) showSignal(anchor);
        else pendingAnchor = anchor;
    };

    /** Selection is only final after the event that changed it has finished. */
    const settle = () => {
        if (settleTimer !== null) clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
            settleTimer = null;
            sync();
        }, 0);
    };

    const onMouseDown = (e: MouseEvent) => {
        // Our own buttons preventDefault on mousedown, so the selection they
        // act on is still there; anything else starts a fresh interaction.
        if (isInOwnUi(e.composedPath()[0] as Node)) return;
        if (!menuOpen) hide();
        // Hold off re-showing for the length of a drag — the pill would
        // otherwise chase the pointer across the paragraph.
        selecting = true;
    };

    const onMouseUp = (e: MouseEvent) => {
        selecting = false;
        // A release on our own pill is the Translate/close click finishing —
        // re-syncing here would re-show the pill we are about to dismiss
        // (mouseup lands before click, and the selection is deliberately still
        // intact at this point).
        if (isInOwnUi(e.composedPath()[0] as Node)) return;
        settle();
    };

    /**
     * A drag released outside the window never delivers its mouseup here, which
     * would leave `selecting` stuck and the pill silently dead for the rest of
     * the page's life.
     */
    const onWindowBlur = () => {
        selecting = false;
    };

    const onSelectionChange = () => {
        // Mid-drag changes are handled by the mouseup that ends the drag.
        // Keyboard selections (shift+arrows, ctrl+A) only arrive here.
        if (selecting) return;
        settle();
    };

    /**
     * The pill is viewport-positioned, so a scroll invalidates it. Re-measuring
     * the stored range keeps it glued to the text instead of hiding it, which
     * matters most on the one surface that scrolls under a live selection.
     */
    const onViewportChange = () => {
        if (!anchorRange) return;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (disposed || !anchorRange) return;
            const sel = window.getSelection();
            const text = sel?.toString().trim() ?? "";
            if (text === "") return;
            const anchor = anchorFor(anchorRange, text, anchorFocus);
            if (!anchor) {
                if (!menuOpen) hide();
                return;
            }
            if (showSignal) showSignal(anchor);
            else pendingAnchor = anchor;
        });
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    // Capture, so nested scrollers are covered too.
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onWindowBlur);

    return () => {
        disposed = true;
        controllerDismiss = null;
        if (rafId !== null) cancelAnimationFrame(rafId);
        if (settleTimer !== null) clearTimeout(settleTimer);
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("mouseup", onMouseUp, true);
        document.removeEventListener("selectionchange", onSelectionChange);
        window.removeEventListener("scroll", onViewportChange, true);
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("blur", onWindowBlur);
        destroyIcon();
    };
}

// ---------------------------------------------------------------------------
// Shadow-DOM surface
// ---------------------------------------------------------------------------

/**
 * Keep the pill visible over a fullscreen element (selecting subtitle text in
 * a fullscreen player): only the fullscreen subtree renders, so the host must
 * live inside it. Reparenting the SAME host preserves the ShadowRoot and the
 * React root. Same pattern as the selection-translate popup.
 */
function reparentForFullscreen(): void {
    const host = iconHost;
    if (!host) return;
    const target = document.fullscreenElement ?? document.documentElement;
    if (target instanceof HTMLVideoElement) return;
    if (host.parentElement !== target) target.appendChild(host);
}

function ensureMounted(domain: string): void {
    if (iconRoot) {
        reparentForFullscreen();
        return;
    }
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-duo-ai-ui", "");
    document.documentElement.appendChild(host);
    iconHost = host;
    // Once built, the surface lives for the rest of the page — so it needs the
    // same protection as the other persistent hosts against SPAs that rebuild
    // <html>'s children and silently take it with them.
    stopKeepAlive = keepHostMounted(host);
    document.addEventListener("fullscreenchange", reparentForFullscreen);
    reparentForFullscreen();
    const shadow = attachOwnShadow(host);
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    bindThemeToElement(mount);
    iconRoot = createRoot(mount);
    iconRoot.render(
        <SelectionIconApp
            domain={domain}
            registerControl={(show, hide) => {
                showSignal = show;
                hideSignal = hide;
            }}
        />,
    );
}

function destroyIcon(): void {
    document.removeEventListener("fullscreenchange", reparentForFullscreen);
    stopKeepAlive?.();
    stopKeepAlive = null;
    showSignal = null;
    hideSignal = null;
    pendingAnchor = null;
    menuOpen = false;
    const root = iconRoot;
    // Captured, not re-queried by id: a teardown immediately followed by a
    // re-mount (global switch off→on) would have two hosts carrying the same
    // id in the document, and getElementById would hand back the wrong one.
    const host = iconHost;
    iconRoot = null;
    iconHost = null;
    if (root) {
        // Unmounting synchronously from inside a React event handler (the close
        // menu's own click) is unsafe — let the current event finish first.
        setTimeout(() => { try { root.unmount(); } catch { } host?.remove(); }, 0);
    } else {
        host?.remove();
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function SelectionIconApp({
    domain,
    registerControl,
}: {
    domain: string;
    registerControl: (show: (a: IconAnchor) => void, hide: () => void) => void;
}) {
    useLang();
    const [anchor, setAnchor] = useState<IconAnchor | null>(null);
    const [hovered, setHovered] = useState(false);
    const [closeMenuOpen, setCloseMenuOpen] = useState(false);

    // Registered in an effect, like the selection popup's open signal: the
    // controller may call it before the first paint has committed.
    useEffect(() => {
        registerControl(
            (a) => setAnchor(a),
            () => {
                setAnchor(null);
                setHovered(false);
                setCloseMenuOpen(false);
            },
        );
        if (pendingAnchor) {
            setAnchor(pendingAnchor);
            pendingAnchor = null;
        }
    }, [registerControl]);

    // Mirrored to module scope so the controller can leave the pill standing
    // while the menu is open.
    useEffect(() => {
        menuOpen = closeMenuOpen;
        return () => { menuOpen = false; };
    }, [closeMenuOpen]);

    if (sessionHidden || !anchor) return null;

    const dismiss = () => {
        setHovered(false);
        setCloseMenuOpen(false);
        menuOpen = false;
        // Drops the controller's stored range too, so the pill stays gone.
        if (controllerDismiss) controllerDismiss();
        else setAnchor(null);
    };

    const onTranslate = () => {
        const { text, rect } = anchor;
        dismiss();
        if (text !== "") openSelectionTranslate({ text, rect });
    };

    const onPick = async (choice: "session" | "site" | "forever") => {
        dismiss();
        if (choice === "session") {
            sessionHidden = true;
            return;
        }
        if (choice === "site") {
            await sendMessageToBackground({
                action: DB_ACTION.DOMAIN_UPSERT,
                data: { domain, selectionIconDisabled: true },
            });
            sessionHidden = true;
            return;
        }
        // "forever" — the config change fans out to every tab, which tears the
        // surface down; hide here too so this page reacts immediately.
        await setConfig(CONFIG_KEY.SELECTION_ICON_SWITCH, false);
        sessionHidden = true;
    };

    return (
        <div
            style={{ position: "fixed", left: anchor.x, top: anchor.y, zIndex: 2147483600 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { if (!closeMenuOpen) setHovered(false); }}
            // Never let a press on the pill reach the page: it would collapse
            // the selection we are about to translate, and on a video player it
            // would count as a click on the video (pause).
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => e.stopPropagation()}
            data-duo-ai-ui=""
        >
            {/* Padding/gap/border come from the constants rather than utility
                classes: the placement clamps are derived from the same numbers,
                and a class changed here would silently invalidate them. */}
            <div
                className="inline-flex items-center rounded-full bg-surface/95 border border-line-strong shadow-[0_4px_18px_rgba(0,0,0,0.35)] backdrop-blur-md"
                style={{ padding: PILL_PAD_PX, gap: PILL_GAP_PX, borderWidth: PILL_BORDER_PX }}
            >
                <button
                    type="button"
                    onClick={onTranslate}
                    title={t("translate", "Translate")}
                    aria-label={t("translate", "Translate")}
                    className="inline-flex items-center justify-center rounded-full text-ink hover:bg-hover-4 hover:text-accent"
                    style={{ height: ICON_PX, width: ICON_PX }}
                >
                    <Languages className="h-3.5 w-3.5" />
                </button>
                {(hovered || closeMenuOpen) && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setCloseMenuOpen((o) => !o)}
                            title={t("aiClose", "Close")}
                            aria-label={t("aiClose", "Close")}
                            className="inline-flex items-center justify-center rounded-full text-ink-soft hover:bg-hover-2 hover:text-ink"
                            style={{ height: CLOSE_PX, width: CLOSE_PX }}
                        >
                            <X className="h-3 w-3" />
                        </button>
                        {closeMenuOpen && (
                            <CloseMenu onPick={onPick} onClose={() => setCloseMenuOpen(false)} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Three-choice disable menu, anchored to the close button. Placement is solved
 * on both axes because the pill can sit anywhere in the viewport: it flips
 * above the button when it would overflow the bottom, and shifts horizontally
 * when either side edge would clip it.
 */
function CloseMenu({
    onPick,
    onClose,
}: {
    onPick: (c: "session" | "site" | "forever") => void;
    onClose: () => void;
}) {
    useLang();
    const ref = useRef<HTMLDivElement>(null);
    const [placeAbove, setPlaceAbove] = useState(false);
    const [shiftX, setShiftX] = useState(0);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - MARGIN_PX && rect.height + MARGIN_PX < rect.top) {
            setPlaceAbove(true);
        }
        const overflowRight = rect.right - (window.innerWidth - MARGIN_PX);
        const overflowLeft = MARGIN_PX - rect.left;
        if (overflowRight > 0) setShiftX(-overflowRight);
        else if (overflowLeft > 0) setShiftX(overflowLeft);
    }, []);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const popover = ref.current;
            if (!popover) return;
            const path = e.composedPath();
            if (path.includes(popover)) return;
            const wrapper = popover.parentElement;
            if (wrapper && path.includes(wrapper)) return;
            onClose();
        };
        const id = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            style={{ transform: shiftX ? `translateX(${shiftX}px)` : undefined }}
            className={`absolute right-0 min-w-[190px] rounded-md bg-surface border border-line-strong shadow-[0_8px_24px_rgba(0,0,0,0.5)] py-1 z-10 ${placeAbove ? "bottom-full mb-1" : "top-full mt-1"}`}
        >
            <div className="px-3 pb-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {t("disableSelectionIcon", "Disable selection translate icon")}
                </span>
            </div>
            <MenuItem onClick={() => onPick("session")} label={t("aiCloseTemporary", "Hide until next reload")} />
            <MenuItem onClick={() => onPick("site")} label={t("aiCloseThisSite", "Disable on this site")} />
            <MenuItem onClick={() => onPick("forever")} label={t("aiClosePermanently", "Disable everywhere")} danger />
        </div>
    );
}

function MenuItem({ onClick, label, danger }: { onClick: () => void; label: string; danger?: boolean }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-hover-2 ${danger ? "text-danger-ink hover:text-danger-ink-2" : "text-ink"}`}
        >
            {label}
        </button>
    );
}
