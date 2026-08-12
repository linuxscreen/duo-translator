// Dictionary providers — BACKGROUND ONLY.
//
// Same rule as the translate/AI providers: content asks by meaning
// (ACTION.DICT_LOOKUP with {provider, word, targetLang}) and this side owns the
// endpoints, the parsing and the cache. Neither endpoint sends CORS headers, so
// a content-script fetch would fail outright in Chrome and be blocked by the
// host page's CSP in Firefox.
//
// The content-side twin is main/dict/dictClient.ts; the shapes both sides speak
// are in main/dict/types.ts.

import { ACTION } from "@/main/constants";
import { handleAsync } from "@/main/messageBridge";
import {
    DICT_REFRESH_AFTER_MS,
    dictCacheKey,
    readDictCache,
    writeDictCache,
} from "@/main/storage/dictCache";
import type { DictDefinition, DictEntry, DictExample, DictPhonetic, DictProvider } from "./types";

const BING_HOST = "https://www.bing.com";
const GOOGLE_HOST = "https://translate.google.com";

/** How much of an error body is worth quoting back to the page. */
const ERROR_BODY_CHARS = 300;

function dictHttpError(provider: string, url: string, status: number, statusText: string, body: string): Error {
    const host = (() => {
        try { return new URL(url).host; } catch { return url; }
    })();
    const snippet = (body || "").trim().slice(0, ERROR_BODY_CHARS);
    return new Error(
        `${provider} HTTP ${status}${statusText ? " " + statusText : ""} (${host})${snippet ? ": " + snippet : ""}`,
    );
}

/** Bare `Failed to fetch` names neither the target nor the reason — wrap it. */
async function dictFetch(provider: string, url: string, init?: RequestInit): Promise<Response> {
    let r: Response;
    try {
        r = await fetch(url, init);
    } catch (e: any) {
        if (e?.name === "AbortError") throw e;
        const host = (() => {
            try { return new URL(url).host; } catch { return url; }
        })();
        throw new Error(`${provider} network error requesting ${host}: ${e?.message || String(e)}`);
    }
    if (!r.ok) {
        throw dictHttpError(provider, url, r.status, r.statusText, await r.text().catch(() => ""));
    }
    return r;
}

// ---------------------------------------------------------------------------
// Bing dictionary — HTML scraping
// ---------------------------------------------------------------------------
//
// Bing has no dictionary API, so this reads the same page a browser would. Two
// consequences worth stating plainly:
//
//  * It is parsed with regular expressions, not DOMParser — there is no
//    DOMParser in an MV3 service worker (the same constraint that made the
//    WebDAV provider regex-parse its PROPFIND replies). Every extractor below
//    is therefore anchored on a class or id and non-greedy up to the first
//    closing tag, and every one of them is allowed to find nothing.
//  * It WILL break when Bing restyles the page. That is why a failed parse
//    returns null (a cached "no entry") rather than throwing: the dictionary is
//    a supplement under the translation, and the translation is unaffected.

const HTML_ENTITIES: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'",
};

function decodeEntities(s: string): string {
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
        const known = HTML_ENTITIES[name.toLowerCase()];
        if (known !== undefined) return known;
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X"
                ? parseInt(name.slice(2), 16)
                : parseInt(name.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return whole;
    });
}

/** Tags → nothing, entities → characters, runs of whitespace → one space. */
function stripTags(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function firstMatch(html: string, re: RegExp): string | null {
    const m = re.exec(html);
    return m ? m[1] : null;
}

/** Pull the IPA out of Bing's "美 [tuːlz]" / "英 [tuːlz]" label. */
function ipaOf(label: string | null): string {
    if (!label) return "";
    return /\[([^\]]+)\]/.exec(stripTags(label))?.[1]?.trim() ?? "";
}

function absoluteBingUrl(link: string): string {
    return /^https?:\/\//i.test(link) ? link : BING_HOST + link;
}

