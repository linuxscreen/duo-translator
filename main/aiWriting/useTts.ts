import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION, API_REQUEST_TIMEOUT, CONFIG_KEY, DEFAULT_VALUE } from "@/main/constants";
import { getConfig } from "@/utils/db";
import { sendMessageToBackground } from "@/utils/message";

/**
 * Text-to-speech playback for the selection-translate popup.
 *
 * The background synthesizes the audio (Google / Bing) and returns an ordered
 * array of `data:` URLs (one per chunk). Playback uses the Web Audio API
 * (decodeAudioData + AudioBufferSourceNode) instead of an <audio> element:
 * a media element created by a content script belongs to the page's document,
 * so its `src` load is subject to the PAGE's CSP `media-src` — sites like
 * chatgpt.com / claude.ai don't allow `data:` there and block playback.
 * Web Audio performs no URL resource load, so page CSP never applies.
 *
 * Only one utterance plays at a time, tracked by a caller-supplied key
 * (e.g. "orig" / "trans") so two buttons can share one player and each
 * reflect its own playing state.
 *
 * Returns:
 *   - `playingKey`  — the key currently playing, or null.
 *   - `toggle(key, text, lang)` — start that utterance, or stop it if it's the
 *     one already playing (click-to-pause). Switching keys stops the old first.
 *   - `stop()` — hard stop (used on popup close / re-open).
 */
export function useTts(): {
    playingKey: string | null;
    toggle: (key: string, text: string, lang: string) => void;
    stop: () => void;
} {
    const [playingKey, setPlayingKey] = useState<string | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const sourceRef = useRef<AudioBufferSourceNode | null>(null);
    // Monotonic token so a stale async response (fetch/decode that resolves
    // after the user already stopped / switched) can't hijack the player.
    const runIdRef = useRef(0);

    const stop = useCallback(() => {
        runIdRef.current++;
        const source = sourceRef.current;
        if (source) {
            source.onended = null;
            try { source.stop(); } catch { /* already stopped */ }
            try { source.disconnect(); } catch { /* ignore */ }
            sourceRef.current = null;
        }
        setPlayingKey(null);
    }, []);

    // Stop playback and release the AudioContext if the component unmounts.
    useEffect(() => () => {
        stop();
        ctxRef.current?.close().catch(() => { /* ignore */ });
        ctxRef.current = null;
    }, [stop]);

    const toggle = useCallback((key: string, text: string, lang: string) => {
        // Clicking the utterance that's already playing stops it.
        if (playingKey === key) {
            stop();
            return;
        }
        // Starting a new one — supersede any in-flight request/playback.
        stop();
        const runId = runIdRef.current;
        const clean = (text || "").trim();
        if (!clean) return;
        setPlayingKey(key);

        (async () => {
            const service = (await getConfig(CONFIG_KEY.TTS_SERVICE)) || DEFAULT_VALUE.TTS_SERVICE;
            const resp = await sendMessageToBackground(
                { action: ACTION.TTS_SYNTHESIZE, data: { text: clean, lang, service } },
                API_REQUEST_TIMEOUT,
            );
            // Superseded while we were fetching.
            if (runId !== runIdRef.current) return;
            const audios: string[] = resp?.audios ?? [];
            if (!audios.length) {
                setPlayingKey(null);
                return;
            }
            const ctx = ctxRef.current ?? (ctxRef.current = new AudioContext());
            // The context may start (or get) suspended by the autoplay policy;
            // toggle is always invoked from a user click, so resume is allowed.
            if (ctx.state === "suspended") {
                try { await ctx.resume(); } catch { /* ignore */ }
                if (runId !== runIdRef.current) return;
            }
            const fail = () => { if (runId === runIdRef.current) setPlayingKey(null); };
            let index = 0;
            const playNext = async () => {
                if (runId !== runIdRef.current) return;
                sourceRef.current = null;
                if (index >= audios.length) {
                    // Finished the whole sequence — reset the button.
                    setPlayingKey(null);
                    return;
                }
                let buffer: AudioBuffer;
                try {
                    buffer = await ctx.decodeAudioData(dataUrlToArrayBuffer(audios[index++]));
                } catch {
                    fail();
                    return;
                }
                if (runId !== runIdRef.current) return;
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => { void playNext(); };
                sourceRef.current = source;
                try { source.start(); } catch { fail(); }
            };
            void playNext();
        })();
    }, [playingKey, stop]);

    return { playingKey, toggle, stop };
}

/** Decode the base64 payload of a `data:` URL into an ArrayBuffer. */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
