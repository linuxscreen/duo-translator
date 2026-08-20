import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Check, CircleSlash2, Settings as SettingsIcon, X } from "lucide-react";
import { ACTION, CONFIG_KEY, DB_ACTION, FLOAT_BALL_STYLE } from "@/main/constants";
import { setConfig } from "@/utils/db";
import { notifyBackground, sendMessageToBackground } from "@/utils/message";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { attachOwnShadow } from "@/main/dom/shadowRoots";
import { keepHostMounted } from "@/main/dom/keepHostMounted";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import { guardExtensionAlive } from "@/main/extensionDisabledNotice";
import { getViewportSize } from "@/utils/dom";
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
    /** Selected visual variant from Options. */
    style: FLOAT_BALL_STYLE;
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
const TOOLTIP_DELAY_MS = 350;
// Keep the result visible long enough to register, then get the control back out
// of the page's way — but ONLY once the pointer is no longer on the ball. See
// `scheduleAutoRetract`.
const AUTO_RETRACT_DELAY_MS = 700;

// ---------------------------------------------------------------------------
// Docked-style secondary actions (settings / close), stacked under the ball.
//
// The two hit boxes are exactly `DOCKED_ACTION_SIZE` tall and stacked with NO
// gap and NO negative margin, so neither box reaches over the other's glyph.
// (They used to be 44px boxes pulled together by `-mt-4`, which made them
// overlap by 14px: the region just below the settings glyph belonged to the
// close button that painted on top of it, so each glyph sat off-centre in the
// area that actually reacted to a click.)
// ---------------------------------------------------------------------------
// Keep in sync with the `h-8 w-8` on `auxBtnClass` (Tailwind needs the literal).
const DOCKED_ACTION_SIZE = 32;
const DOCKED_ACTIONS_HEIGHT = DOCKED_ACTION_SIZE * 2;
// The ball's box is 44px but its switch is only 32px, so ~6px of empty padding
// sits between the glyph and the box edge; pulling the stack back into the box
// cancels most of that out (without it the first action reads as noticeably
// further from the logo than the two actions are from each other).
//
// 2px is the largest inset that keeps the stack clear of the switch in BOTH
// directions: the translated-state check badge hangs 4px past the switch, to
// y=42 of the 44px box, and an action box overlapping it would paint on top and
// swallow clicks meant for the toggle.
const DOCKED_ACTIONS_INSET = 2;
/** How far the stack reaches past the ball's box, in whichever direction it flips. */
const DOCKED_ACTIONS_EXTENT = DOCKED_ACTIONS_HEIGHT - DOCKED_ACTIONS_INSET;
// Extra room demanded before the stack is allowed to stay below the ball. Fitting
// it flush against the viewport edge is technically possible and looks broken, so
// a ball this close to the bottom flips the stack above itself instead.
const DOCKED_ACTIONS_MARGIN = 16;

/**
 * Whether a focus event should count as *keyboard* focus, i.e. the only kind
 * that may expand the ball on its own.
 *
 * Clicking the toggle with the mouse leaves DOM focus on the button (nothing on
 * the drag path calls preventDefault, so the click focuses it). When the tab or
 * window is later re-activated, the browser hands focus back to that element and
 * re-fires `focus`/`focusin` — with the pointer nowhere near the ball. Expanding
 * on that is not just wrong at the moment it happens: no `mouseleave` can ever
 * follow, so the ball stays expanded for good.
 *
 * `:focus-visible` is exactly the distinction we need. It is false for
 * pointer-driven focus on a <button>, true when tabbed to — and on window
 * re-activation the browser restores it as it was, so the stale re-focus above
 * still reads false while a genuine keyboard focus still reads true.
 */
function isKeyboardFocus(target: EventTarget | null): boolean {
    const el = target as Element | null;
    if (!el || typeof el.matches !== "function") return false;
    try {
        return el.matches(":focus-visible");
    } catch {
        // Selector unsupported (pre-Chrome 86 / pre-Firefox 85, i.e. below our
        // MV3 floor — unreachable in practice). Don't expand: mouse users are
        // already covered by mouseenter, and re-introducing the stuck-open bug
        // is the worse of the two failures.
        return false;
    }
}