function parseBingPhonetics(html: string): DictPhonetic[] {
    const out: DictPhonetic[] = [];
    // `hd_pr` and `hd_prUS` share a prefix — the required whitespace after
    // `hd_pr` is what keeps the UK matcher off the US element.
    const pairs: { accent: "uk" | "us"; label: RegExp; audio: RegExp }[] = [
        {
            accent: "uk",
            label: /class="hd_pr\s[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            audio: /id="bigaud_uk"[^>]*data-mp3link="([^"]+)"/i,
        },
        {
            accent: "us",
            label: /class="hd_prUS[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            audio: /id="bigaud_us"[^>]*data-mp3link="([^"]+)"/i,
        },
    ];
    for (const p of pairs) {
        const text = ipaOf(firstMatch(html, p.label));
        const link = firstMatch(html, p.audio);
        if (!text && !link) continue;
        out.push({ accent: p.accent, text, ...(link ? { audio: absoluteBingUrl(link) } : {}) });
    }
    return out;
}

function parseBingDefinitions(html: string): DictDefinition[] {
    // The concise-definition block: `<div class="qdef"> … <ul><li>…</li></ul>`.
    const list = firstMatch(html, /<div class="qdef"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
    if (!list) return [];
    const out: DictDefinition[] = [];
    for (const li of list.match(/<li[^>]*>[\s\S]*?<\/li>/gi) ?? []) {
        const pos = stripTags(firstMatch(li, /class="pos[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ?? "");
        const def = stripTags(firstMatch(li, /class="def[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/li>/i)
            ?? firstMatch(li, /class="def[^"]*"[^>]*>([\s\S]*?)<\/li>/i)
            ?? "");
        if (!def) continue;
        // Bing separates senses with a full-width semicolon.
        out.push({ pos, senses: def.split(/[；;]/).map((s) => s.trim()).filter(Boolean) });
    }
    return out;
}

function parseBingExamples(html: string): DictExample[] {
    const section = html.slice(html.search(/id="sentenceSeg"/i));
    if (!section) return [];
    const out: DictExample[] = [];
    const re = /class="sen_en[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]{0,400}?class="sen_cn[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
        const source = stripTags(m[1]);
        const target = stripTags(m[2]);
        if (source && target) out.push({ source, target });
    }
    return out;
}

async function microsoftDict(word: string): Promise<DictEntry | null> {
    const url = `${BING_HOST}/dict/search?q=${encodeURIComponent(word)}&FORM=BDVSP6&cc=cn`;
    // `credentials: include` mirrors what a browser visit sends; without the
    // cookies Bing is quicker to answer with an anti-bot interstitial.
    const html = await (await dictFetch("Bing Dictionary", url, { credentials: "include" })).text();

    const headword = stripTags(
        firstMatch(html, /id="headword"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? "",
    );
    if (!headword) return null;

    const definitions = parseBingDefinitions(html);
    const examples = parseBingExamples(html);
    if (definitions.length === 0 && examples.length === 0) return null;

    return {
        provider: "microsoft",
        word: headword,
        query: word,
        phonetics: parseBingPhonetics(html),
        definitions,
        examples,
    };
}

// ---------------------------------------------------------------------------
// Google dictionary — translate_a/single in dictionary mode
// ---------------------------------------------------------------------------
//
// The `dt=bd` (dictionary) / `dt=ex` (examples) / `dt=rm` (romanization) flags
// make the ordinary single-translation endpoint return the dictionary payload
// as well. It is a positional array with no schema, so every index below is
// read defensively — a shape change degrades a section to empty rather than
// throwing.

const isText = (v: any): v is string => typeof v === "string" && v.trim() !== "";

/** First extractor that yields anything. Sections are lazy — most return null. */
function firstNonEmpty<T>(...extractors: (() => T[])[]): T[] {
    for (const extract of extractors) {
        const got = extract();
        if (got.length > 0) return got;
    }
    return [];
}

/**
 * `result[1]` — the bilingual dictionary (`dt=bd`): glosses in the target
 * language, grouped by part of speech. The richest section, but it is only
 * populated for the pairs Google has a dictionary for. It is **null** for
 * English→English and for every source language other than English, which is
 * why the two fallbacks below exist.
 */
function bilingualDefinitions(raw: any): DictDefinition[] {
    if (!Array.isArray(raw)) return [];
    const out: DictDefinition[] = [];
    for (const group of raw) {
        const pos = isText(group?.[0]) ? group[0] : "";
        const senses: string[] = Array.isArray(group?.[2])
            ? group[2].map((s: any) => s?.[0]).filter(isText)
            : (Array.isArray(group?.[1]) ? group[1].filter(isText) : []);
        if (senses.length > 0) out.push({ pos, senses });
    }
    return out;
}

/**
 * `result[5]` — alternative translations (`dt=at`). No part of speech, but the
 * glosses ARE in the target language, so this is the right stand-in when the
 * bilingual dictionary is missing (a French word into Chinese: `[1]` is null,
 * `[5]` still carries 被处决 / 执行).
 */
function alternativeDefinitions(raw: any): DictDefinition[] {
    if (!Array.isArray(raw)) return [];
    const senses: string[] = [];
    for (const segment of raw) {
        for (const alt of Array.isArray(segment?.[2]) ? segment[2] : []) {
            if (isText(alt?.[0]) && !senses.includes(alt[0])) senses.push(alt[0]);
        }
    }
    return senses.length > 0 ? [{ pos: "", senses }] : [];
}

/**
 * `result[12]` — monolingual definitions (`dt=md`), grouped by part of speech,
 * each entry `[definition, id, exampleSentence?]`.
 *
 * Last resort for the glosses (it is the ONLY section an English→English lookup
 * gets), and — separately — the only source of examples for a pair where
 * `result[13]` comes back null.
 */
function monolingualGroups(raw: any): { pos: string; entries: any[] }[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((group: any) => ({
            pos: isText(group?.[0]) ? group[0] : "",
            entries: Array.isArray(group?.[1]) ? group[1] : [],
        }))
        .filter((g) => g.entries.length > 0);
}

function monolingualDefinitions(raw: any): DictDefinition[] {
    const out: DictDefinition[] = [];
    for (const group of monolingualGroups(raw)) {
        const senses = group.entries.map((e: any) => e?.[0]).filter(isText);
        if (senses.length > 0) out.push({ pos: group.pos, senses });
    }
    return out;
}

/** `result[13][0]` — each item's first field is the sentence, headword in `<b>`. */
function exampleSection(raw: any): DictExample[] {
    const items = raw?.[0];
    if (!Array.isArray(items)) return [];
    const out: DictExample[] = [];
    for (const item of items) {
        if (isText(item?.[0])) out.push({ source: stripTags(item[0]) });
    }
    return out;
}

/** The example sentence riding along on each monolingual definition. */
function examplesFromDefinitions(raw: any): DictExample[] {
    const out: DictExample[] = [];
    for (const group of monolingualGroups(raw)) {
        for (const entry of group.entries) {
            if (isText(entry?.[2])) out.push({ source: stripTags(entry[2]) });
        }
    }
    return out;
}

/**
 * The base form, which for an inflected selection is the whole point of showing
 * a headword at all ("exécutée" → "exécuter", "ran" → "run").
 *
 * Four places carry it, none of them reliably: a spelling correction, the
 * bilingual dictionary's own base-form field, the monolingual group's, and the
 * trailing "see also" list. Whichever answers first wins.
 */
function googleLemma(data: any, word: string): string {
    const candidates = [
        data?.[7]?.[1],
        data?.[1]?.[0]?.[3],
        data?.[12]?.[0]?.[2],
        data?.[14]?.[0]?.[0],
    ];
    for (const c of candidates) if (isText(c)) return c;
    return word;
}

async function googleDict(word: string, targetLang: string): Promise<DictEntry | null> {
    const params = new URLSearchParams({
        client: "gtx",
        sl: "auto",
        tl: targetLang,
        hl: targetLang,
        ie: "UTF-8",
        oe: "UTF-8",
        otf: "1",
        ssel: "0",
        tsel: "0",
        kc: "7",
        q: word,
    });
    // Repeated keys — URLSearchParams takes them one at a time.
    for (const dt of ["at", "bd", "ex", "ld", "md", "qca", "rw", "rm", "ss", "t"]) params.append("dt", dt);
    const url = `${GOOGLE_HOST}/translate_a/single?${params.toString()}`;
    const data = await (await dictFetch("Google Dictionary", url)).json();

    // Which sections a lookup gets varies by language pair, and the richest one
    // is absent more often than not — `result[1]` is null for English→English
    // AND for every non-English source. Reading only it (the shape both
    // reference implementations use) left the panel blank for exactly those
    // cases, so each of the three is tried in turn: target-language glosses
    // first, the source language's own definitions only as a last resort.
    const definitions = firstNonEmpty(
        () => bilingualDefinitions(data?.[1]),
        () => alternativeDefinitions(data?.[5]),
        () => monolingualDefinitions(data?.[12]),
    );
    // Same story for examples: `result[13]` is null on the pairs where the
    // sentences instead ride along on each monolingual definition. Everything
    // the provider gave is kept — the UI does the trimming, so changing how
    // many are shown needs no re-fetch of every cached word.
    const examples = firstNonEmpty(
        () => exampleSection(data?.[13]),
        () => examplesFromDefinitions(data?.[12]),
    );
    if (definitions.length === 0 && examples.length === 0) return null;

    // Google has no IPA and no recordings; `result[0][1][3]` is a
    // romanization, present only when the source is non-Latin. It is the
    // closest thing to a pronunciation on offer, so it is surfaced without an
    // accent claim — the UI falls back to TTS for playback.
    const romanization = data?.[0]?.[1]?.[3];
    const phonetics: DictPhonetic[] = typeof romanization === "string" && romanization
        ? [{ accent: "us", text: romanization }]
        : [];

    return {
        provider: "google",
        word: googleLemma(data, word),
        query: word,
        // `result[2]` — the language Google detected. The only trustworthy
        // answer to "what language is this word", and the reason both
        // providers are queried before anyone decides whose entry to show.
        sourceLang: isText(data?.[2]) ? data[2] : undefined,
        phonetics,
        definitions,
        examples,
    };
}

// ---------------------------------------------------------------------------
// Cache-aware lookup
// ---------------------------------------------------------------------------

function fetchEntry(provider: DictProvider, word: string, targetLang: string): Promise<DictEntry | null> {
    return provider === "microsoft" ? microsoftDict(word) : googleDict(word, targetLang);
}

/**
 * Serve a lookup, preferring the cache.
 *
 * A cached entry is returned even when it is older than the refresh window —
 * the refresh runs behind the answer, so this lookup stays instant and the
 * NEXT one sees the new data. A dictionary changes on a timescale where that
 * is invisible, and the alternative (block the panel on a network round trip
 * every three days) is a worse trade.
 */
export async function lookupDict(
    provider: DictProvider,
    word: string,
    targetLang: string,
): Promise<DictEntry | null> {
    const key = dictCacheKey(provider, targetLang, word);
    const cached = await readDictCache(key);
    // `cached.entry === null` is a negative left by an older build that did
    // cache them (see below) — treated as a miss so those rows age out on
    // their own rather than needing a schema version bump.
    if (cached?.entry) {
        if (Date.now() - cached.fetchedAt > DICT_REFRESH_AFTER_MS) {
            // Fire-and-forget. A failed refresh must not disturb the answer
            // already being returned, and there is no one to report it to —
            // the user asked for a word, not for a cache maintenance job.
            void fetchEntry(provider, word, targetLang)
                .then((fresh) => writeDictCache(key, fresh))
                .catch(() => { /* keep the stale entry */ });
        }
        return cached.entry;
    }
    const entry = await fetchEntry(provider, word, targetLang);
    // Only real entries are stored. "No entry" is NOT cached, even though it is
    // usually a stable answer: entries here never expire, so a cached negative
    // outlives its cause — a provider outage, an anti-bot interstitial, or a
    // parser that stopped matching a redesigned page would each write their
    // failure down permanently and keep the panel blank long after the fix.
    // A word with no entry simply costs one request every time it is selected.
    if (entry) await writeDictCache(key, entry);
    return entry;
}

/** Fetch a pronunciation recording and hand it back as a `data:` URL. */
async function fetchDictAudio(url: string): Promise<string> {
    const r = await dictFetch("Dictionary audio", url);
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    // Chunked: String.fromCharCode(...bytes) blows the argument limit on
    // anything but a very short clip.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const mime = r.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
    return `data:${mime};base64,${btoa(binary)}`;
}

type MessageHandler = (message: any, sendResponse: (r: any) => void) => boolean | void;

export const dictMessageHandlers: Record<string, MessageHandler> = {
    [ACTION.DICT_LOOKUP]: (message, sendResponse) =>
        handleAsync("Dictionary lookup", sendResponse, async () => {
            const { provider, word, targetLang } = (message.data ?? {}) as {
                provider: DictProvider; word: string; targetLang: string;
            };
            return { entry: await lookupDict(provider, word, targetLang) };
        }),

    [ACTION.DICT_AUDIO]: (message, sendResponse) =>
        handleAsync("Dictionary audio", sendResponse, async () => {
            const url = (message.data?.url ?? "") as string;
            // Only the two dictionary hosts, so a compromised page cannot use
            // this handler as a general-purpose CORS-free fetch proxy.
            const host = (() => {
                try { return new URL(url).host; } catch { return ""; }
            })();
            if (!/(^|\.)bing\.com$/.test(host)) throw new Error(`refusing to fetch audio from ${host || url}`);
            return { audios: [await fetchDictAudio(url)] };
        }),
};
