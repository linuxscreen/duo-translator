import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION, API_REQUEST_TIMEOUT, CONFIG_KEY, DEFAULT_VALUE } from "@/main/constants";
import { getConfig } from "@/utils/db";
import { sendMessageToBackgroundOrThrow } from "@/utils/message";
import { ERROR_SCOPE, reportRequestError } from "@/main/errorReport";
import { fetchDictAudio } from "@/main/dict/dictClient";

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
 *   - `toggleUrl(key, url)` — same, for audio that already exists as a file:
 *     the dictionary's human recordings. It shares this player rather than
 *     owning one, so a word's pronunciation and the translation's TTS cannot
 *     end up talking over each other, and one `playingKey` drives every button.
 *   - `stop()` — hard stop (used on popup close / re-open).
 */
export function useTts(): {
    playingKey: string | null;
    toggle: (key: string, text: string, lang: string) => void;
    toggleUrl: (key: string, url: string) => void;
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

    /**
     * Shared pipeline: claim the player, resolve the audio (however the caller
     * gets it), then decode and play the chunks in order. `resolve` is the only
     * difference between speaking text and playing a dictionary recording, so
     * everything downstream of it — the run token, the AudioContext, the
     * autoplay resume, the failure reporting — exists once.
     */
    const play = useCallback((
        key: string,
        detail: Record<string, unknown>,
        resolve: () => Promise<string[]>,
    ) => {
        // Clicking the utterance that's already playing stops it.
        if (playingKey === key) {
            stop();
            return;
        }
        // Starting a new one — supersede any in-flight request/playback.
        stop();
        const runId = runIdRef.current;
        setPlayingKey(key);

        (async () => {
            let audios: string[];
            try {
                // Throwing variant: the swallowing one turned every TTS failure
                // (dead endpoint, Bing token scrape broken, unsupported
                // language) into a button that flickers and does nothing.
                audios = await resolve();
            } catch (e) {
                if (runId !== runIdRef.current) return;
                setPlayingKey(null);
                reportRequestError(ERROR_SCOPE.TTS, e, { detail });
                return;
            }
            // Superseded while we were fetching.
            if (runId !== runIdRef.current) return;
            if (!audios.length) {
                setPlayingKey(null);
                reportRequestError(
                    ERROR_SCOPE.TTS,
                    new Error("the speech service returned no audio"),
                    { detail },
                );
                return;
            }
            const ctx = ctxRef.current ?? (ctxRef.current = new AudioContext());
            // The context may start (or get) suspended by the autoplay policy;
            // toggle is always invoked from a user click, so resume is allowed.
            if (ctx.state === "suspended") {
                try { await ctx.resume(); } catch { /* ignore */ }
                if (runId !== runIdRef.current) return;
            }
            // Playback failures are reported too: the audio arrived, so from the
            // user's side "I pressed play and got silence" is the same symptom
            // as a failed request and deserves the same explanation.
            const fail = (e: any) => {
                if (runId !== runIdRef.current) return;
                setPlayingKey(null);
                reportRequestError(ERROR_SCOPE.TTS, e, { detail: { ...detail, phase: "playback" } });
            };
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
                } catch (e) {
                    fail(e);
                    return;
                }
                if (runId !== runIdRef.current) return;
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => { void playNext(); };
                sourceRef.current = source;
                try { source.start(); } catch (e) { fail(e); }
            };
            void playNext();
        })();
    }, [playingKey, stop]);

    const toggle = useCallback((key: string, text: string, lang: string) => {
        const clean = (text || "").trim();
        if (!clean && playingKey !== key) return;
        play(key, { lang }, async () => {
            const service = (await getConfig(CONFIG_KEY.TTS_SERVICE)) || DEFAULT_VALUE.TTS_SERVICE;
            const resp: any = await sendMessageToBackgroundOrThrow(
                { action: ACTION.TTS_SYNTHESIZE, data: { text: clean, lang, service } },
                API_REQUEST_TIMEOUT,
            );
            return resp?.audios ?? [];
        });
    }, [play, playingKey]);

    const toggleUrl = useCallback((key: string, url: string) => {
        if (!url && playingKey !== key) return;
        play(key, { url }, () => fetchDictAudio(url));
    }, [play, playingKey]);

    return { playingKey, toggle, toggleUrl, stop };
}

/** Decode the base64 payload of a `data:` URL into an ArrayBuffer. */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
