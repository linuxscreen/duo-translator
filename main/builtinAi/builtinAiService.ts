// ---------------------------------------------------------------------------
// Built-in AI (on-device Translator / LanguageDetector) — BACKGROUND ONLY.
//
// Same rule as every other provider in main/translateService.ts: the model call
// lives in background, content asks by meaning. No offscreen document, no
// content-side model access.
//
// TWO MEASURED FACTS THIS FILE DEPENDS ON — both contradict what the public
// docs imply, so do not "fix" the code back to match them:
//
//  1. The `Translator` / `LanguageDetector` globals ARE exposed in an MV3
//     extension service worker. Chrome's docs say the API "isn't available in
//     Web Workers", which is true of a `new Worker()` — a dedicated worker
//     spawned from a page really does see `undefined` — but an extension
//     service worker is not that, and reports `typeof Translator === "function"`.
//
//  2. `Translator.create()` starts a model download from the service worker
//     with NO user activation. The `NotAllowedError: Requires a user gesture
//     when availability is "downloading" or "downloadable"` that a *web page*
//     gets does not apply here. Measured: 46 downloadprogress events, 68% in
//     four seconds, from a background worker with no gesture in sight.
//
// Together those are why the model download is silent and automatic: nothing
// needs a click, and the page only ever shows progress.
// ---------------------------------------------------------------------------

import { ACTION, APP_NAME_WITH_SUFFIX } from "@/main/constants";
import { browser } from "wxt/browser";
import { builtinAiApiAvailable } from "./capability";
import {
    hasPlaceholders,
    placeholdersPreserved,
    sameLanguage,
    stripPlaceholders,
    toModelLang,
} from "./placeholders";
import {
    BUILTIN_AI_MODEL_DOWNLOADING,
    type BuiltinAiAvailability,
    type BuiltinAiCancelDownloadRequest,
    type BuiltinAiDownloadProgress,
    type BuiltinAiModelDownloadingDetail,
    type BuiltinAiTranslateResult,
    type LanguageDetectorSession,
    type TranslatorSession,
} from "./types";

/**
 * How many texts to run through the model at once.
 *
 * `translate()` takes ONE string — there is no batch API — so a paragraph batch
 * of 50 becomes 50 calls. Unbounded parallelism drives the on-device model
 * process into the generic-failure state below; fully serial is needlessly slow.
 */
const MAX_CONCURRENCY = 4;

/** Characters of a batch to sample when detecting its source language. */
const DETECT_SAMPLE_CHARS = 2000;

/** Below this the detector's answer is noise; treat it as "no idea". */
const DETECT_MIN_CONFIDENCE = 0.4;

/** Minimum gap between progress broadcasts. The event fires ~12×/second. */
const PROGRESS_THROTTLE_MS = 250;

/**
 * How long `create()` may report nothing at all before we say so.
 *
 * MEASURED: the browser's model downloader can accept a `create()` and then do
 * nothing — no progress event, no rejection, indefinitely. Seen after a burst of
 * downloads and aborts, and it is NOT specific to the pair that was aborted: a
 * pair never touched before stalled the same way in the same window, so this is
 * the component updater backing off globally rather than anything about one
 * model. It clears on its own after a while.
 *
 * Without this the bar sits at "0%" forever, which is the exact silent-nothing
 * the progress UI exists to replace. Generous, because a slow link legitimately
 * takes a while to produce a first byte and a false alarm here is worse than a
 * late one.
 */
const DOWNLOAD_STALL_MS = 60_000;

/**
 * The on-device model process can die and take every open session with it,
 * after which each one rejects with this message forever. Dropping the cache on
 * sight is the only recovery: the next request re-creates sessions against a
 * fresh process. Borrowed from kiss-translator's builtinAI.js, where this
 * failure mode was first characterised.
 */
const GENERIC_FAILURE = "Other generic failures occurred";

