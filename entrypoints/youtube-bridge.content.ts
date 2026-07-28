import { defineContentScript } from "wxt/utils/define-content-script";
import {
    YT_BRIDGE_REQUEST,
    YT_BRIDGE_RESPONSE,
    YT_BRIDGE_TRACK_REQUEST,
    YT_BRIDGE_TRACK_RESPONSE,
    type YtBridgePlayerData,
    type YtBridgeTrackRequest,
} from "@/main/videoSubtitle/bridgeProtocol";

/**
 * MAIN-world bridge for the YouTube subtitle feature.
 *
 * Two jobs, both impossible from the isolated world:
 *
 * 1. Player data. The caption track list lives in the player response —
 *    `#movie_player.getPlayerResponse()` / `ytInitialPlayerResponse` are page
 *    globals.
 *
 * 2. Caption track bodies. A bare fetch of a track's `baseUrl` returns an
 *    EMPTY 200: YouTube requires a botguard-minted proof-of-origin token
 *    (`pot=`) that only the player itself can produce (verified live — no
 *    `serviceIntegrityDimensions.poToken` in the player response either). So
 *    the bridge patches fetch/XHR at document_start to capture the player's
 *    own `/api/timedtext` responses, and on request drives the player's
 *    caption module (unload → load → setOption(track)) to make it fetch the
 *    wanted track itself — token attached by YouTube, response captured here.
 *    If native captions were off beforehand, the module is unloaded again
 *    after capture so the user-visible CC state is untouched.
 *
 * Must stay dependency-free (no browser.*, no extension imports beyond the
 * shared protocol constants).
 */