export async function mountFloatBall(deps: FloatBallDeps): Promise<FloatBallController> {
    // Defensive: never mount twice.
    document.getElementById(HOST_ID)?.remove();

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-duo-float-ball", "");
    // Attach to <html> rather than <body> so SPA frameworks that wipe/replace
    // the body element don't take the ball down with them. Frameworks that
    // rebuild <html>'s children still remove it — keepHostMounted re-attaches.
    document.documentElement.appendChild(host);
    const stopKeepAlive = keepHostMounted(host);
    const shadow = attachOwnShadow(host);
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    const stopThemeWatch = bindThemeToElement(mount);
    const root = createRoot(mount);

    // Bridge imperative controller calls to React state. The component
    // registers its `setActive` setter here on mount.
    const api: { setActive: (v: boolean) => void } = { setActive: () => { } };
    // `root.render` (React 18) commits asynchronously, so the component's
    // register-effect hasn't run yet when mountFloatBall resolves. A setActive()
    // that arrives in that window (e.g. auto-translate flipping the ball on right
    // after mount) would hit the no-op above and be silently lost — the ball then
    // stays visually OFF on a freshly auto-translated page. Buffer the last value
    // until the component registers, then flush it.
    let registered = false;
    let pendingActive: boolean | undefined;

    root.render(
        <FloatBallApp
            deps={deps}
            overlayRoot={mount}
            register={(fn) => {
                api.setActive = fn;
                registered = true;
                if (pendingActive !== undefined) {
                    fn(pendingActive);
                    pendingActive = undefined;
                }
            }}
        />,
    );

    return {
        setActive: (active: boolean) => {
            if (registered) api.setActive(active);
            else pendingActive = active;
        },
        destroy: () => {
            stopKeepAlive();
            stopThemeWatch();
            try { root.unmount(); } catch { }
            host.remove();
        },
    };
}

type CloseChoice = "session" | "site" | "forever";

