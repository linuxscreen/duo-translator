import { AI_TASK } from "@/main/constants";
import { aiComplete } from "@/main/aiClient";
import type { SubtitleCue, SubtitleWord } from "./types";

/**
 * Sentence segmentation over a timed word stream.
 *
 * Rule-based pass (always available, no network):
 *   - break after sentence-final punctuation (. ! ? 。 ！ ？ …), guarding
 *     against common abbreviations ("Mr.", "U.S.", single initials);
 *   - break on silence gaps (ASR words far apart = a new utterance);
 *   - soft/hard length caps so a run-on ASR transcript still yields
 *     displayable cues (prefer commas / cue ends / the largest gap).
 *
 * AI pass (opt-in): asks the provider to insert a marker between sentences in
 * the exact same text, then maps marker offsets back onto word boundaries.
 * Any mismatch (model rewrote the text) throws and the caller falls back to
 * the rule-based result.
 *
 * The AI pass works ONE CHUNK AT A TIME ({@link nextAiChunkEnd} +
 * {@link segmentChunkWithAi}) and is driven by the playhead — see the
 * segmentation section of the controller. Segmenting a whole track up front
 * meant a long stall before the first subtitle and a full transcript's worth of
 * tokens spent on a video the user might drop after ten seconds.
 */

const GAP_BREAK_MS = 1800;
/** Prefer breaking once a sentence exceeds this many characters. */
const SOFT_MAX_CHARS = 90;
/** Never let a cue exceed this many characters. */
const HARD_MAX_CHARS = 170;

const TERMINAL_PUNCT_RE = /[.!?。！？…][)"'”’」』\]]*$/;
const CLAUSE_PUNCT_RE = /[,;:，；：、][)"'”’」』\]]*$/;
// "Mr." / "U.S." / "Dr." style tokens that end with a period but do not end a
// sentence. Single uppercase letter + period is an initial ("J. Smith").
const ABBREV_RE = /(?:^|\s)(?:[A-Z]\.|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|St\.|Jr\.|Sr\.|vs\.|etc\.|e\.g\.|i\.e\.|U\.S\.|U\.K\.|No\.)$/i;

const CJK_RE = /[⺀-鿿豈-﫿ｦ-ﾟ가-힯]/;

function isCjkEdge(a: string, b: string): boolean {
    if (!a || !b) return false;
    return CJK_RE.test(a[a.length - 1]) || CJK_RE.test(b[0]);
}

/** Join word texts, adding spaces only where the writing system wants them. */
export function joinWords(words: readonly { text: string }[]): string {
    let out = "";
    for (const w of words) {
        const t = w.text;
        if (!t) continue;
        if (out === "" || isCjkEdge(out, t)) out += t;
        else out += " " + t;
    }
    return out;
}

function endsSentence(text: string): boolean {
    if (!TERMINAL_PUNCT_RE.test(text)) return false;
    if (ABBREV_RE.test(text)) return false;
    return true;
}

interface Pending {
    words: SubtitleWord[];
    chars: number;
    /** Index in `words` of the best mid-sentence break candidate. */
    softBreakIdx: number;
    softBreakScore: number;
}

function flush(pending: Pending, out: SubtitleCue[], upTo?: number): void {
    const take = upTo === undefined ? pending.words.length : upTo + 1;
    if (take <= 0) return;
    const words = pending.words.slice(0, take);
    const text = joinWords(words).trim();
    if (text !== "") {
        out.push({
            startMs: words[0].startMs,
            endMs: words[words.length - 1].endMs,
            text,
        });
    }
    pending.words = pending.words.slice(take);
    pending.chars = joinWords(pending.words).length;
    pending.softBreakIdx = -1;
    pending.softBreakScore = 0;
}