let detectorPromise: Promise<LanguageDetectorSession> | null = null;
/** In-flight detector-model download, so concurrent batches share one. */
let detectorDownload: Promise<void> | null = null;
/**
 * Last confident detection, reused when a later sample is inconclusive.
 *
 * Detection runs per BATCH, and batches are whatever the IntersectionObserver
 * happened to group — often a single short paragraph (a nav label, a byline, a
 * date). Those score below the confidence floor, which used to fail the batch
 * outright with "could not determine the source language" even though the rest
 * of the page had already been detected confidently many times over.
 *
 * A page is overwhelmingly one language, so the previous confident answer is a
 * far better guess than an error. Only ever consulted when the detector is
 * *unsure* — a confident answer always wins, so a genuinely different-language
 * page is still detected correctly. (Same trick as kiss-translator's
 * `#lastReliableDetectedLanguage`.)
 */
let lastReliableSourceLang = "";
/** Ready-to-use sessions, keyed `${source}_${target}`. */
const translators = new Map<string, Promise<TranslatorSession>>();
/** In-flight model downloads, keyed the same way, so N batches share one. */
const downloads = new Map<string, Promise<void>>();
/**
 * When a pair's download last failed. `getTranslator` runs once per paragraph
 * batch, and the latch below only dedupes downloads that are still running — so
 * without this, a pair that reliably fails (no disk space, component server
 * down) would kick off a fresh download attempt for every batch on the page.
 */
const downloadFailedAt = new Map<string, number>();
const DOWNLOAD_RETRY_COOLDOWN_MS = 60_000;

/** Abort handles for downloads in flight, keyed like {@link downloads}. */
const downloadAborts = new Map<string, AbortController>();
let detectorAbort: AbortController | null = null;

/**
 * Pairs the user cancelled, plus the detector's own flag.
 *
 * Aborting the in-flight `create()` is only half a cancel. The download is
 * AUTOMATIC — every batch that finds a missing model kicks one off — so without
 * a latch the very next paragraph to scroll into view would restart what the
 * user just stopped, and the progress bar would pop back up a second later.
 *
 * Deliberately in memory and not persisted: cancelling means "not now", not
 * "never". It therefore also evaporates when the service worker is recycled,
 * which is the behaviour we want — a latch that outlived the browsing session
 * would turn one impatient click into a permanently broken translator with no
 * visible cause. The explicit ways back in are {@link ensureModel} (the Options
 * download button), the Options connectivity test, and manually re-triggering a
 * page translation — all of which route through {@link clearDownloadCancel}.
 */
const cancelledPairs = new Set<string>();
let detectorCancelled = false;

/** Re-exported so background callers have one import for the whole feature. */
export const builtinAiSupported = builtinAiApiAvailable;

function requireSupport(): void {
    if (!builtinAiSupported()) {
        throw new Error(
            "Built-in AI is not available in this browser. It needs Chrome 138+ or Edge 148+ on desktop.",
        );
    }
}

export function translatorAvailability(
    sourceLanguage: string,
    targetLanguage: string,
): Promise<BuiltinAiAvailability> {
    requireSupport();
    return Translator.availability({ sourceLanguage, targetLanguage });
}

export async function detectorAvailability(): Promise<BuiltinAiAvailability> {
    requireSupport();
    return await LanguageDetector.availability();
}

// ---------------------------------------------------------------------------
// Progress broadcast
// ---------------------------------------------------------------------------

/**
 * Tell every page (and any open extension page) how the download is going.
 *
 * Fire-and-forget on purpose: a tab with no content script, or an Options page
 * that is not open, rejects with "Could not establish connection", and that is
 * a normal outcome rather than a failure worth surfacing.
 */
