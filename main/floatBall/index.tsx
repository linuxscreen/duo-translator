import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings as SettingsIcon } from "lucide-react";
import { browser } from "wxt/browser";
import { ACTION, CONFIG_KEY, DB_ACTION } from "@/main/constants";
import { setConfig } from "@/utils/db";
import { sendMessageToBackground } from "@/utils/message";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { t, useLang } from "@/main/aiWriting/i18n";
import { useDraggable } from "./useDraggable";
import { useFullscreen } from "./useFullscreen";
import { DUO_LOGO_SVG } from "./logo";

/**
 * Float ball is a pure UI surface. It does NOT own any business state
 * (translate-on/off, "is the ball enabled" flag, …). Those live in the
 * content script. Communication is one-way down via {@link FloatBallController}
 * methods, and one-way up via {@link FloatBallDeps} callbacks.
 *
 * Rebuilt as React + Tailwind inside a Shadow DOM (mirroring the AI Writing
 * dot). The legacy vanilla implementation lived in `main/floatBall.ts`.
 */
export interface FloatBallDeps {
    /** Hostname (with port) of the current page — used by the per-site "Disable
     *  on this site" close option. */
    domain: string;
    /** Initial visual state of the toggle (active = page is currently translated). */
    initiallyActive: boolean;
    /** User clicked the toggle while it was inactive — they want translation. */
    onTranslate(): void;
    /** User clicked the toggle while it was active — they want the original. */
    onRestore(): void;
    /**
     * User chose "Disable everywhere". The global config flag has already been
     * persisted; the caller only needs to update its in-memory mirror and tear
     * the ball down.
     */
    onClose(): void;
}

export interface FloatBallController {
    /** Sync the toggle visual to a translate-on/off value from the outside. */
    setActive(active: boolean): void;
    /** Tear down DOM and every event listener registered while mounted. */
    destroy(): void;
}

const HOST_ID = "duo-float-ball-host";
// Grace period before collapsing the expanded toolbar after the pointer leaves —
// tolerates brief excursions (e.g. to the close menu) without flicker.
const COLLAPSE_DELAY_MS = 150;