export default defineContentScript({
    matches: ["*://www.youtube.com/*"],
    world: "MAIN",
    runAt: "document_start",
    main() {
        // ------------------------------------------------------------------
        // Timedtext capture (fetch + XHR), installed before player scripts.
        // ------------------------------------------------------------------
        interface Captured {
            url: string;
            body: string;
            ts: number;
        }
        const captures: Captured[] = [];
        const listeners = new Set<(c: Captured) => void>();

        const record = (url: string, body: string) => {
            if (!body) return;
            const c = { url, body, ts: Date.now() };
            captures.push(c);
            if (captures.length > 6) captures.shift();
            listeners.forEach((fn) => {
                try { fn(c); } catch { /* listener errors must not leak to the page */ }
            });
        };

        const isTimedtext = (url: unknown): url is string =>
            typeof url === "string" && url.includes("/api/timedtext");

        // The interceptors are installed ONLY while a capture is actually
        // wanted, and unwound as soon as it is not.
        //
        // Leaving them in place for the page's lifetime is what made every
        // failing YouTube request (the player's own `videoplayback` segment
        // retries routinely 403 and are re-issued against another host) appear
        // in DevTools as if this file had issued it: once `window.fetch` is
        // ours, we are on the initiator stack of every request on the page.
        // Nothing broke, but the extension got blamed for the page's errors —
        // and every request paid for a pointless extra frame.
        //
        // Windows where a capture is wanted: a short one at document_start (to
        // passively catch the track the player loads by itself when the user
        // already has captions on — free, and avoids the CC flicker of driving
        // the caption module ourselves) and each explicit track request.
        const CAPTURE_IDLE_MS = 15_000;

        type XhrWithUrl = XMLHttpRequest & { __duoUrl?: string };

        let patched = false;
        let pendingCaptures = 0;
        let idleTimer = 0;
        let nativeFetch: typeof window.fetch;
        let nativeOpen: typeof XMLHttpRequest.prototype.open;
        let nativeSend: typeof XMLHttpRequest.prototype.send;
        let ourFetch: typeof window.fetch;
        let ourOpen: typeof XMLHttpRequest.prototype.open;
        let ourSend: typeof XMLHttpRequest.prototype.send;

        const installCapture = () => {
            if (patched) return;
            patched = true;
            nativeFetch = window.fetch;
            nativeOpen = XMLHttpRequest.prototype.open;
            nativeSend = XMLHttpRequest.prototype.send;

            ourFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
                const p = nativeFetch.apply(this as any, args);
                let url: unknown;
                try {
                    url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url;
                } catch { /* exotic input — not ours then */ }
                if (!isTimedtext(url)) return p;
                // Observe without ever becoming a second consumer of the
                // failure: both handlers are supplied, so this derived promise
                // can never surface as an unhandled rejection, and the page
                // still gets the original promise untouched.
                void p.then(
                    (resp) => {
                        try {
                            void resp.clone().text().then((t) => record(url as string, t), () => { });
                        } catch { /* opaque / already-consumed body */ }
                    },
                    () => { /* the page's failure to handle, not ours */ },
                );
                return p;
            } as typeof window.fetch;
            window.fetch = ourFetch;

            ourOpen = function (this: XhrWithUrl, ...args: any[]) {
                try {
                    if (isTimedtext(args[1])) this.__duoUrl = String(args[1]);
                } catch { /* noop */ }
                return (nativeOpen as any).apply(this, args);
            } as typeof XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = ourOpen;

            ourSend = function (this: XhrWithUrl, ...args: any[]) {
                const url = this.__duoUrl;
                if (url) {
                    this.addEventListener("load", () => {
                        try { record(url, this.responseText ?? ""); } catch { /* non-text response */ }
                    });
                }
                return (nativeSend as any).apply(this, args);
            } as typeof XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = ourSend;
        };

        const uninstallCapture = () => {
            if (!patched) return;
            // Only unwind when all three are still ours. If anything wrapped on
            // top of us, restoring would rip out that wrapper; staying
            // installed is the harmless choice.
            if (
                window.fetch !== ourFetch ||
                XMLHttpRequest.prototype.open !== ourOpen ||
                XMLHttpRequest.prototype.send !== ourSend
            ) return;
            window.fetch = nativeFetch;
            XMLHttpRequest.prototype.open = nativeOpen;
            XMLHttpRequest.prototype.send = nativeSend;
            patched = false;
        };

        const scheduleUninstall = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                if (pendingCaptures === 0) uninstallCapture();
            }, CAPTURE_IDLE_MS) as unknown as number;
        };

        installCapture();
        scheduleUninstall();

        // ------------------------------------------------------------------
        // Player data RPC
        // ------------------------------------------------------------------
        const getPlayer = (): any => document.getElementById("movie_player");

        const readPlayerData = (): YtBridgePlayerData | null => {
            // Prefer the live player API — after SPA navigations
            // `ytInitialPlayerResponse` is stale (still the first video).
            const pr = getPlayer()?.getPlayerResponse?.() ?? (window as any).ytInitialPlayerResponse;
            if (!pr) return null;
            const videoId = pr?.videoDetails?.videoId;
            if (!videoId) return null;
            const rawTracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            const captionTracks = Array.isArray(rawTracks)
                ? rawTracks
                    .filter((t: any) => t && typeof t.baseUrl === "string")
                    .map((t: any) => ({
                        baseUrl: String(t.baseUrl),
                        languageCode: String(t.languageCode ?? ""),
                        kind: String(t.kind ?? ""),
                        label: String(t.name?.simpleText ?? t.name?.runs?.[0]?.text ?? t.languageCode ?? ""),
                    }))
                : [];
            return {
                videoId: String(videoId),
                isLive: !!pr?.videoDetails?.isLive,
                captionTracks,
            };
        };

        // ------------------------------------------------------------------
        // Track fetch RPC — drive the player's caption module
        // ------------------------------------------------------------------
        const matchesCapture = (c: Captured, req: YtBridgeTrackRequest): boolean => {
            try {
                const u = new URL(c.url, window.location.origin);
                if (u.searchParams.get("v") !== req.videoId) return false;
                if (u.searchParams.get("lang") !== req.languageCode) return false;
                const kind = u.searchParams.get("kind") ?? "";
                return kind === req.kind;
            } catch {
                return false;
            }
        };

        const nativeCaptionsOn = (): boolean =>
            document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-pressed") === "true";

        const handleTrackRequest = (req: YtBridgeTrackRequest) => {
            const respond = (body: string | null) => {
                window.postMessage(
                    { type: YT_BRIDGE_TRACK_RESPONSE, id: req.id, body },
                    "*",
                );
            };

            // Already captured passively (e.g. the user had CC on at load)?
            const existing = [...captures].reverse().find((c) => matchesCapture(c, req));
            if (existing) {
                respond(existing.body);
                return;
            }

            const player = getPlayer();
            if (!player?.loadModule) {
                respond(null);
                return;
            }

            // From here on we need to observe the player's own timedtext
            // request, so the interceptors must be up for the duration.
            pendingCaptures++;
            installCapture();

            const wasOn = nativeCaptionsOn();
            let done = false;
            const finish = (body: string | null) => {
                if (done) return;
                done = true;
                listeners.delete(onCapture);
                clearTimeout(timer);
                pendingCaptures--;
                scheduleUninstall();
                // Leave the user-visible CC state as we found it. (While our
                // overlay is enabled the isolated side hides native captions
                // via CSS anyway, so a wasOn=true player stays clean too.)
                if (!wasOn) {
                    try { player.unloadModule("captions"); } catch { /* noop */ }
                }
                respond(body);
            };
            const onCapture = (c: Captured) => {
                if (matchesCapture(c, req)) finish(c.body);
            };
            listeners.add(onCapture);
            const timer = setTimeout(() => finish(null), 8000);

            try {
                // unload → load resets the module so setOption always triggers
                // a fresh timedtext request (a cached same-track selection
                // would otherwise fetch nothing).
                try { player.unloadModule("captions"); } catch { /* noop */ }
                player.loadModule("captions");
                player.setOption("captions", "track", {
                    languageCode: req.languageCode,
                    ...(req.kind ? { kind: req.kind } : {}),
                });
            } catch {
                finish(null);
            }
        };

        // ------------------------------------------------------------------
        // Message dispatch
        // ------------------------------------------------------------------
        window.addEventListener("message", (ev: MessageEvent) => {
            if (ev.source !== window) return;
            const msg = ev.data;
            if (!msg || typeof msg.id !== "string") return;
            if (msg.type === YT_BRIDGE_REQUEST) {
                let data: YtBridgePlayerData | null = null;
                try {
                    data = readPlayerData();
                } catch {
                    data = null;
                }
                window.postMessage({ type: YT_BRIDGE_RESPONSE, id: msg.id, data }, "*");
            } else if (msg.type === YT_BRIDGE_TRACK_REQUEST) {
                handleTrackRequest(msg as YtBridgeTrackRequest);
            }
        });
    },
});
