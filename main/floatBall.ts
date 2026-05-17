import { browser } from "wxt/browser";
import {
    APP_NAME_WITH_SUFFIX,
    CONFIG_KEY,
} from "@/main/constants";
import { getConfig, setConfig } from "@/utils/db";

/**
 * Float ball is a pure UI surface. It does NOT own any business state
 * (translate-on/off, "is the ball enabled" flag, …). Those live in the
 * content script. Communication is one-way down via {@link FloatBallController}
 * methods, and one-way up via {@link FloatBallDeps} callbacks.
 */
export interface FloatBallDeps {
    /** Initial visual state of the toggle (active = page is currently translated). */
    initiallyActive: boolean;
    /** User clicked the toggle while it was inactive — they want translation. */
    onTranslate(): void;
    /** User clicked the toggle while it was active — they want the original. */
    onRestore(): void;
    /**
     * User confirmed closing the ball. The config flag has already been
     * persisted; the caller only needs to update its in-memory mirror and
     * skip future re-mounts.
     */
    onClose(): void;
}

export interface FloatBallController {
    /** Sync the toggle visual to a translate-on/off value from the outside. */
    setActive(active: boolean): void;
    /** Tear down DOM and every event listener registered while mounted. */
    destroy(): void;
}

const FLOAT_BALL_OUTER_ID = "duo-float-ball-outer";
const FLOAT_BALL_RECREATE_ATTEMPTS = 10;
const FLOAT_BALL_RECREATE_INTERVAL_MS = 200;