function broadcastProgress(progress: BuiltinAiDownloadProgress): void {
    const message = { action: ACTION.BUILTIN_AI_DOWNLOAD_PROGRESS, data: progress };
    void (async () => {
        try {
            const tabs = await browser.tabs.query({});
            for (const tab of tabs) {
                if (tab.id === undefined) continue;
                // No frameId — every frame needs this: the top frame draws the
                // notice, and each frame re-runs its own translation when the
                // model lands.
                void browser.tabs.sendMessage(tab.id, message).catch(() => { });
            }
        } catch { /* tabs.query can fail during shutdown; nothing to do */ }
        // Extension pages (the Options model dialog) listen on runtime, not tabs.
        void browser.runtime.sendMessage(message).catch(() => { });
    })();
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

function isAbortError(e: any): boolean {
    return e?.name === "AbortError";
}

/**
 * Lift the cancel latch. Call from paths that represent the user explicitly
 * asking for the model again — never from an automatic one, or cancelling
 * would not survive its own page.
 */
export function clearDownloadCancel(sourceLanguage?: string, targetLanguage?: string): void {
    detectorCancelled = false;
    if (sourceLanguage && targetLanguage) cancelledPairs.delete(`${sourceLanguage}_${targetLanguage}`);
    else cancelledPairs.clear();
}

/**
 * Stop a download the user is watching.
 *
 * MEASURED LIMIT — do not describe this as stopping the download. Aborting the
 * signal rejects `create()` with AbortError and releases our session, but the
 * browser's own model fetch carries on: a pair aborted at 0% (one progress
 * event) still reported `availability: "available"` about four seconds later.
 * The bytes belong to Chrome's component updater, which exposes no extension
 * API to cancel — so what this really cancels is the extension's part: the
 * progress reporting, the page waiting on it, and (via the latch) any automatic
 * restart. If the model does land anyway, `getTranslator` checks availability
 * before the latch and simply uses it, which is the right outcome — the user
 * asked us to stop pestering them, not to refuse a model that is already there.
 */
export function cancelDownload(request: BuiltinAiCancelDownloadRequest): void {
    if (request?.kind === "detector") {
        detectorCancelled = true;
        detectorAbort?.abort();
        detectorAbort = null;
        detectorDownload = null;
        broadcastProgress({ kind: "detector", sourceLang: "", targetLang: "", percent: 0, done: true, cancelled: true });
        return;
    }
    const sourceLanguage = request?.sourceLang || "";
    const targetLanguage = request?.targetLang || "";
    if (!sourceLanguage || !targetLanguage) return;
    const key = `${sourceLanguage}_${targetLanguage}`;
    cancelledPairs.add(key);
    downloadAborts.get(key)?.abort();
    downloadAborts.delete(key);
    // Drop the latch entry now rather than waiting for the aborted promise to
    // settle: an `ensureModel` in that window would otherwise join the promise
    // that is on its way to rejecting with AbortError and report *that* as the
    // outcome of a download the user just asked to restart.
    downloads.delete(key);
    broadcastProgress({
        kind: "translator",
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
        percent: 0,
        done: true,
        cancelled: true,
    });
}

/**
 * Download the model for a language pair, broadcasting progress.
 *
 * Latched per pair: a page translation fires many batches at once and they must
 * all join ONE download rather than starting a race of identical ones.
 */
export function ensureModel(sourceLanguage: string, targetLanguage: string): Promise<void> {
    requireSupport();
    const key = `${sourceLanguage}_${targetLanguage}`;
    // Reaching here at all means somebody asked for this model on purpose:
    // `getTranslator` refuses to auto-start a cancelled pair before it ever
    // calls in. So an explicit request is exactly what lifts the latch.
    clearDownloadCancel(sourceLanguage, targetLanguage);
    const running = downloads.get(key);
    if (running) return running;

    const failedAt = downloadFailedAt.get(key);
    if (failedAt !== undefined && Date.now() - failedAt < DOWNLOAD_RETRY_COOLDOWN_MS) {
        return Promise.reject(new Error(
            `Built-in AI: the ${sourceLanguage} → ${targetLanguage} model failed to download recently.`,
        ));
    }

    const aborter = new AbortController();
    downloadAborts.set(key, aborter);

    const pending = (async () => {
        const availability = await Translator.availability({ sourceLanguage, targetLanguage });
        if (availability === "available") return;
        if (availability === "unavailable") {
            throw new Error(
                `Built-in AI has no on-device model for ${sourceLanguage} → ${targetLanguage}.`,
            );
        }

        broadcastProgress({ kind: "translator", sourceLang: sourceLanguage, targetLang: targetLanguage, percent: 0, done: false });
        let lastEmit = 0;
        let sawProgress = false;
        const stallTimer = setTimeout(() => {
            if (sawProgress) return;
            // Deliberately does NOT abort: the download may still start, and
            // letting it run means the session lands in the cache for free. It
            // does drop the shared latch, so a retry gets its own `create()`
            // instead of joining this one and inheriting its silence.
            if (downloads.get(key) === pending) downloads.delete(key);
            broadcastProgress({
                kind: "translator", sourceLang: sourceLanguage, targetLang: targetLanguage,
                percent: 0, done: true,
                error: `Built-in AI: the browser has not started downloading the ${sourceLanguage} → ${targetLanguage} model. It usually sorts itself out after a minute — try again then.`,
            });
        }, DOWNLOAD_STALL_MS);

        // No user gesture needed here — see the header note. `create()` IS the
        // download trigger; there is no separate download API.
        const session = await Translator.create({
            sourceLanguage,
            targetLanguage,
            signal: aborter.signal,
            monitor: (m) =>
                m.addEventListener("downloadprogress", (e) => {
                    sawProgress = true;
                    clearTimeout(stallTimer);
                    // A cancel can land between two progress events, and the
                    // monitor keeps firing until `create()` actually settles.
                    // Reporting through that gap would redraw the bar the user
                    // just closed.
                    if (aborter.signal.aborted) return;
                    const percent = e.total > 0 ? Math.round((e.loaded / e.total) * 100) : 0;
                    const now = Date.now();
                    // Throttle: the event fires ~12×/second and each broadcast
                    // is a message to every frame of every tab.
                    if (percent < 100 && now - lastEmit < PROGRESS_THROTTLE_MS) return;
                    lastEmit = now;
                    broadcastProgress({ kind: "translator", sourceLang: sourceLanguage, targetLang: targetLanguage, percent, done: false });
                }),
        }).finally(() => clearTimeout(stallTimer));

        // Keep the freshly built session — it is exactly what the next
        // translate call needs, and creating a second one would reload the
        // model into memory for nothing.
        translators.set(key, Promise.resolve(session));
        downloadFailedAt.delete(key);
        broadcastProgress({ kind: "translator", sourceLang: sourceLanguage, targetLang: targetLanguage, percent: 100, done: true });
    })();

    downloads.set(key, pending);
    void pending.catch((e: any) => {
        // A cancel is not a failure: it must not enter the retry cooldown (the
        // user may well ask again in the next second) and it must not paint the
        // error treatment — `cancelDownload` already broadcast the final word.
        if (isAbortError(e) || aborter.signal.aborted) {
            console.log(APP_NAME_WITH_SUFFIX, `built-in AI model download cancelled (${key})`);
            return;
        }
        downloadFailedAt.set(key, Date.now());
        console.log(APP_NAME_WITH_SUFFIX, `built-in AI model download failed (${key}):`, e?.message || e);
        broadcastProgress({
            kind: "translator",
            sourceLang: sourceLanguage,
            targetLang: targetLanguage,
            percent: 0,
            done: true,
            error: e?.message || String(e),
        });
    }).finally(() => {
        // Always clear the latch: a failed download must stay retryable. By
        // identity, because a cancel can have dropped this entry and a fresh
        // download taken its place — an unconditional delete would evict the
        // replacement and let a second one start alongside it.
        if (downloads.get(key) === pending) downloads.delete(key);
        if (downloadAborts.get(key) === aborter) downloadAborts.delete(key);
    });

    return pending;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function resetSessions(): void {
    console.warn(APP_NAME_WITH_SUFFIX, "built-in AI: generic model failure, resetting sessions");
    for (const pending of translators.values()) {
        void pending.then((t) => t.destroy()).catch(() => { });
    }
    translators.clear();
    void detectorPromise?.then((d) => d.destroy()).catch(() => { });
    detectorPromise = null;
}

function isGenericFailure(e: any): boolean {
    return typeof e?.message === "string" && e.message.includes(GENERIC_FAILURE);
}

/**
 * A plain error, NOT the `BUILTIN_AI_MODEL_DOWNLOADING` signal.
 *
 * That difference is the whole point: the signal tells the page "wait and try
 * again", which is exactly what a cancelled download must stop it doing. As an
 * ordinary error it bubbles once (identical reasons merge), the retry loop
 * never starts, and the text says where the "actually, do download it" button
 * lives.
 */
function cancelledError(what: string): Error {
    return new Error(
        `Built-in AI: the ${what} download was cancelled. ` +
        `Translate the page again, or open Settings › Services › Built-in AI, to download it.`,
    );
}

/**
 * Download the detector model, broadcasting progress. Latched like the
 * translator's, so concurrent batches share one download.
 */
function ensureDetector(): Promise<void> {
    if (detectorDownload) return detectorDownload;

    const label = { kind: "detector" as const, sourceLang: "", targetLang: "" };
    const aborter = new AbortController();
    detectorAbort = aborter;
    const pendingDetector = (async () => {
        broadcastProgress({ ...label, percent: 0, done: false });
        let lastEmit = 0;
        const session = await LanguageDetector.create({
            signal: aborter.signal,
            monitor: (m) =>
                m.addEventListener("downloadprogress", (e) => {
                    if (aborter.signal.aborted) return;
                    const percent = e.total > 0 ? Math.round((e.loaded / e.total) * 100) : 0;
                    const now = Date.now();
                    if (percent < 100 && now - lastEmit < PROGRESS_THROTTLE_MS) return;
                    lastEmit = now;
                    broadcastProgress({ ...label, percent, done: false });
                }),
        });
        detectorPromise = Promise.resolve(session);
        broadcastProgress({ ...label, percent: 100, done: true });
    })();

    detectorDownload = pendingDetector;
    void pendingDetector.catch((e: any) => {
        if (isAbortError(e) || aborter.signal.aborted) {
            console.log(APP_NAME_WITH_SUFFIX, "built-in AI detector download cancelled");
            return;
        }
        console.log(APP_NAME_WITH_SUFFIX, "built-in AI detector download failed:", e?.message || e);
        broadcastProgress({ ...label, percent: 0, done: true, error: e?.message || String(e) });
    }).finally(() => {
        if (detectorDownload === pendingDetector) detectorDownload = null;
        if (detectorAbort === aborter) detectorAbort = null;
    });

    return pendingDetector;
}

function getDetector(): Promise<LanguageDetectorSession> {
    if (!detectorPromise) {
        detectorPromise = (async () => {
            const availability = await LanguageDetector.availability();
            if (availability === "unavailable") {
                throw new Error("Built-in AI: the on-device language detector is unavailable");
            }
            if (availability !== "available") {
                if (detectorCancelled) throw cancelledError("language detector");
                // Do NOT await the download here. This runs on the very first
                // batch of the very first page, and awaiting would hold the
                // content-side request open until it either finished or hit its
                // timeout — a first-use hang with no explanation. Same treatment
                // as a missing translator model: start it, bail out, let the
                // page show progress and retry.
                void ensureDetector().catch(() => { });
                const error: any = new Error("Built-in AI is downloading the language detector.");
                error.name = BUILTIN_AI_MODEL_DOWNLOADING;
                error.detail = { sourceLang: "", targetLang: "" } satisfies BuiltinAiModelDownloadingDetail;
                throw error;
            }
            return await LanguageDetector.create();
        })().catch((e) => {
            detectorPromise = null; // don't poison every later call
            throw e;
        });
    }
    return detectorPromise;
}

/**
 * Get a ready session, or start the download and bail out.
 *
 * Bailing rather than awaiting is deliberate. The content-side request has a
 * timeout, and a first-time model download on a slow link can exceed any
 * sensible one — awaiting here would turn a working download into a timed-out
 * translation. Instead the caller throws {@link BUILTIN_AI_MODEL_DOWNLOADING},
 * the page shows progress, and it re-runs the translation when the broadcast
 * says the model is ready.
 */
function getTranslator(sourceLanguage: string, targetLanguage: string): Promise<TranslatorSession> {
    const key = `${sourceLanguage}_${targetLanguage}`;
    const cached = translators.get(key);
    if (cached) return cached;

    const pending = (async () => {
        const availability = await Translator.availability({ sourceLanguage, targetLanguage });
        if (availability === "unavailable") {
            throw new Error(
                `Built-in AI has no on-device model for ${sourceLanguage} → ${targetLanguage}.`,
            );
        }
        if (availability !== "available") {
            if (cancelledPairs.has(key)) throw cancelledError(`${sourceLanguage} → ${targetLanguage} model`);
            // Fire-and-forget, but the rejection MUST be absorbed: ensureModel
            // rejects both on a real download failure and immediately while a
            // recent failure is in cooldown, and neither is this caller's to
            // report — it is about to throw the "downloading" signal instead,
            // and the failure already reached the page via broadcastProgress.
            void ensureModel(sourceLanguage, targetLanguage).catch(() => { });
            const error: any = new Error(
                `Built-in AI is downloading the ${sourceLanguage} → ${targetLanguage} model.`,
            );
            error.name = BUILTIN_AI_MODEL_DOWNLOADING;
            error.detail = {
                sourceLang: sourceLanguage,
                targetLang: targetLanguage,
            } satisfies BuiltinAiModelDownloadingDetail;
            throw error;
        }
        return await Translator.create({ sourceLanguage, targetLanguage });
    })().catch((e) => {
        translators.delete(key); // never cache a rejected session
        throw e;
    });

    translators.set(key, pending);
    return pending;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapWithLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (cursor < items.length) {
            const index = cursor++;
            out[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * Detect a batch's language.
 *
 * Samples across the whole batch rather than trusting the first entry: a page's
 * first paragraph is often a nav label or a byline, which the detector reads as
 * whatever that fragment resembles. Placeholders are stripped first — they are
 * ASCII noise that skews a short sample toward English.
 */
export async function detectBatchLanguage(texts: string[]): Promise<string> {
    requireSupport();
    const sample = texts.map(stripPlaceholders).join("\n").slice(0, DETECT_SAMPLE_CHARS).trim();
    if (!sample) return lastReliableSourceLang;

    const detector = await getDetector();
    const results = await detector.detect(sample);
    const top = results?.[0];
    if (top && top.confidence >= DETECT_MIN_CONFIDENCE) {
        lastReliableSourceLang = top.detectedLanguage;
        return top.detectedLanguage;
    }
    // Unsure. A short batch is the normal reason, so fall back to whatever this
    // page's longer batches already established rather than failing it.
    if (lastReliableSourceLang) {
        console.log(
            APP_NAME_WITH_SUFFIX,
            `built-in AI: inconclusive detection (${top?.detectedLanguage ?? "none"} ` +
            `${top?.confidence?.toFixed(2) ?? "-"}), reusing ${lastReliableSourceLang}`,
        );
        return lastReliableSourceLang;
    }
    return "";
}

async function translateBatch(
    texts: string[],
    targetLang: string,
    sourceLang?: string,
): Promise<BuiltinAiTranslateResult> {
    requireSupport();
    if (texts.length === 0) return { texts: [], sourceLang: "", plainTextFallback: false };

    const targetLanguage = toModelLang(targetLang);
    const detected = sourceLang ? toModelLang(sourceLang) : await detectBatchLanguage(texts);
    if (!detected) {
        throw new Error("Built-in AI could not determine the source language of this text.");
    }
    // The model rejects same-language pairs, and the pipeline already drops
    // results identical to their source, so hand the input straight back.
    if (sameLanguage(detected, targetLanguage)) {
        return { texts, sourceLang: detected, plainTextFallback: false, sameLanguage: true };
    }

    const translator = await getTranslator(detected, targetLanguage);

    let plainTextFallback = false;
    const out = await mapWithLimit(texts, MAX_CONCURRENCY, async (text) => {
        const translated = await translator.translate(text);
        // Verify the `<bN>` round-trip. A plain-text model may drop, merge or
        // renumber them; writing that back would scatter text into the wrong
        // inline elements, or leave a literal "<b0>" on the page.
        if (!hasPlaceholders(text) || placeholdersPreserved(text, translated)) return translated;
        plainTextFallback = true;
        // Retry without markup. The result has no placeholders, so the
        // write-back lands it as flat text: invisible in DOUBLE (bilingual)
        // mode, where the translation is its own block, and a flattening of
        // that one paragraph's inline markup in SINGLE mode.
        return await translator.translate(stripPlaceholders(text));
    });

    return { texts: out, sourceLang: detected, plainTextFallback };
}

/** Public entry: translate a batch, recovering once from a model-process crash. */
export async function builtinAiTranslateTexts(
    texts: string[],
    targetLang: string,
    sourceLang?: string,
): Promise<BuiltinAiTranslateResult> {
    try {
        return await translateBatch(texts, targetLang, sourceLang);
    } catch (e) {
        if (!isGenericFailure(e)) throw e;
        resetSessions();
        // One retry against fresh sessions. A second failure is real and must
        // reach the user.
        return await translateBatch(texts, targetLang, sourceLang);
    }
}