/** Rule-based sentence segmentation. Pure and synchronous. */
export function segmentWords(wordsIn: readonly SubtitleWord[]): SubtitleCue[] {
    const out: SubtitleCue[] = [];
    const pending: Pending = { words: [], chars: 0, softBreakIdx: -1, softBreakScore: 0 };

    const words = wordsIn.filter((w) => w.text.trim() !== "");
    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        pending.words.push(w);
        pending.chars += w.text.length + 1;

        const next = words[i + 1];
        const gap = next ? next.startMs - w.endMs : 0;

        // Hard sentence end: terminal punctuation, or a long silence gap.
        if (endsSentence(w.text) || (next && gap >= GAP_BREAK_MS)) {
            flush(pending, out);
            continue;
        }

        // Track the best mid-sentence break candidate for the length caps:
        // clause punctuation > source cue end > the largest time gap.
        const idx = pending.words.length - 1;
        let score = 0;
        if (CLAUSE_PUNCT_RE.test(w.text)) score = 3000 + Math.min(gap, 999);
        else if (w.cueEnd) score = 2000 + Math.min(gap, 999);
        else if (gap > 0) score = Math.min(gap, 1999);
        if (score >= pending.softBreakScore) {
            pending.softBreakScore = score;
            pending.softBreakIdx = idx;
        }

        if (pending.chars >= HARD_MAX_CHARS) {
            flush(pending, out, pending.softBreakIdx >= 0 ? pending.softBreakIdx : idx);
        } else if (pending.chars >= SOFT_MAX_CHARS && pending.softBreakScore >= 2000) {
            // Soft cap: only break at a good candidate (punctuation / cue end).
            flush(pending, out, pending.softBreakIdx);
        }
    }
    flush(pending, out);
    return out;
}

// ---------------------------------------------------------------------------
// AI segmentation
// ---------------------------------------------------------------------------

const AI_MARKER = "‖";

/**
 * Caps on ONE AI request. Deliberately small: a chunk is only asked for shortly
 * before it is needed, so the caps decide request latency (a subtitle gap if
 * the answer is late) and how many tokens are wasted when the user seeks away
 * or stops watching. Whichever cap is hit first ends the chunk.
 */
const AI_CHUNK_MAX_CHARS = 600;
const AI_CHUNK_MAX_WORDS = 120;
const AI_CHUNK_MAX_MS = 30_000;
/** Below this a chunk is too small to be worth cutting at a silence gap. */
const AI_CHUNK_MIN_CHARS = 200;
/** Silence long enough to be a natural chunk edge. */
const AI_CHUNK_GAP_MS = 400;

const AI_SEGMENT_PROMPT =
    "You are a subtitle sentence segmenter. The user sends transcript text with no reliable sentence breaks. " +
    `Insert the character ${AI_MARKER} between sentences. Do NOT change, add, remove, or reorder any other character — ` +
    `the output must be exactly the input text with ${AI_MARKER} characters inserted at sentence boundaries. ` +
    "Do not add punctuation. Output only the marked text.";

/**
 * Map the AI's marked text back onto word boundaries.
 * Returns break positions as "sentence ends after word index i".
 * Throws when the marked text does not reproduce the source text.
 */
export function alignMarkedText(words: readonly SubtitleWord[], marked: string): Set<number> {
    const source = joinWords(words);
    // Char-prefix lengths: boundaryAfter[i] = length of joinWords(words[0..i]).
    const boundaryAfter: number[] = [];
    {
        let acc = "";
        for (const w of words) {
            if (acc === "" || isCjkEdge(acc, w.text)) acc += w.text;
            else acc += " " + w.text;
            boundaryAfter.push(acc.length);
        }
    }

    const breaks = new Set<number>();
    // Walk both strings, skipping markers and tolerating whitespace-only
    // differences around them (models often put the marker instead of a space).
    let si = 0;
    for (let mi = 0; mi < marked.length; mi++) {
        const c = marked[mi];
        if (c === AI_MARKER) {
            // Marker at char offset `si` of the source → snap to the nearest
            // word boundary at or before si.
            let idx = -1;
            for (let k = 0; k < boundaryAfter.length; k++) {
                if (boundaryAfter[k] <= si + 1) idx = k;
                else break;
            }
            if (idx >= 0 && idx < words.length - 1) breaks.add(idx);
            continue;
        }
        if (/\s/.test(c)) {
            // Consume any whitespace on the source side too.
            while (si < source.length && /\s/.test(source[si])) si++;
            continue;
        }
        while (si < source.length && /\s/.test(source[si])) si++;
        if (source[si] !== c) {
            throw new Error("AI segmentation output diverged from source text");
        }
        si++;
    }
    // Require the model to have covered (almost) the whole chunk.
    while (si < source.length && /\s/.test(source[si])) si++;
    if (si < source.length * 0.95) {
        throw new Error("AI segmentation output truncated");
    }
    return breaks;
}