export async function mountFloatBall(deps: FloatBallDeps): Promise<FloatBallController> {
    // Defensive: never mount twice.
    document.getElementById(HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-duo-float-ball", "");
    // Attach to <html> rather than <body> so SPA frameworks that wipe/replace
    // the body element don't take the ball down with them.
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    const root = createRoot(mount);

    // Bridge imperative controller calls to React state. The component
    // registers its `setActive` setter here on mount.
    const api: { setActive: (v: boolean) => void } = { setActive: () => { } };

    root.render(
        <FloatBallApp
            deps={deps}
            register={(fn) => { api.setActive = fn; }}
        />,
    );

    return {
        setActive: (active: boolean) => api.setActive(active),
        destroy: () => {
            try { root.unmount(); } catch { }
            host.remove();
        },
    };
}

type CloseChoice = "session" | "site" | "forever";

function FloatBallApp({
    deps,
    register,
}: {
    deps: FloatBallDeps;
    register: (fn: (v: boolean) => void) => void;
}) {
    useLang();
    const [active, setActive] = useState(deps.initiallyActive);
    // Hover-to-expand: collapsed shows only the switch; expanded reveals the
    // vertical toolbar (app icon · switch · settings · close).
    const [expanded, setExpanded] = useState(false);
    // Settings/close row normally renders below the switch; flips above when the
    // ball sits too near the bottom edge for the row to fit underneath.
    const [buttonsAbove, setButtonsAbove] = useState(false);
    const [closeMenuOpen, setCloseMenuOpen] = useState(false);
    // Custom tooltip over the switch (native `title` renders below the cursor,
    // covering the settings/close row). Shown after a hover delay; flips below
    // the cluster when the ball sits too near the top edge to fit above.
    const [switchHover, setSwitchHover] = useState(false);
    const [tooltipBelow, setTooltipBelow] = useState(false);
    const tooltipTimer = useRef<number | null>(null);
    // "Hide until reload" / after a per-site or global disable: drop the ball
    // from the tree for the rest of this page's life (re-mounts on reload).
    const [sessionHidden, setSessionHidden] = useState(false);
    const ballRef = useRef<HTMLDivElement>(null);
    const closeBtnRef = useRef<HTMLButtonElement>(null);
    const collapseTimer = useRef<number | null>(null);
    // Tracks whether the pointer is currently over the ball, so menu-close can
    // decide whether to collapse (the close menu lives outside the ball, so a
    // plain mouseleave already fired by the time it closes).
    const hoveredRef = useRef(false);

    const fullscreen = useFullscreen();
    const { ready, dock, onMouseDown, movedRef } = useDraggable(ballRef);

    // Align the expanded toolbar (icon above / buttons below) away from a docked
    // edge so its wider rows never clip off-screen; centered when free-floating.
    // A small inset keeps the edge-side button (e.g. Close when docked right)
    // off the viewport boundary instead of flush against it.
    // not use
    const EDGE_INSET = 1;
    const horizPlace: React.CSSProperties =
        dock === "left" ? { left: EDGE_INSET }
            : dock === "right" ? { right: EDGE_INSET }
                : { left: "50%", transform: "translateX(-50%)" };

    // Tooltip sits ABOVE the switch (never below, so it can't cover the
    // settings/close row). Aligned to whichever side keeps it on-screen: pinned
    // right when docked right, left when docked left, centered when free.
    const tooltipHoriz: React.CSSProperties =
        dock === "left" ? { left: 0 }
            : dock === "right" ? { right: 0 }
                : { left: "50%", transform: "translateX(-50%)" };

    // Tooltip vertical placement, kept clear of the settings/close row:
    //  - buttons flipped above (near bottom) → tooltip above the buttons
    //  - near top (tooltipBelow) → below the buttons-below row
    //  - otherwise → just above the switch
    const tooltipVert: React.CSSProperties =
        buttonsAbove ? { bottom: "calc(100% + 30px)" }
            : tooltipBelow ? { top: "calc(100% + 30px)" }
                : { bottom: "calc(100% + 6px)" };

    // Let the content script push translate-on/off state in.
    useEffect(() => { register(setActive); }, [register]);

    const cancelCollapse = () => {
        if (collapseTimer.current !== null) {
            clearTimeout(collapseTimer.current);
            collapseTimer.current = null;
        }
    };
    const scheduleCollapse = () => {
        cancelCollapse();
        collapseTimer.current = window.setTimeout(() => setExpanded(false), COLLAPSE_DELAY_MS);
    };

    // Clean up the pending tooltip timer on unmount.
    useEffect(() => () => {
        if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current);
    }, []);

    const onSwitchEnter = () => {
        if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current);
        tooltipTimer.current = window.setTimeout(() => {
            // Decide above/below from the ball's current top: if there isn't
            // room for the tooltip above, flip it below the cluster instead.
            const el = ballRef.current;
            setTooltipBelow(!!el && el.getBoundingClientRect().top < 40);
            setSwitchHover(true);
        }, 1000);
    };
    const onSwitchLeave = () => {
        if (tooltipTimer.current !== null) {
            clearTimeout(tooltipTimer.current);
            tooltipTimer.current = null;
        }
        setSwitchHover(false);
    };

    const onToggle = () => {
        // A drag ends with a synthetic click — ignore it.
        if (movedRef.current) return;
        if (active) deps.onRestore();
        else deps.onTranslate();
    };

    const onPointerEnter = () => {
        hoveredRef.current = true;
        cancelCollapse();
        // Flip the settings/close row above the switch when there isn't enough
        // room below (ball near the bottom edge). Row ≈ 5px gap + ~18px tall.
        const el = ballRef.current;
        const vh = document.documentElement.clientHeight;
        setButtonsAbove(!!el && vh - el.getBoundingClientRect().bottom < 30);
        setExpanded(true);
    };
    const onPointerLeave = () => {
        hoveredRef.current = false;
        // Keep the toolbar open while the close menu is open (it lives outside
        // the ball); collapse will be re-evaluated when the menu closes.
        if (!closeMenuOpen) scheduleCollapse();
    };

    const onSettingsClick = () => {
        // Open the toolbar action popup anchored to the extension icon — same
        // surface/position as clicking the icon. Background calls
        // chrome.action.openPopup() (must run there, not in the content script).
        browser.runtime.sendMessage({ action: ACTION.OPEN_POPUP }).catch(() => { });
        setExpanded(false);
    };

    const onCloseClick = () => setCloseMenuOpen((v) => !v);

    const onMenuClose = () => {
        setCloseMenuOpen(false);
        // If the pointer already left while the menu was open, collapse now.
        if (!hoveredRef.current) setExpanded(false);
    };

    const handleCloseChoice = async (choice: CloseChoice) => {
        setCloseMenuOpen(false);
        if (choice === "session") {
            setSessionHidden(true);
        } else if (choice === "site") {
            // Per-site blacklist: persist domain.floatBallDisabled. content.ts
            // checks it on next mount; for this session we just hide.
            await sendMessageToBackground({
                action: DB_ACTION.DOMAIN_UPDATE,
                data: { domain: deps.domain, floatBallDisabled: true },
            });
            setSessionHidden(true);
        } else if (choice === "forever") {
            await setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, false);
            setSessionHidden(true);
            deps.onClose();
        }
    };

    const switchLabel = active
        ? t("floatBallTooltipRestore", "Show original")
        : t("floatBallTooltipTranslate", "Translate this page");

    if (sessionHidden) return null;

    // Shared style for the icon-sized auxiliary buttons (settings / close).
    const auxBtnClass =
        "h-[18px] w-[18px] inline-flex items-center justify-center rounded-full text-[#BFBFBF] transition-colors";

    return (
        <div
            ref={ballRef}
            style={{
                position: "fixed",
                left: 0,
                top: 0,
                zIndex: 2147483000,
                opacity: ready && !fullscreen ? 1 : 0,
                // Keep the layout box (for offsetWidth measurement) but make the
                // ball non-interactive while hidden (fullscreen video / pre-place).
                pointerEvents: ready && !fullscreen ? "auto" : "none",
                visibility: fullscreen ? "hidden" : "visible",
            }}
            className="select-none"
            onMouseDown={onMouseDown}
        >
            <div
                className="relative flex flex-col items-center"
                onMouseEnter={onPointerEnter}
                onMouseLeave={onPointerLeave}
            >
                {/* Transparent hover bridge. The buttons row is absolutely
                    positioned BELOW the switch, so the gap between it and the
                    switch falls OUTSIDE the wrapper's box — moving the pointer
                    into that gap would fire mouseleave and collapse the toolbar.
                    This child spans the gap + buttons row so the wrapper stays
                    "hovered" throughout. It's first in paint order (behind
                    everything), so the switch/buttons still receive clicks.
                    `top: 0` is deliberate: it must NOT extend above the switch,
                    or moving the pointer up off the switch would have to cross a
                    dead zone before mouseleave fires. */}
                {expanded && (
                    <div
                        aria-hidden="true"
                        style={{
                            position: "absolute",
                            // Extend toward whichever side the buttons row sits on
                            // (and never the other, to avoid a hover dead zone).
                            top: buttonsAbove ? "-30px" : 0,
                            bottom: buttonsAbove ? 0 : "-30px",
                            left: "-12px",
                            right: "-12px",
                        }}
                    />
                )}

                {/* app logo */}
                {/* App icon — absolutely placed ABOVE the switch so the switch
                    itself never shifts when the toolbar expands. Branding only
                    (no click); the small gap keeps it tied to the switch. */}
                {/* {expanded && (
                    <div
                        className="h-[36px] w-[36px]"
                        aria-hidden="true"
                        style={{ position: "absolute", bottom: "calc(100% + 2px)", ...horizPlace }}
                        dangerouslySetInnerHTML={{ __html: DUO_LOGO_SVG }}
                    />
                )} */}

                {/* Custom tooltip ABOVE the switch (left/right-aligned per dock)
                    so it never overlaps the settings/close row below. */}
                {switchHover && (
                    <div
                        role="tooltip"
                        style={{
                            position: "absolute",
                            ...tooltipVert,
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                            ...tooltipHoriz,
                        }}
                        className="px-2 py-1 rounded-md bg-[#0f1623] text-[#eef1f8] text-[12px] leading-none shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                    >
                        {switchLabel}
                    </div>
                )}

                <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label={switchLabel}
                    onClick={onToggle}
                    onMouseEnter={onSwitchEnter}
                    onMouseLeave={onSwitchLeave}
                    className={[
                        "relative flex w-[42px] h-[25px] rounded-full transition-[background,opacity] duration-300 hover:opacity-100 p-0.5",
                        active ? "bg-[#23C965]" : "bg-[#ED6C35]",
                        expanded ? "opacity-100" : "opacity-[0.35]",
                    ].join(" ")}
                >
                    {/* Knob geometry/slide is driven via inline style rather
                        than Tailwind's translate utilities: v4 composes
                        `translate` from @property-registered CSS variables,
                        which don't register reliably inside a Shadow DOM, so
                        the utility silently produces no movement. The
                        `left: calc(100% - 2px)` + `translateX(-100%)` pins the
                        knob's right side 2px from the track when active,
                        mirroring the 2px left inset at rest. */}
                    <span
                        className="absolute w-[20px] h-[20px] rounded-full bg-[#ECECEC] border-2 border-white"
                        style={{
                            top: "50%",
                            left: active ? "calc(100% - 2px)" : "2px",
                            transform: active
                                ? "translate(-100%, -50%)"
                                : "translate(0, -50%)",
                            transition: "left 0.2s ease, transform 0.2s ease",
                        }}
                    />
                </button>

                {/* Settings + Close share a single row, absolutely placed below
                    the switch (or above when the ball is near the bottom edge) —
                    so the switch never shifts on expand. */}
                {expanded && (
                    <div
                        className="flex flex-row items-center gap-1.5"
                        style={{
                            position: "absolute",
                            ...(buttonsAbove
                                ? { bottom: "calc(100% + 5px)" }
                                : { top: "calc(100% + 5px)" }),
                        }}
                    >
                        <button
                            type="button"
                            aria-label={t("settings", "Settings")}
                            title={t("settings", "Settings")}
                            onClick={onSettingsClick}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={auxBtnClass}
                        >
                            <SettingsIcon className="h-4 w-4" />
                        </button>
                        <button
                            ref={closeBtnRef}
                            type="button"
                            aria-label={t("aiClose", "Close")}
                            title={t("aiClose", "Close")}
                            onClick={onCloseClick}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={auxBtnClass}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" fill="none">
                                <path d="M15.5051 4.58459L14.764 5.32621C15.6138 6.64036 15.9873 8.20617 15.8222 9.76241C15.6571 11.3187 14.9634 12.7712 13.8567 13.8778C12.7501 14.9844 11.2975 15.678 9.74122 15.8431C8.18497 16.0081 6.61919 15.6345 5.30508 14.7846L4.56399 15.5256C5.87389 16.4274 7.42728 16.909 9.01758 16.9065C13.3632 16.9065 16.8861 13.3837 16.8861 9.03818C16.8886 7.44788 16.4069 5.89449 15.5051 4.58459ZM15.3134 1.77385L14.076 3.01135C12.6603 1.81939 10.8683 1.16698 9.01758 1.16969C4.67192 1.16969 1.14909 4.6934 1.14909 9.03818C1.14638 10.8889 1.79879 12.6809 2.99075 14.0966L1.65815 15.4292L2.57081 16.3419L16.2262 2.68668L15.3134 1.77385ZM2.71442 11.7002C2.11848 10.2924 2.01131 8.72559 2.41003 7.24978C2.80875 5.77397 3.69037 4.47426 4.91417 3.55812C6.13796 2.64198 7.63339 2.16221 9.16176 2.19539C10.6901 2.22857 12.1633 2.77279 13.3462 3.74119L3.72059 13.3666C3.30705 12.8623 2.96819 12.301 2.71442 11.7002Z" fill="currentColor" />
                            </svg>
                        </button>
                    </div>
                )}

                {closeMenuOpen && (
                    <CloseMenu
                        anchorRef={closeBtnRef}
                        onPick={handleCloseChoice}
                        onClose={onMenuClose}
                    />
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Close menu — mirrors the AI Writing dot's CloseMenu (session / per-site /
// forever). The ball is freely draggable, so the menu is viewport-anchored
// (position: fixed) and clamped on every edge to stay fully visible.
// ---------------------------------------------------------------------------

function CloseMenu({
    anchorRef,
    onPick,
    onClose,
}: {
    anchorRef: React.RefObject<HTMLElement | null>;
    onPick: (c: CloseChoice) => void;
    onClose: () => void;
}) {
    useLang();
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    // Compute a viewport-clamped position from the anchor (close button) rect
    // and the menu's own measured size. Prefer below the anchor; flip above
    // when the bottom would overflow; clamp horizontally into the viewport.
    useLayoutEffect(() => {
        const menu = ref.current;
        const anchor = anchorRef.current;
        if (!menu || !anchor) return;
        const MARGIN = 8;
        const GAP = 6;
        const compute = () => {
            const a = anchor.getBoundingClientRect();
            const m = menu.getBoundingClientRect();
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;

            let top = a.bottom + GAP;
            if (top + m.height > vh - MARGIN) {
                const above = a.top - GAP - m.height;
                top = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - m.height);
            }
            let left = a.left;
            left = Math.min(left, vw - MARGIN - m.width);
            left = Math.max(MARGIN, left);
            setPos({ left, top });
        };
        compute();
        window.addEventListener("resize", compute);
        window.addEventListener("scroll", compute, true);
        return () => {
            window.removeEventListener("resize", compute);
            window.removeEventListener("scroll", compute, true);
        };
    }, [anchorRef]);

    // Click-away. We live in a Shadow DOM, so document-level events are
    // retargeted to the host — inspect the real path via composedPath().
    // Clicks on the anchor (close button) are ignored so its own onClick can
    // toggle the menu closed without this handler racing it.
    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const menu = ref.current;
            if (!menu) return;
            const path = e.composedPath();
            if (path.includes(menu)) return;
            if (anchorRef.current && path.includes(anchorRef.current)) return;
            onClose();
        };
        const id = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        return () => {
            clearTimeout(id);
            document.removeEventListener("mousedown", onDown, true);
        };
    }, [onClose, anchorRef]);

    return (
        <div
            ref={ref}
            // Block mousedown from starting a ball drag / stealing focus.
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: "fixed",
                left: pos ? pos.left : -9999,
                top: pos ? pos.top : -9999,
                zIndex: 2147483001,
                visibility: pos ? "visible" : "hidden",
            }}
            className="min-w-[230px] rounded-md bg-[#0f1623] border border-[rgba(140,180,230,0.18)] shadow-[0_8px_24px_rgba(0,0,0,0.5)] py-1"
        >
            <div className="flex items-center justify-between px-3 pb-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#8a93a8]">
                    {t("floatBallCloseTitle", "Disable floating ball")}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={t("aiClose", "Close")}
                    className="h-5 w-5 inline-flex items-center justify-center rounded text-[#8a93a8] hover:bg-[rgba(120,200,230,0.08)]"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <MenuItem onClick={() => onPick("session")} label={t("aiCloseTemporary", "Hide until reload")} />
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
            onMouseDown={(e) => e.stopPropagation()}
            className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-[rgba(120,200,230,0.08)] ${danger ? "text-red-300 hover:text-red-200" : "text-[#eef1f8]"}`}
        >
            {label}
        </button>
    );
}
