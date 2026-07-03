// Text-to-speech synthesis (background only).
//
// Two providers — Google (translate_tts, GET) and Bing (tfettts, POST + a
// token scraped from bing.com/translator). Both endpoints respond with no CORS
// headers and Bing requires a same-origin token, so the fetch cannot run in the
// content script; the background performs it and hands back base64 `data:` URLs
// (one per <=170-char chunk) that content plays sequentially through <audio>.
//
// Modelled on Traduzir-paginas-web's textToSpeech.js.
import { TTS_SERVICE } from "@/main/constants";

const MAX_CHUNK_CHARS = 170;

/**
 * Split text into <=170-char chunks at word/sentence boundaries so each maps to
 * one short TTS request (both providers cap the query length). Words longer than
 * the limit are hard-split.
 */
export function chunkTextForTts(text: string): string[] {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return [];
    const chunks: string[] = [];
    // Split on whitespace but also break very long tokens.
    const words: string[] = [];
    for (const w of clean.split(" ")) {
        if (w.length <= MAX_CHUNK_CHARS) {
            words.push(w);
        } else {
            for (let i = 0; i < w.length; i += MAX_CHUNK_CHARS) {
                words.push(w.slice(i, i + MAX_CHUNK_CHARS));
            }
        }
    }
    let current = "";
    for (const w of words) {
        if (current === "") {
            current = w;
        } else if (current.length + 1 + w.length <= MAX_CHUNK_CHARS) {
            current += " " + w;
        } else {
            chunks.push(current);
            current = w;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

// ---------------------------------------------------------------------------
// Language mapping
// ---------------------------------------------------------------------------

/** Normalize the app's language code to what Google translate_tts expects. */
function googleTtsLang(lang: string): string {
    const l = (lang || "").trim();
    if (!l || l === "und" || l === "auto") return "en";
    if (l.toLowerCase().startsWith("zh")) {
        return l.toLowerCase() === "zh-tw" ? "zh-TW" : "zh-CN";
    }
    // Google TTS uses two-letter codes for most; take the primary subtag.
    const primary = l.split("-")[0];
    const map: Record<string, string> = { fil: "fil", nb: "no", he: "iw", jv: "jw" };
    return map[l] || map[primary] || primary;
}

/**
 * Bing neural voice per language. Locale is derived from the voice name's first
 * two segments. Languages absent here fall back to Google TTS (see synthesize).
 */
const BING_VOICES: Record<string, string> = {
    "zh-CN": "zh-CN-XiaoxiaoNeural",
    "zh-TW": "zh-TW-HsiaoChenNeural",
    en: "en-US-AriaNeural",
    fr: "fr-FR-DeniseNeural",
    ru: "ru-RU-SvetlanaNeural",
    de: "de-DE-KatjaNeural",
    ja: "ja-JP-NanamiNeural",
    it: "it-IT-ElsaNeural",
    es: "es-ES-ElviraNeural",
    ko: "ko-KR-SunHiNeural",
    pt: "pt-BR-FranciscaNeural",
    id: "id-ID-GadisNeural",
    ar: "ar-EG-SalmaNeural",
    bn: "bn-IN-TanishaaNeural",
    hi: "hi-IN-SwaraNeural",
    nl: "nl-NL-ColetteNeural",
    pl: "pl-PL-ZofiaNeural",
    tr: "tr-TR-EmelNeural",
    vi: "vi-VN-HoaiMyNeural",
    th: "th-TH-PremwadeeNeural",
    sv: "sv-SE-SofieNeural",
    da: "da-DK-ChristelNeural",
    fi: "fi-FI-NooraNeural",
    no: "nb-NO-PernilleNeural",
    cs: "cs-CZ-VlastaNeural",
    el: "el-GR-AthinaNeural",
    he: "he-IL-HilaNeural",
    hu: "hu-HU-NoemiNeural",
    ro: "ro-RO-AlinaNeural",
    uk: "uk-UA-PolinaNeural",
    sk: "sk-SK-ViktoriaNeural",
    bg: "bg-BG-KalinaNeural",
    hr: "hr-HR-GabrijelaNeural",
    ca: "ca-ES-JoanaNeural",
    fa: "fa-IR-DilaraNeural",
    ta: "ta-IN-PallaviNeural",
    te: "te-IN-ShrutiNeural",
    ml: "ml-IN-SobhanaNeural",
    ur: "ur-PK-UzmaNeural",
    ms: "ms-MY-YasminNeural",
    fil: "fil-PH-BlessicaNeural",
    tl: "fil-PH-BlessicaNeural",
};

function bingVoiceFor(lang: string): { voice: string; locale: string } | null {
    const l = (lang || "").trim();
    let voice = BING_VOICES[l];
    if (!voice) {
        const primary = l.split("-")[0];
        voice = BING_VOICES[primary];
    }
    if (!voice) return null;
    const parts = voice.split("-");
    const locale = `${parts[0]}-${parts[1]}`;
    return { voice, locale };
}

// ---------------------------------------------------------------------------
// base64 helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]);
    }
    return btoa(binary);
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

async function fetchGoogleChunk(text: string, lang: string): Promise<string> {
    const url =
        `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(googleTtsLang(lang))}` +
        `&client=dict-chrome-ex&ttsspeed=0.5&q=${encodeURIComponent(text)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Google TTS HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return `data:audio/mpeg;base64,${bufferToBase64(buf)}`;
}

async function googleTts(text: string, lang: string): Promise<string[]> {
    const chunks = chunkTextForTts(text);
    return Promise.all(chunks.map((c) => fetchGoogleChunk(c, lang)));
}

// ---------------------------------------------------------------------------
// Bing
// ---------------------------------------------------------------------------

interface BingCreds {
    ig: string;
    iid: string;
    key: string;
    token: string;
    expireAt: number;
}
let bingCreds: BingCreds | null = null;

async function getBingCreds(): Promise<BingCreds> {
    if (bingCreds && bingCreds.expireAt > Date.now()) return bingCreds;
    const r = await fetch("https://www.bing.com/translator");
    if (!r.ok) throw new Error(`Bing translator page HTTP ${r.status}`);
    const html = await r.text();
    const ig = html.match(/IG:"([^"]+)"/)?.[1];
    const iid = html.match(/data-iid="([^"]+)"/)?.[1];
    const abuse = html.match(/params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/)?.[1];
    if (!ig || !iid || !abuse) throw new Error("Bing TTS: failed to parse credentials");
    const parts = abuse.split(",");
    const key = parts[0]?.trim();
    const token = parts[1]?.trim().replace(/^"|"$/g, "");
    if (!key || !token) throw new Error("Bing TTS: failed to parse token");
    // Token lifetime is ~10 min; refresh a bit early.
    bingCreds = { ig, iid, key, token, expireAt: Date.now() + 8 * 60 * 1000 };
    return bingCreds;
}

function buildSsml(text: string, voice: string, locale: string): string {
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    return (
        `<speak version='1.0' xml:lang='${locale}'>` +
        `<voice xml:lang='${locale}' xml:gender='Female' name='${voice}'>` +
        `<prosody rate='-20.00%'>${escaped}</prosody>` +
        `</voice></speak>`
    );
}

async function fetchBingChunk(text: string, voice: string, locale: string, creds: BingCreds): Promise<string> {
    const url = `https://www.bing.com/tfettts?isVertical=1&&IG=${creds.ig}&IID=${creds.iid}.1`;
    const body = new URLSearchParams({
        ssml: buildSsml(text, voice, locale),
        token: creds.token,
        key: creds.key,
    });
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });
    if (!r.ok) throw new Error(`Bing TTS HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return `data:audio/mpeg;base64,${bufferToBase64(buf)}`;
}

async function bingTts(text: string, lang: string): Promise<string[]> {
    const voiceInfo = bingVoiceFor(lang);
    // No Bing voice for this language — fall back to Google so playback still works.
    if (!voiceInfo) return googleTts(text, lang);
    const chunks = chunkTextForTts(text);
    let creds = await getBingCreds();
    const out: string[] = [];
    for (const c of chunks) {
        try {
            out.push(await fetchBingChunk(c, voiceInfo.voice, voiceInfo.locale, creds));
        } catch (e) {
            // Token may have expired mid-run — refresh once and retry this chunk.
            bingCreds = null;
            creds = await getBingCreds();
            out.push(await fetchBingChunk(c, voiceInfo.voice, voiceInfo.locale, creds));
        }
    }
    return out;
}

/**
 * Synthesize `text` in `lang` via the requested provider. Returns an ordered
 * array of `data:audio/mpeg;base64,...` URLs (one per chunk).
 */
export async function synthesizeTts(text: string, lang: string, service: string): Promise<string[]> {
    if (!text || !text.trim()) return [];
    if (service === TTS_SERVICE.BING) return bingTts(text, lang);
    return googleTts(text, lang);
}
