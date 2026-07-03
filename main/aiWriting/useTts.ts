import { useCallback, useEffect, useRef, useState } from "react";
import { ACTION, CONFIG_KEY, DEFAULT_VALUE } from "@/main/constants";
import { getConfig } from "@/utils/db";
import { sendMessageToBackground } from "@/utils/message";

/**
 * Text-to-speech playback for the selection-translate popup.
 *
 * The background synthesizes the audio (Google / Bing) and returns an ordered
 * array of `data:` URLs (one per chunk); this hook plays them sequentially
 * through a single reused <audio> element. Only one utterance plays at a time,
 * tracked by a caller-supplied key (e.g. "orig" / "trans") so two buttons can
 * share one player and each reflect its own playing state.
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
    const audioRef = useRef<HTMLAudioElement | null>(null);
    // Monotonic token so a stale async response (fetch that resolves after the
    // user already stopped / switched) can't hijack the player.
    const runIdRef = useRef(0);

    const stop = useCallback(() => {
        runIdRef.current++;
        const a = audioRef.current;
        if (a) {
            a.onended = null;
            a.onerror = null;
            try { a.pause(); } catch { /* ignore */ }
            a.src = "";
        }
        setPlayingKey(null);
    }, []);

    // Stop playback if the component unmounts.
    useEffect(() => stop, [stop]);

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
                30000,
            );
            // Superseded while we were fetching.
            if (runId !== runIdRef.current) return;
            const audios: string[] = resp?.audios ?? [];
            if (!audios.length) {
                setPlayingKey(null);
                return;
            }
            const audio = audioRef.current ?? (audioRef.current = new Audio());
            let index = 0;
            const playNext = () => {
                if (runId !== runIdRef.current) return;
                if (index >= audios.length) {
                    // Finished the whole sequence — reset the button.
                    if (runId === runIdRef.current) setPlayingKey(null);
                    return;
                }
                audio.src = audios[index++];
                audio.onended = playNext;
                audio.onerror = () => { if (runId === runIdRef.current) setPlayingKey(null); };
                audio.play().catch(() => { if (runId === runIdRef.current) setPlayingKey(null); });
            };
            playNext();
        })();
    }, [playingKey, stop]);

    return { playingKey, toggle, stop };
}
