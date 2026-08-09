import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CONFIG_KEY, FLOAT_BALL_STYLE } from "@/main/constants";
import { getConfig, setConfig } from "@/utils/db";
import { getViewportSize } from "@/utils/dom";

const DRAG_THRESHOLD = 5;
const MIN_MARGIN = 5;
const SNAP_TRANSITION = "left 0.18s ease, top 0.18s ease";

/** Which vertical edge the ball is docked to (null = free-floating). */
export type Dock = "left" | "right" | null;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Drag + edge-docking + viewport-relative position persistence for the float
 * ball.
 *
 * The element is `position: fixed` and positioned via inline `left`/`top` that
 * this hook owns directly (imperative DOM writes, so dragging doesn't trigger a
 * React re-render per mousemove). The persisted form is `{ x, y, dock }` where
 * x/y are viewport percentages (measured from the ball's bottom-right corner)
 * so the ball lands sensibly after a resize / on a different screen, and `dock`
 * records which edge it snapped to.
 *
 * On release the ball docks to the nearest left/right edge. Vertical position
 * is preserved. The returned `dock` lets the caller retract partly past that
 * edge and expand its toolbar back toward the viewport.
 *
 * `movedRef` lets the caller distinguish a click from the tail end of a drag.
 */
export function useDraggable(
    ref: RefObject<HTMLElement | null>,
    onDocked?: () => void,
    style: FLOAT_BALL_STYLE = FLOAT_BALL_STYLE.DOCKED,
) {
    // Stays false until the initial position is computed, so the caller can keep
    // the ball at opacity 0 and avoid a top-left flash before placement.
    const [ready, setReady] = useState(false);
    const [dock, setDockState] = useState<Dock>(null);
    const movedRef = useRef(false);
    const onDockedRef = useRef(onDocked);
    const stateRef = useRef({
        dragging: false,
        startX: 0,
        startY: 0,
        offsetX: 0,
        offsetY: 0,
        xPercent: 0,
        yPercent: 0,
        dock: null as Dock,
        screenW: 0,
        screenH: 0,
    });

    const setDock = (d: Dock) => {
        stateRef.current.dock = d;
        setDockState(d);
    };

    useEffect(() => {
        onDockedRef.current = onDocked;
    }, [onDocked]);

    // ---- Initial placement (config or default docked bottom-right) ---------
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        let cancelled = false;
        (async () => {
            const positionKey = style === FLOAT_BALL_STYLE.DOCKED
                ? CONFIG_KEY.FLOAT_BALL_DOCKED_POSITION
                : CONFIG_KEY.FLOAT_BALL_POSITION;
            const ownPosition = await getConfig(positionKey);
            // Before the style selector existed, the docked implementation
            // also wrote FLOAT_BALL_POSITION. Seed the new dedicated key from
            // that value once, without overwriting the classic placement.
            const stored = ownPosition ?? (
                style === FLOAT_BALL_STYLE.DOCKED
                    ? await getConfig(CONFIG_KEY.FLOAT_BALL_POSITION)
                    : undefined
            );
            if (cancelled || !ref.current) return;
            const { width: screenW, height: screenH } = getViewportSize();
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const s = stateRef.current;
            s.screenW = screenW;
            s.screenH = screenH;

            let storedDock: Dock =
                stored?.dock === "left" || stored?.dock === "right" ? stored.dock : null;

            let x: number;
            let y: number;
            if (stored && (stored.x || stored.y || storedDock)) {
                s.xPercent = stored.x || 0;
                s.yPercent = stored.y || 0;
                s.dock = storedDock;
                y = clamp((s.yPercent * screenH) / 100 - h, 0, screenH - h);
                if (storedDock === "left") x = 0;
                else if (storedDock === "right") x = screenW - w;
                else {
                    const storedX = clamp((s.xPercent * screenW) / 100 - w, 0, screenW - w);
                    if (style === FLOAT_BALL_STYLE.DOCKED) {
                        // Migrate legacy free-floating positions into the
                        // edge-only behavior by choosing the nearer edge.
                        storedDock = storedX + w / 2 <= screenW / 2 ? "left" : "right";
                        s.dock = storedDock;
                        x = storedDock === "left" ? 0 : screenW - w;
                        const nx = Math.round(((x + w) / screenW) * 100);
                        void setConfig(positionKey, {
                            x: nx,
                            y: s.yPercent,
                            dock: storedDock,
                        });
                    } else {
                        x = storedX;
                    }
                }
            } else {
                // Default: docked to the right edge, a bit up from the bottom.
                x = screenW - w;
                y = screenH > h * 5 ? screenH - h * 5 : 0;
                s.xPercent = Math.round(((x + w) / screenW) * 100);
                s.yPercent = Math.round(((y + h) / screenH) * 100);
                s.dock = "right";
            }
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            if (style === FLOAT_BALL_STYLE.DOCKED && ownPosition == null) {
                void setConfig(positionKey, {
                    x: Math.round(((x + w) / screenW) * 100),
                    y: Math.round(((y + h) / screenH) * 100),
                    dock: s.dock,
                });
            }
            setDockState(s.dock);
            setReady(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [ref, style]);

    // ---- Window-level drag + resize listeners ------------------------------
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            const s = stateRef.current;
            const el = ref.current;
            if (!s.dragging || !el) return;
            if (
                Math.abs(e.clientX - s.startX) > DRAG_THRESHOLD ||
                Math.abs(e.clientY - s.startY) > DRAG_THRESHOLD
            ) {
                movedRef.current = true;
            }
            // Don't budge the ball until the pointer has travelled past the
            // threshold — otherwise tiny jitter while clicking the switch would
            // nudge it. Below the threshold this is treated as a click.
            if (!movedRef.current) return;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            const x = clamp(e.clientX - s.offsetX, 0, s.screenW - w - MIN_MARGIN);
            const y = clamp(e.clientY - s.offsetY, 0, s.screenH - h - MIN_MARGIN);
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        };

        const onUp = () => {
            const s = stateRef.current;
            const el = ref.current;
            if (!s.dragging || !el) return;
            s.dragging = false;
            document.body.style.userSelect = "";
            // Pure click (no drag): nothing to snap or persist.
            if (!movedRef.current) return;

            const w = el.offsetWidth;
            const h = el.offsetHeight;
            let x = clamp(parseFloat(el.style.left) || 0, 0, s.screenW - w);
            const y = clamp(parseFloat(el.style.top) || 0, 0, s.screenH - h);

            const SNAP_THRESHOLD = 40;
            // The new ball always docks; the classic control keeps its old
            // behavior and only snaps when released close to an edge.
            let nextDock: Dock;
            if (style === FLOAT_BALL_STYLE.DOCKED) {
                nextDock = x + w / 2 <= s.screenW / 2 ? "left" : "right";
                x = nextDock === "left" ? 0 : s.screenW - w;
            } else if (x <= SNAP_THRESHOLD) {
                nextDock = "left";
                x = 0;
            } else if (x >= s.screenW - w - SNAP_THRESHOLD) {
                nextDock = "right";
                x = s.screenW - w;
            } else {
                nextDock = null;
            }

            // Animate the snap glide; cleared so the next drag tracks instantly.
            if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                el.style.transition = SNAP_TRANSITION;
                window.setTimeout(() => {
                    if (ref.current) ref.current.style.transition = "";
                }, 200);
            }
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;

            const nx = Math.round(((x + w) / s.screenW) * 100);
            const ny = Math.round(((y + h) / s.screenH) * 100);
            s.xPercent = nx;
            s.yPercent = ny;
            if (nextDock !== s.dock) setDock(nextDock);
            const positionKey = style === FLOAT_BALL_STYLE.DOCKED
                ? CONFIG_KEY.FLOAT_BALL_DOCKED_POSITION
                : CONFIG_KEY.FLOAT_BALL_POSITION;
            setConfig(positionKey, { x: nx, y: ny, dock: nextDock });
            onDockedRef.current?.();
        };

        const onResize = () => {
            const s = stateRef.current;
            const el = ref.current;
            if (!el || s.dragging) return;
            const vp = getViewportSize();
            s.screenW = vp.width;
            s.screenH = vp.height;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            // Docked balls stay flush to their edge; free ones reposition by %.
            let left: number;
            if (s.dock === "left") left = 0;
            else if (s.dock === "right") left = Math.max(0, s.screenW - w);
            else left = clamp((s.xPercent * s.screenW) / 100 - w, 0, Math.max(0, s.screenW - w));
            const top = clamp((s.yPercent * s.screenH) / 100 - h, 0, Math.max(0, s.screenH - h));
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
        };

        window.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        window.addEventListener("resize", onResize);
        // A window `resize` event does NOT fire when a scrollbar merely appears
        // or disappears, yet that changes documentElement.clientWidth — which
        // would leave a right-docked ball stranded behind/past the new scrollbar.
        // Observe the document element directly to re-flush on those changes.
        const ro = new ResizeObserver(() => onResize());
        ro.observe(document.documentElement);
        return () => {
            window.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            window.removeEventListener("resize", onResize);
            ro.disconnect();
        };
    }, [ref, style]);

    const onMouseDown = (e: React.MouseEvent) => {
        const el = ref.current;
        if (!el) return;
        const s = stateRef.current;
        s.dragging = true;
        movedRef.current = false;
        s.startX = e.clientX;
        s.startY = e.clientY;
        const vp = getViewportSize();
        s.screenW = vp.width;
        s.screenH = vp.height;
        const cs = window.getComputedStyle(el);
        s.offsetX = e.clientX - (parseFloat(cs.left) || 0);
        s.offsetY = e.clientY - (parseFloat(cs.top) || 0);
        // Drop any snap transition so dragging tracks the cursor 1:1.
        el.style.transition = "";
        document.body.style.userSelect = "none";
    };

    return { ready, dock, onMouseDown, movedRef };
}