export async function mountFloatBall(deps: FloatBallDeps): Promise<FloatBallController> {
    // Listeners attached to host objects (window/document/body) need to be
    // removed on destroy AND on every re-create, otherwise SPA frameworks
    // that wipe the body leave us leaking handlers.
    let disposers: Array<() => void> = [];
    let destroyed = false;
    let active = deps.initiallyActive;
    // Persisted across re-creates: position the user dragged to last time.
    let xPercent = 0;
    let yPercent = 0;
    let positionLoaded = false;

    function track(target: EventTarget, type: string, fn: EventListenerOrEventListenerObject) {
        target.addEventListener(type, fn);
        disposers.push(() => target.removeEventListener(type, fn));
    }

    function clearDisposers() {
        for (const dispose of disposers) {
            try { dispose(); } catch (e) { console.warn(APP_NAME_WITH_SUFFIX, "float ball dispose error", e); }
        }
        disposers = [];
    }

    function removeBallDom() {
        document.getElementById(FLOAT_BALL_OUTER_ID)?.remove();
    }

    async function createBall(): Promise<void> {
        if (document.getElementById(FLOAT_BALL_OUTER_ID)) return;

        const floatBall = document.createElement("div");
        floatBall.id = FLOAT_BALL_OUTER_ID;

        const shadowRoot = floatBall.attachShadow({ mode: "open" });
        shadowRoot.innerHTML = floatBallHtml;
        const styleSheet = document.createElement("style");
        styleSheet.innerHTML = floatBallStyle;
        styleSheet.id = "duo-float-ball-style";
        shadowRoot.appendChild(styleSheet);
        document.body.appendChild(floatBall);

        let screenWidth = document.documentElement.clientWidth;
        let screenHeight = document.documentElement.clientHeight;

        const floatingBall = shadowRoot.getElementById("duo-float-ball") as HTMLElement;

        if (!positionLoaded) {
            const position = await getConfig(CONFIG_KEY.FLOAT_BALL_POSITION);
            if (position) {
                xPercent = position.x || 0;
                yPercent = position.y || 0;
            }
            positionLoaded = true;
        }

        let initialPositionX = screenWidth - floatingBall.offsetWidth;
        let initialPositionY = 0;
        if (xPercent || yPercent) {
            initialPositionX = (xPercent * screenWidth) / 100 - floatingBall.offsetWidth;
            initialPositionY = (yPercent * screenHeight) / 100 - floatingBall.offsetHeight;
            initialPositionX = Math.min(initialPositionX, screenWidth - floatingBall.offsetWidth);
            initialPositionY = Math.min(initialPositionY, screenHeight - floatingBall.offsetHeight);
            initialPositionX = Math.max(initialPositionX, 0);
            initialPositionY = Math.max(initialPositionY, 0);
        } else {
            if (screenWidth > floatingBall.offsetWidth * 2) {
                initialPositionX = screenWidth - floatingBall.offsetWidth * 2;
            }
            if (screenHeight > floatingBall.offsetHeight * 5) {
                initialPositionY = screenHeight - floatingBall.offsetHeight * 5;
            }
        }
        floatingBall.style.left = initialPositionX + "px";
        floatingBall.style.top = initialPositionY + "px";
        floatingBall.style.opacity = "1";

        const duoSwitch = shadowRoot.querySelector(".duo-switch") as HTMLElement;
        const duoTool = shadowRoot.querySelector(".duo-tool") as HTMLElement;
        const duoTooltip = shadowRoot.querySelector(".duo-tooltip") as HTMLElement;
        const duoClose = shadowRoot.querySelector(".duo-close-button") as HTMLElement;

        // Apply current active state to the freshly-built switch element.
        if (active) duoSwitch.classList.add("active");
        else duoSwitch.classList.remove("active");

        let ballTimer: ReturnType<typeof setTimeout> | undefined;
        let isDragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;
        const minMargin = 5;

        track(duoSwitch, "click", () => {
            if (moved) return;
            if (duoSwitch.classList.contains("active")) deps.onRestore();
            else deps.onTranslate();
        });
        track(duoSwitch, "mouseenter", () => {
            duoClose.style.opacity = "1";
            ballTimer = setTimeout(() => { duoTooltip.style.opacity = "1"; }, 1000);
        });
        track(duoTool, "mouseleave", () => {
            if (ballTimer) clearTimeout(ballTimer);
            duoClose.style.opacity = "0";
            duoTooltip.style.opacity = "0";
        });
        track(duoClose, "click", async () => {
            if (duoClose.style.opacity === "0") return;
            const ok = window.confirm(browser.i18n.getMessage("confirmCloseFloatBall"));
            if (!ok) return;
            await setConfig(CONFIG_KEY.FLOAT_BALL_SWITCH, false);
            destroy();
            deps.onClose();
        });

        const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

        track(floatingBall, "mousedown", (evt) => {
            const e = evt as MouseEvent;
            isDragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            const cs = window.getComputedStyle(floatingBall);
            const left = parseFloat(cs.left.substring(0, cs.left.length - 2));
            const top = parseFloat(cs.top.substring(0, cs.top.length - 2));
            offsetX = e.clientX - left;
            offsetY = e.clientY - top;
            document.body.style.userSelect = "none";
        });

        track(window, "mousemove", (evt) => {
            const e = evt as MouseEvent;
            if (!isDragging) return;
            if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                moved = true;
            }
            const x = e.clientX - offsetX;
            const y = e.clientY - offsetY;
            const clampedX = clamp(x, 0, screenWidth - floatingBall.offsetWidth - minMargin);
            const clampedY = clamp(y, 0, screenHeight - floatingBall.offsetHeight - minMargin);
            floatingBall.style.left = `${clampedX}px`;
            floatingBall.style.top = `${clampedY}px`;
        });

        track(document, "mouseup", () => {
            if (!isDragging) return;
            isDragging = false;
            document.body.style.userSelect = "auto";

            let x = parseFloat(floatingBall.style.left.substring(0, floatingBall.style.left.length - 2));
            let y = parseFloat(floatingBall.style.top.substring(0, floatingBall.style.top.length - 2));
            x = clamp(x, 0, screenWidth - floatingBall.offsetWidth);
            y = clamp(y, 0, screenHeight - floatingBall.offsetHeight);
            const newXPercent = Math.round(((x + floatingBall.offsetWidth) / screenWidth) * 100);
            const newYPercent = Math.round(((y + floatingBall.offsetHeight) / screenHeight) * 100);
            if (newXPercent !== xPercent || newYPercent !== yPercent) {
                xPercent = newXPercent;
                yPercent = newYPercent;
                setConfig(CONFIG_KEY.FLOAT_BALL_POSITION, { x: xPercent, y: yPercent });
            }
        });

        track(window, "resize", () => {
            screenWidth = document.documentElement.clientWidth;
            screenHeight = document.documentElement.clientHeight;
            let left = (xPercent * screenWidth) / 100 - floatingBall.offsetWidth;
            let top = (yPercent * screenHeight) / 100 - floatingBall.offsetHeight;
            top = clamp(top, 0, Math.max(0, screenHeight - floatingBall.offsetHeight));
            left = clamp(left, 0, Math.max(0, screenWidth - floatingBall.offsetWidth));
            floatingBall.style.left = `${left}px`;
            floatingBall.style.top = `${top}px`;
        });
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearDisposers();
        removeBallDom();
    }

    function setActive(next: boolean) {
        active = next;
        const outer = document.getElementById(FLOAT_BALL_OUTER_ID);
        const sw = outer?.shadowRoot?.querySelector(".duo-switch") as HTMLElement | null;
        if (!sw) return;
        if (next) sw.classList.add("active");
        else sw.classList.remove("active");
    }

    await createBall();

    // Some pages (React with key churn / Minified React error #418) wipe our
    // ball after we mount it. Poll briefly to recreate; on each successful
    // recreate we first dispose the previous listeners so we don't pile up.
    (async () => {
        for (let i = 0; i < FLOAT_BALL_RECREATE_ATTEMPTS; i++) {
            await new Promise((r) => setTimeout(r, FLOAT_BALL_RECREATE_INTERVAL_MS));
            if (destroyed) return;
            if (document.getElementById(FLOAT_BALL_OUTER_ID)) continue;
            clearDisposers();
            await createBall();
        }
    })();

    return { setActive, destroy };
}

