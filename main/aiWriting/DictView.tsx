import { Loader2, Volume2 } from "lucide-react";
import type { DictEntry, DictPhonetic } from "@/main/dict/types";
import { t } from "./i18n";

/**
 * Dictionary panel under the translation in the selection popup.
 *
 * Layout follows Bing's dictionary page: headword and its pronunciations on one
 * line, then the senses as a part-of-speech column beside its glosses, then a
 * short list of examples.
 */

/** Examples shown. Bing/Google return more; the panel sits under a translation. */
const MAX_EXAMPLES = 2;

export interface DictAudioController {
    /** Key currently playing, or null. Shared with the popup's TTS player. */
    playingKey: string | null;
    /** Play a recording by URL (dictionary audio). */
    playUrl: (key: string, url: string) => void;
    /** Speak text with the configured TTS voice — the fallback when a provider has no recording. */
    speak: (key: string, text: string, lang: string) => void;
}

export function DictView({
    entry,
    loading,
    error,
    wordLang,
    audio,
    standalone = false,
}: {
    entry: DictEntry | null;
    loading: boolean;
    error: string | null;
    /** Language of the headword, for the TTS fallback. */
    wordLang: string;
    audio: DictAudioController;
    /**
     * The panel IS the card (the subtitle hover popup) rather than a section
     * appended under a translation. Only difference: no top separator, which
     * would otherwise double up with the card's own border.
     */
    standalone?: boolean;
}) {
    // Standalone: no top separator (the card has its own border) and room on
    // the right for the close button floating over the first row.
    const shellCls = standalone ? "pr-8 " : "border-t border-line ";
    if (loading) {
        return (
            <div className={`${shellCls}px-3 py-2 text-[12px] text-ink-soft`}>
                <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t("dictLoading", "Looking up…")}
                </span>
            </div>
        );
    }
    // No entry is not a failure — most selections simply are not headwords, and
    // an empty panel saying so on every lookup would be noise. A failed REQUEST
    // is different and does get a line, because otherwise a broken provider
    // looks exactly like a word that isn't in the dictionary.
    if (error) {
        return (
            <div className={`${shellCls}px-3 py-2 text-[12px] text-error`}>{error}</div>
        );
    }
    if (!entry) return null;

    const examples = entry.examples.slice(0, MAX_EXAMPLES);
    // Providers without recordings (Google) still get a speaker button, driven
    // by the configured TTS voice — the same one the translation rows use.
    const speakFallback = () => audio.speak("dict-word", entry.word, wordLang);

    return (
        <div className={`${shellCls}px-3 py-2.5`}>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
                {t("dictSection", "Dictionary")}
            </div>

            {/* Headword + pronunciations. The headword is shown even when it
                equals the selection: a lookup of "tools" answers for "tool",
                and the user has to be able to see which word was defined. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[15px] font-semibold text-ink">{entry.word}</span>
                {entry.phonetics.map((p) => (
                    <Pronunciation
                        key={p.accent}
                        phonetic={p}
                        playing={audio.playingKey === `dict-${p.accent}`}
                        onPlay={() =>
                            p.audio
                                ? audio.playUrl(`dict-${p.accent}`, p.audio)
                                : audio.speak(`dict-${p.accent}`, entry.word, wordLang)
                        }
                    />
                ))}
                {entry.phonetics.length === 0 && (
                    <button
                        type="button"
                        onClick={speakFallback}
                        title={t("selectionPlaySpeech", "Play")}
                        aria-label={t("selectionPlaySpeech", "Play")}
                        className={`h-5 w-5 inline-flex items-center justify-center rounded hover:bg-hover-3 ${audio.playingKey === "dict-word" ? "text-accent" : "text-ink-soft"}`}
                    >
                        <Volume2 className="h-3 w-3" />
                    </button>
                )}
            </div>

            {entry.definitions.length > 0 && (
                <div className="mt-1.5 flex flex-col gap-0.5">
                    {entry.definitions.map((d, i) => (
                        <div key={`${d.pos}-${i}`} className="flex gap-2 text-[13px] leading-normal">
                            {d.pos && (
                                <span className="shrink-0 min-w-[34px] italic text-accent">{d.pos}</span>
                            )}
                            <span className="min-w-0 text-ink-2">{d.senses.join("；")}</span>
                        </div>
                    ))}
                </div>
            )}

            {examples.length > 0 && (
                <div className="mt-2">
                    <div className="mb-1 text-[11px] text-ink-soft">{t("dictExamples", "Examples")}</div>
                    <ol className="flex flex-col gap-1.5">
                        {examples.map((ex, i) => (
                            <li key={i} className="flex gap-1.5 text-[12.5px] leading-normal">
                                <span className="shrink-0 text-ink-mute">{i + 1}.</span>
                                <span className="min-w-0">
                                    <span className="block text-ink-2">{ex.source}</span>
                                    {ex.target && <span className="block text-ink-soft">{ex.target}</span>}
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}
        </div>
    );
}

function Pronunciation({
    phonetic,
    playing,
    onPlay,
}: {
    phonetic: DictPhonetic;
    playing: boolean;
    onPlay: () => void;
}) {
    const label = phonetic.accent === "uk" ? t("dictAccentUk", "UK") : t("dictAccentUs", "US");
    return (
        <span className="inline-flex items-center gap-1 text-[12px] text-ink-soft">
            <span>{label}</span>
            {phonetic.text && <span className="font-mono">[{phonetic.text}]</span>}
            <button
                type="button"
                onClick={onPlay}
                title={t("selectionPlaySpeech", "Play")}
                aria-label={`${label} ${t("selectionPlaySpeech", "Play")}`}
                className={`h-5 w-5 inline-flex items-center justify-center rounded hover:bg-hover-3 ${playing ? "text-accent" : "text-ink-soft"}`}
            >
                <Volume2 className="h-3 w-3" />
            </button>
        </span>
    );
}