/**
 * Non-streaming on purpose: the marked text is worthless until it is complete
 * (it has to be aligned against the source in one piece), so streaming would
 * only add a port and one message per delta. Going through `aiComplete` also
 * gets thinking disabled where the provider supports it — this task is
 * mechanical, and reasoning tokens on it are pure cost and latency.
 */
async function aiMarkChunk(text: string, providerId: string | undefined, signal: AbortSignal): Promise<string> {
    return aiComplete(
        {
            task: AI_TASK.CUSTOM,
            providerId,
            payload: { text, systemPrompt: AI_SEGMENT_PROMPT },
        },
        signal,
    );
}

/**
 * Index of the first word still to be spoken at time `t` — where segmentation
 * should (re)start after a seek.
 */
export function wordIndexAtTime(words: readonly SubtitleWord[], t: number): number {
    let lo = 0, hi = words.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (words[mid].endMs > t) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

/**
 * End index (exclusive) of the next chunk to hand to the AI, starting at
 * `from`. Cuts at the last silence gap inside the caps when there is one, so
 * chunk edges fall between utterances rather than mid-sentence (a chunk edge is
 * always a sentence edge — the model never sees across it).
 */
export function nextAiChunkEnd(words: readonly SubtitleWord[], from: number): number {
    if (from >= words.length) return from;
    const startMs = words[from].startMs;
    let chars = 0;
    let gapEnd = -1;
    for (let i = from; i < words.length; i++) {
        chars += words[i].text.length + 1;
        const next = words[i + 1];
        if (!next) return words.length;
        if (chars >= AI_CHUNK_MIN_CHARS && next.startMs - words[i].endMs >= AI_CHUNK_GAP_MS) {
            gapEnd = i + 1;
        }
        const full =
            chars >= AI_CHUNK_MAX_CHARS ||
            i - from + 1 >= AI_CHUNK_MAX_WORDS ||
            words[i].endMs - startMs >= AI_CHUNK_MAX_MS;
        if (full) return gapEnd > from ? gapEnd : i + 1;
    }
    return words.length;
}

/**
 * AI-segment ONE chunk (see {@link nextAiChunkEnd} for how to size it). Throws
 * on any alignment/provider failure — the caller falls back to
 * {@link segmentWords} for this chunk.
 */
export async function segmentChunkWithAi(
    chunk: readonly SubtitleWord[],
    providerId: string | undefined,
    signal: AbortSignal,
): Promise<SubtitleCue[]> {
    const words = chunk.filter((w) => w.text.trim() !== "");
    if (words.length === 0) return [];
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const marked = await aiMarkChunk(joinWords(words), providerId, signal);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const breaks = alignMarkedText(words, marked);

    const cues: SubtitleCue[] = [];
    let sentence: SubtitleWord[] = [];
    for (let i = 0; i < words.length; i++) {
        sentence.push(words[i]);
        if (breaks.has(i) || i === words.length - 1) {
            const text = joinWords(sentence).trim();
            if (text !== "") {
                cues.push({
                    startMs: sentence[0].startMs,
                    endMs: sentence[sentence.length - 1].endMs,
                    text,
                });
            }
            sentence = [];
        }
    }
    return cues;
}