function FloatBallApp({
    deps,
    overlayRoot,
    register,
}: {
    deps: FloatBallDeps;
    overlayRoot: HTMLElement;
    register: (fn: (v: boolean) => void) => void;
}) {
    useLang();
    const [active, setActive] = useState(deps.initiallyActive);
    // A docked ball rests partly outside the viewport. Revealing it brings the
    // full control and its secondary actions into view.
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
    const retractAfterDragRef = useRef<() => void>(() => { });
    // Tracks whether the pointer is currently over the ball, so menu-close can
    // decide whether to collapse (the close menu lives outside the ball, so a
    // plain mouseleave already fired by the time it closes).
    const hoveredRef = useRef(false);

    const fullscreen = useFullscreen();
    const isDockedStyle = deps.style === FLOAT_BALL_STYLE.DOCKED;
    const { ready, dock, onMouseDown, movedRef } = useDraggable(
        ballRef,
        () => retractAfterDragRef.current(),
        deps.style,
    );

    // The action stack is narrower than the ball's own box, which is always fully
    // inside the viewport (see useDraggable's clamping), so centring it on the
    // ball can never clip — and centring is what keeps each hit box concentric
    // with the logo above it, whichever edge the ball is docked to.
    const horizPlace: React.CSSProperties = { left: "50%", transform: "translateX(-50%)" };

    // Tooltip sits ABOVE the switch (never below, so it can't cover the
    // settings/close row). Aligned to whichever side keeps it on-screen: pinned
    // right when docked right, left when docked left, centered when free.
    const tooltipHoriz: React.CSSProperties =
        dock === "left" ? { left: 0 }
            : dock === "right" ? { right: 0 }
                : { left: "50%", transform: "translateX(-50%)" };

    // Tooltip vertical placement, kept clear of the stacked settings/close
    // actions:
    //  - buttons flipped above (near bottom) → tooltip above the stack
    //  - near top (tooltipBelow) → below the stack
    //  - otherwise → just above the switch
    const actionExtent = isDockedStyle ? DOCKED_ACTIONS_EXTENT + 6 : 30;
    const tooltipVert: React.CSSProperties =
        buttonsAbove ? { bottom: `calc(100% + ${actionExtent}px)` }
            : tooltipBelow ? { top: `calc(100% + ${actionExtent}px)` }
                : { bottom: "calc(100% + 6px)" };

    // Let the content script push translate-on/off state in.
    useEffect(() => { register(setActive); }, [register]);

    const cancelCollapse = () => {
        if (collapseTimer.current !== null) {
            clearTimeout(collapseTimer.current);
            collapseTimer.current = null;
        }
    };
    const scheduleCollapse = (delay = COLLAPSE_DELAY_MS) => {
        cancelCollapse();
        collapseTimer.current = window.setTimeout(() => {
            setExpanded(false);
            setSwitchHover(false);
        }, delay);
    };
    /**
     * Retract after an action the user just performed on the ball (toggle click,
     * drag release, opening settings).
     *
     * While the pointer is still on the ball, the user is not done with it — so
     * the only thing that may collapse it is `mouseleave`. Retracting under a
     * stationary cursor is worse than merely surprising: no `mouseenter` can
     * follow, so the toolbar can't be brought back without moving away first.
     */
    const scheduleAutoRetract = () => {
        if (!isDockedStyle || hoveredRef.current) return;
        scheduleCollapse(AUTO_RETRACT_DELAY_MS);
    };
    retractAfterDragRef.current = scheduleAutoRetract;

    const expandBall = () => {
        cancelCollapse();
        const el = ballRef.current;
        const vh = getViewportSize().height;
        const actionsHeight = isDockedStyle ? DOCKED_ACTIONS_EXTENT + DOCKED_ACTIONS_MARGIN : 30;
        setButtonsAbove(!!el && vh - el.getBoundingClientRect().bottom < actionsHeight);
        setExpanded(true);
    };

    // Clean up timers on unmount.
    useEffect(() => () => {
        if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current);
        if (collapseTimer.current !== null) clearTimeout(collapseTimer.current);
    }, []);

    const onSwitchEnter = () => {
        if (tooltipTimer.current !== null) clearTimeout(tooltipTimer.current);
        tooltipTimer.current = window.setTimeout(() => {
            // Decide above/below from the ball's current top: if there isn't
            // room for the tooltip above, flip it below the cluster instead.
            const el = ballRef.current;
            setTooltipBelow(!!el && el.getBoundingClientRect().top < 40);
            setSwitchHover(true);
        }, TOOLTIP_DELAY_MS);
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
        // The ball outlives the extension being disabled/updated (the content
        // script is never unloaded), so every action has to re-check before it
        // reaches anything backed by chrome.*.
        if (!guardExtensionAlive()) return;
        if (active) deps.onRestore();
        else deps.onTranslate();
        // Pointer still on the switch → keep the toolbar (and its tooltip, which
        // now reads the opposite action) up until the pointer leaves.
        if (isDockedStyle && !hoveredRef.current) {
            onSwitchLeave();
            scheduleAutoRetract();
        }
    };

    const onPointerEnter = () => {
        hoveredRef.current = true;
        expandBall();
    };
    const onPointerLeave = () => {
        hoveredRef.current = false;
        // Keep the toolbar open while the close menu is open (it lives outside
        // the ball); collapse will be re-evaluated when the menu closes.
        if (!closeMenuOpen) scheduleCollapse();
    };

    const onSettingsClick = () => {
        if (!guardExtensionAlive()) return;
        // Open the toolbar action popup anchored to the extension icon — same
        // surface/position as clicking the icon. Background calls
        // browser.action.openPopup() (must run there, not in the content
        // script); that namespace only exists under MV3, which every target we
        // ship is built as — see the MV3 note in main/background.ts.
        notifyBackground({ action: ACTION.OPEN_POPUP });
        // Same rule as the toggle: only get out of the way once the pointer has
        // actually left the ball.
        if (hoveredRef.current) return;
        setExpanded(false);
    };

    const onCloseClick = () => {
        // Don't offer a menu whose choices cannot be saved — go straight to the
        // notice. Closing an already-open menu is local state, so it is always
        // allowed (the menu can have been opened while the extension was alive).
        if (!closeMenuOpen && !guardExtensionAlive()) return;
        setCloseMenuOpen((v) => !v);
    };

    const onMenuClose = () => {
        setCloseMenuOpen(false);
        // If the pointer already left while the menu was open, collapse now.
        if (!hoveredRef.current) setExpanded(false);
    };

    const handleCloseChoice = async (choice: CloseChoice) => {
        setCloseMenuOpen(false);
        // "Hide until reload" is pure local state, so it keeps working; the two
        // persisted choices need storage and must report instead of failing mute.
        if (choice !== "session" && !guardExtensionAlive()) return;
        if (choice === "session") {
            setSessionHidden(true);
        } else if (choice === "site") {
            // Per-site blacklist: persist domain.floatBallDisabled. content.ts
            // checks it on next mount; for this session we just hide.
            await sendMessageToBackground({
                action: DB_ACTION.DOMAIN_UPSERT,
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

    const retracted = isDockedStyle && !expanded && !closeMenuOpen && dock !== null;
    const edgeOffset = retracted ? (dock === "left" ? -22 : 22) : 0;

    // Shared style for secondary actions. They remain compact, but their hit
    // areas are large enough for touch and imprecise pointer input.
    const auxBtnClass = isDockedStyle
        ? "h-8 w-8 inline-flex items-center justify-center rounded-full bg-transparent text-ink-soft transition-[color,opacity,transform] duration-200 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#107CF3] active:scale-[0.94] motion-reduce:transition-none"
        : "h-[18px] w-[18px] inline-flex items-center justify-center rounded-full text-[#BFBFBF] transition-colors";

    return (
        <div
            ref={ballRef}
            style={{
                position: "fixed",
                left: 0,
                top: 0,
                zIndex: 2147483000,
                opacity: ready && !fullscreen ? (retracted ? 0.62 : 1) : 0,
                // Keep the layout box (for offsetWidth measurement) but make the
                // ball non-interactive while hidden (fullscreen video / pre-place).
                pointerEvents: ready && !fullscreen ? "auto" : "none",
                visibility: fullscreen ? "hidden" : "visible",
            }}
            className={isDockedStyle
                ? "h-11 w-11 select-none transition-opacity duration-200 ease-out motion-reduce:transition-none"
                : "select-none"}
            data-dock={dock ?? "free"}
            data-retracted={retracted ? "true" : "false"}
            onMouseDown={isDockedStyle
                ? (event) => {
                    expandBall();
                    onMouseDown(event);
                }
                : onMouseDown}
        >
            <div
                className={isDockedStyle
                    ? "relative flex h-11 w-11 flex-col items-center justify-center transition-transform duration-200 ease-out motion-reduce:transition-none"
                    : "relative flex flex-col items-center"}
                style={{ transform: isDockedStyle ? `translateX(${edgeOffset}px)` : undefined }}
                onMouseEnter={onPointerEnter}
                onMouseLeave={onPointerLeave}
                onFocusCapture={(event) => {
                    if (isKeyboardFocus(event.target)) expandBall();
                }}
                onBlurCapture={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        scheduleCollapse();
                    }
                }}
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
                            // Extend over the stacked secondary actions so the
                            // pointer can move between the ball and actions.
                            top: buttonsAbove ? `${isDockedStyle ? -DOCKED_ACTIONS_EXTENT : -30}px` : 0,
                            bottom: buttonsAbove ? 0 : `${isDockedStyle ? -DOCKED_ACTIONS_EXTENT : -30}px`,
                            left: isDockedStyle ? "-8px" : "-12px",
                            right: isDockedStyle ? "-8px" : "-12px",
                        }}
                    />
                )}

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
                        className="px-2 py-1 rounded-md bg-surface text-ink text-[12px] leading-none shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                    >
                        {switchLabel}
                    </div>
                )}

                {isDockedStyle ? (
                    <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={switchLabel}
                        onClick={onToggle}
                        onMouseEnter={onSwitchEnter}
                        onMouseLeave={onSwitchLeave}
                        className={[
                            "relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 bg-surface p-0 shadow-[0_3px_12px_rgba(0,0,0,0.26)] transition-[border-color,box-shadow,transform] duration-200 hover:shadow-[0_4px_14px_rgba(0,0,0,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#107CF3] focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.94] motion-reduce:transition-none",
                            active
                                ? "border-[#23A455] shadow-[0_3px_13px_rgba(35,164,85,0.28)]"
                                : "border-line-strong",
                        ].join(" ")}
                    >
                        <span
                            aria-hidden="true"
                            className="block h-6 w-6"
                            dangerouslySetInnerHTML={{ __html: DUO_LOGO_SVG }}
                        />
                        {active && (
                            <span
                                aria-hidden="true"
                                className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-surface bg-[#23A455] text-white shadow-[0_1px_4px_rgba(35,164,85,0.45)]"
                            >
                                <Check className="h-2.5 w-2.5 stroke-[3]" />
                            </span>
                        )}
                    </button>
                ) : (
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
                        <span
                            aria-hidden="true"
                            className="absolute h-5 w-5 rounded-full border-2 border-white bg-[#ECECEC]"
                            style={{
                                top: "50%",
                                left: 2,
                                transform: `translate(${active ? 18 : 0}px, -50%)`,
                                transition: "transform 0.2s ease",
                                willChange: "transform",
                            }}
                        />
                    </button>
                )}

                {/* Settings and Close in a compact vertical stack, absolutely
                    placed so the switch never shifts on expand. Mirrored (order
                    included) when the stack flips above the ball. */}
                {expanded && (
                    <div
                        className={isDockedStyle
                            // Flipping above reverses the stack so Settings stays
                            // the action adjacent to the ball in both directions
                            // (the whole cluster is mirrored, not just moved).
                            ? `flex ${buttonsAbove ? "flex-col-reverse" : "flex-col"} items-center`
                            : "flex flex-row items-center gap-1.5"}
                        style={{
                            position: "absolute",
                            ...(isDockedStyle ? horizPlace : {}),
                            ...(buttonsAbove
                                ? { bottom: isDockedStyle ? `calc(100% - ${DOCKED_ACTIONS_INSET}px)` : "calc(100% + 5px)" }
                                : { top: isDockedStyle ? `calc(100% - ${DOCKED_ACTIONS_INSET}px)` : "calc(100% + 5px)" }),
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
                            <SettingsIcon aria-hidden="true" className="h-4 w-4" />
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
                            {isDockedStyle ? (
                                <CircleSlash2 aria-hidden="true" className="h-4 w-4" />
                            ) : (
                                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 18 18" fill="none">
                                    <path d="M15.5051 4.58459L14.764 5.32621C15.6138 6.64036 15.9873 8.20617 15.8222 9.76241C15.6571 11.3187 14.9634 12.7712 13.8567 13.8778C12.7501 14.9844 11.2975 15.678 9.74122 15.8431C8.18497 16.0081 6.61919 15.6345 5.30508 14.7846L4.56399 15.5256C5.87389 16.4274 7.42728 16.909 9.01758 16.9065C13.3632 16.9065 16.8861 13.3837 16.8861 9.03818C16.8886 7.44788 16.4069 5.89449 15.5051 4.58459ZM15.3134 1.77385L14.076 3.01135C12.6603 1.81939 10.8683 1.16698 9.01758 1.16969C4.67192 1.16969 1.14909 4.6934 1.14909 9.03818C1.14638 10.8889 1.79879 12.6809 2.99075 14.0966L1.65815 15.4292L2.57081 16.3419L16.2262 2.68668L15.3134 1.77385ZM2.71442 11.7002C2.11848 10.2924 2.01131 8.72559 2.41003 7.24978C2.80875 5.77397 3.69037 4.47426 4.91417 3.55812C6.13796 2.64198 7.63339 2.16221 9.16176 2.19539C10.6901 2.22857 12.1633 2.77279 13.3462 3.74119L3.72059 13.3666C3.30705 12.8623 2.96819 12.301 2.71442 11.7002Z" fill="currentColor" />
                                </svg>
                            )}
                        </button>
                    </div>
                )}

                {closeMenuOpen && createPortal(
                    <CloseMenu
                        anchorRef={closeBtnRef}
                        onPick={handleCloseChoice}
                        onClose={onMenuClose}
                    />,
                    overlayRoot,
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
            const { width: vw, height: vh } = getViewportSize();

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
            className="min-w-[230px] rounded-md bg-surface border border-line-strong shadow-[0_8px_24px_rgba(0,0,0,0.5)] py-1"
        >
            <div className="flex items-center justify-between px-3 pb-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                    {t("floatBallCloseTitle", "Disable floating ball")}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    onMouseDown={(e) => e.stopPropagation()}
                    aria-label={t("aiClose", "Close")}
                    className="h-5 w-5 inline-flex items-center justify-center rounded text-ink-soft hover:bg-hover-2"
                >
                    <X aria-hidden="true" className="h-3 w-3" strokeWidth={2.5} />
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
            className={`block w-full px-3 py-1.5 text-left text-[12px] hover:bg-hover-2 ${danger ? "text-danger-ink hover:text-danger-ink-2" : "text-ink"}`}
        >
            {label}
        </button>
    );
}