const floatBallHtml = `<div class="duo-float-ball" id="duo-float-ball">
    <div class="duo-tool">
        <div class="duo-close-button">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M15.5051 4.58459L14.764 5.32621C15.6138 6.64036 15.9873 8.20617 15.8222 9.76241C15.6571 11.3187 14.9634 12.7712 13.8567 13.8778C12.7501 14.9844 11.2975 15.678 9.74122 15.8431C8.18497 16.0081 6.61919 15.6345 5.30508 14.7846L4.56399 15.5256C5.87389 16.4274 7.42728 16.909 9.01758 16.9065C13.3632 16.9065 16.8861 13.3837 16.8861 9.03818C16.8886 7.44788 16.4069 5.89449 15.5051 4.58459ZM15.3134 1.77385L14.076 3.01135C12.6603 1.81939 10.8683 1.16698 9.01758 1.16969C4.67192 1.16969 1.14909 4.6934 1.14909 9.03818C1.14638 10.8889 1.79879 12.6809 2.99075 14.0966L1.65815 15.4292L2.57081 16.3419L16.2262 2.68668L15.3134 1.77385ZM2.71442 11.7002C2.11848 10.2924 2.01131 8.72559 2.41003 7.24978C2.80875 5.77397 3.69037 4.47426 4.91417 3.55812C6.13796 2.64198 7.63339 2.16221 9.16176 2.19539C10.6901 2.22857 12.1633 2.77279 13.3462 3.74119L3.72059 13.3666C3.30705 12.8623 2.96819 12.301 2.71442 11.7002Z" fill="#BFBFBF"/>
            </svg>
        </div>

        <div data-layer="switch" class="duo-switch">
            <div data-layer="button" class="duo-button"></div>
        </div>

    </div>
    <div class="duo-tooltip"><p></p></div>
</div>`

const floatBallStyle = `.duo-switch {
            display: flex;
            width: 50px;
            height: 30px;
            //position: absolute;
            background: #ED6C35;
            border-radius: 214px;
            transition: background 0.3s;
            opacity: 0.35;
        }
        .duo-switch.active {
            background: #23C965;
        }
        .duo-switch:hover {
            opacity: 1;
        }
        .duo-switch .duo-button {
            display: flex;
            flex-direction: row;
            width: 22px;
            height: 22px;
            margin-left: 2px;
            margin-top: 2px;
            //left: 2px;
            //top: 2px;
            position: absolute;
            background: #ECECEC;
            border-radius: 9999px;
            border: 2px white solid;
            transform: translateX(0); /* initial position */
            transition: transform 0.2s ease; /* add animation  */
        }
        .duo-switch.active .duo-button {
            left: auto;
            //right: 2px;
            transform: translateX(21px);
        }
        .duo-tooltip{
            display: flex;
            opacity: 0;
            //cursor: pointer;
            user-select: none; /* Prevent text selection */
            -webkit-user-select: none; /* For Safari */
            -moz-user-select: none; /* For Firefox */
            -ms-user-select: none; /* For Internet Explorer/Edge */
            //-webkit-user-select: none;
        }
        .duo-float-ball {
            display: flex;
            opacity: 0;
            flex-direction: row;
            align-items: center;
            //justify-content: center;
            position: fixed;
            // margin-top: 20px;
            // margin-left: 20px;
            z-index: 9999;
            //transform: translate(-50%, -50%);
        }
        .duo-tool {
            display: flex;
            flex-direction: row;
            align-items: center;
            //justify-content: center;
            position: relative;
        }
        .duo-close-button {
            display: flex;
            opacity: 0;
            margin-right: 5px;
        }`