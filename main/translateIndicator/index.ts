// ---------------------------------------------------------------------------
// Translating indicator — controller (CONTENT SIDE, every frame).
//
// What the page shows while a paragraph batch is in flight, and what it shows
// when that batch fails. Three variants, one setting
// (CONFIG_KEY.TRANSLATING_ANIMATION):
//
//   - inlineDots / inlineSpinner — one marker per logical paragraph unit, at the
//     spot the translation is about to occupy (./inline.ts). On failure the
//     marker becomes a details + retry pair, and retry re-runs that one unit.
//   - cornerSpinner — a single viewport-anchored pill for the whole tab
//     (./corner.tsx), whose retry re-runs everything that failed.
//   - none — nothing at all, and failures keep going to the page error bubble
//     exactly as before.
//
// The indicator does not just *decorate* a failure, it OWNS it: whenever it is
// enabled, main/content.ts reports page/paragraph translation errors with
// `silent: true` so the page-level bubble does not double up on it. That is why
// every path here that drops a batch is careful never to drop it without a way
// for the user to see why it failed — the bubble is no longer behind us as a
// backstop. The reason itself is shown ANCHORED TO THE BUTTON that asks for it
// (./errorPopover.tsx), not at the top of the page: the user is looking at the
// paragraph they just clicked.
// ---------------------------------------------------------------------------

import { ACTION, APP_NAME_WITH_SUFFIX, TRANSLATING_ANIMATION } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";
import type { TranslationUnit } from "@/main/dom/segments";
import { mountInlineIndicator, removeInlineIndicator, renderInlineError, type InlineVariant } from "./inline";
import type { CornerIndicatorState, FrameIndicatorState, IndicatorFailure } from "./types";

export type { IndicatorFailure } from "./types";

/**
 * A sub-frame's state is dropped from the fold once it goes this long without
 * an update — but only its `pending`, never its `failed`.
 *
 * An iframe can be removed or navigated mid-request, and its in-flight batch
 * then never settles: without this the spinner would turn forever. A *failure*
 * has no such excuse to expire — the whole point of this feature is that a
 * failed translation stays visible until the user does something about it.
 */
const FRAME_PENDING_TTL_MS = 60_000;

const isTopFrame = (): boolean => {
    try {
        return window.top === window.self;
    } catch {
        // Cross-origin access throws, which only happens in a sub-frame.
        return false;
    }
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mode: TRANSLATING_ANIMATION = TRANSLATING_ANIMATION.NONE;

interface InlineEntry {
    unit: TranslationUnit;
    el: HTMLElement;
}

interface Batch {
    /**
     * The mode this batch was started under. A batch lives out its life in it
     * even if the setting changes mid-request: markers already in the page
     * belong to the old mode, and re-homing a half-finished batch would either
     * lose its failure or show it twice.
     */
    mode: TRANSLATING_ANIMATION;
    units: TranslationUnit[];
    inline: InlineEntry[];
    retry: (units: TranslationUnit[]) => void;
    failure: IndicatorFailure | null;
}

/** Batches that are in flight (failure === null) or have failed. */
const batches = new Set<Batch>();

/**
 * Per-frame state for the corner surface, folded by the top frame. Key is the
 * frame id background stamps on the relay; the top frame's own entry is 0.
 */
const frameStates = new Map<number, FrameIndicatorState & { at: number }>();

export interface TranslateIndicatorSession {
    /** The batch finished, or was aborted — nothing to report either way. */
    done(): void;
    /** The batch failed. */
    fail(failure: IndicatorFailure): void;
}

/**
 * Is an indicator responsible for surfacing translation failures right now?
 * main/content.ts asks before reporting, and suppresses the page error bubble
 * when the answer is yes.
 */
export function translateIndicatorActive(): boolean {
    return mode !== TRANSLATING_ANIMATION.NONE;
}

/**
 * Apply the setting. Failed markers of the *previous* mode are cleared (they
 * would be rendered in a style the user just turned off), in-flight batches are
 * left to settle under the mode they started in.
 */
export function setTranslateIndicatorMode(next: unknown): void {
    const value = Object.values(TRANSLATING_ANIMATION).includes(next as TRANSLATING_ANIMATION)
        ? next as TRANSLATING_ANIMATION
        : TRANSLATING_ANIMATION.INLINE_DOTS;
    if (value === mode) return;
    const previous = mode;
    mode = value;
    for (const batch of Array.from(batches)) {
        if (batch.failure) dropBatch(batch);
    }
    // Leaving corner mode: the top frame must be told this frame no longer
    // contributes, or its pill keeps whatever we last reported.
    if (previous === TRANSLATING_ANIMATION.CORNER_SPINNER) reportState();
    pushCorner();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function inlineVariant(m: TRANSLATING_ANIMATION): InlineVariant | null {
    if (m === TRANSLATING_ANIMATION.INLINE_DOTS) return "dots";
    if (m === TRANSLATING_ANIMATION.INLINE_SPINNER) return "spinner";
    return null;
}

let popoverModule: Promise<typeof import("./errorPopover")> | null = null;

/**
 * Open the reason next to the button that asked for it. Lazy, like every other
 * React surface reachable from here — a page that never fails never loads it.
 */
function showFailureAt(anchor: HTMLElement, failure: IndicatorFailure): void {
    if (!popoverModule) popoverModule = import("./errorPopover");
    popoverModule
        .then(({ toggleIndicatorError }) => toggleIndicatorError(anchor, failure))
        .catch((e) => {
            // Losing the panel must not lose the reason: reportRequestError's
            // console line is still there, and this says where to look for it.
            console.log(APP_NAME_WITH_SUFFIX, "error popover failed to render:", e, failure.reason);
        });
}

/** Close the reason panel. No-op when it was never opened on this page. */
function closeFailurePanel(): void {
    if (!popoverModule) return;
    void popoverModule.then(({ hideIndicatorError }) => hideIndicatorError()).catch(() => { });
}

/** Close it only if it is anchored inside `root`, which is about to disappear. */
function closeFailurePanelIn(root: Node): void {
    if (!popoverModule) return;
    void popoverModule.then(({ hideIndicatorErrorIn }) => hideIndicatorErrorIn(root)).catch(() => { });
}

function dropBatch(batch: Batch): void {
    for (const entry of batch.inline) {
        // A panel anchored to this marker would be left pointing at a node that
        // is no longer in the page.
        closeFailurePanelIn(entry.el);
        removeInlineIndicator(entry.el);
    }
    batch.inline = [];
    batches.delete(batch);
}

function retryBatch(batch: Batch, units: TranslationUnit[]): void {
    const retry = batch.retry;
    dropBatch(batch);
    reportState();
    pushCorner();
    // After the bookkeeping, so the re-run's own session starts from a clean
    // slate (it will register a fresh batch of its own).
    retry(units);
}

function retryUnit(batch: Batch, entry: InlineEntry): void {
    closeFailurePanelIn(entry.el);
    removeInlineIndicator(entry.el);
    batch.inline = batch.inline.filter((e) => e !== entry);
    batch.units = batch.units.filter((u) => u !== entry.unit);
    // The last unit of the batch went with it.
    if (batch.units.length === 0) dropBatch(batch);
    reportState();
    pushCorner();
    batch.retry([entry.unit]);
}

/**
 * Announce a batch of units. Returns null when the feature is off, so the call
 * site is one optional-chained call on each of the three outcomes.
 *
 * `retry` re-runs the units handed to it — main/content.ts re-derives them
 * against the live DOM first, since a unit is derived data and the page has had
 * a failed request's worth of time to change.
 */
export function beginTranslateIndicator(
    units: TranslationUnit[],
    retry: (units: TranslationUnit[]) => void,
): TranslateIndicatorSession | null {
    if (mode === TRANSLATING_ANIMATION.NONE || units.length === 0) return null;

    const batch: Batch = { mode, units: [...units], inline: [], retry, failure: null };
    const variant = inlineVariant(mode);
    if (variant) {
        for (const unit of units) {
            const el = mountInlineIndicator(unit, variant);
            if (el) batch.inline.push({ unit, el });
        }
    }
    batches.add(batch);
    reportState();
    pushCorner();

    return {
        done(): void {
            if (!batches.has(batch)) return;
            dropBatch(batch);
            reportState();
            pushCorner();
        },
        fail(failure: IndicatorFailure): void {
            // A batch dropped underneath us (page restored, mode switched, the
            // user hit retry) has no marker left to turn red, and re-adding one
            // for work the user has already moved past would be noise. The
            // console line from reportRequestError is still there.
            if (!batches.has(batch)) return;
            batch.failure = failure;
            for (const entry of batch.inline) {
                renderInlineError(entry.el, {
                    onDetails: (anchor) => showFailureAt(anchor, failure),
                    onRetry: () => retryUnit(batch, entry),
                });
            }
            reportState();
            pushCorner();
        },
    };
}

/** Every marker down, every batch forgotten (page restored / feature off). */
export function clearTranslateIndicators(): void {
    closeFailurePanel();
    for (const batch of Array.from(batches)) dropBatch(batch);
    reportState();
    pushCorner();
}

/**
 * Re-run everything that failed in THIS frame. Driven by the corner surface's
 * retry button, which reaches every frame of the tab through RELAY_FRAMES.
 */
export function retryFailedTranslations(): void {
    for (const batch of Array.from(batches)) {
        if (batch.failure) retryBatch(batch, batch.units);
    }
}

// ---------------------------------------------------------------------------
// Corner surface — cross-frame fold
// ---------------------------------------------------------------------------

function ownState(): FrameIndicatorState {
    let pending = 0;
    let failed = 0;
    let failure: IndicatorFailure | null = null;
    for (const batch of batches) {
        if (batch.mode !== TRANSLATING_ANIMATION.CORNER_SPINNER) continue;
        if (batch.failure) {
            failed++;
            // Last one wins: the pill reports the most recent reason.
            failure = batch.failure;
        } else {
            pending++;
        }
    }
    return { pending, failed, failure };
}

/**
 * What this sub-frame last told the top frame, reduced to what the pill can
 * actually show. Every batch calls reportState twice, and a frame full of
 * paragraphs produces a lot of batches — relaying each one would wake the
 * service worker dozens of times to redraw the same spinner. The pill only
 * distinguishes "busy or not", a failure count and a reason, so only a change
 * in one of those three is worth a message.
 */
let lastRelayed = "0|0|";

/** Publish this frame's contribution — locally in the top frame, else relayed. */
function reportState(): void {
    const state = ownState();
    if (isTopFrame()) {
        frameStates.set(0, { ...state, at: Date.now() });
        return;
    }
    const digest = `${state.pending > 0 ? 1 : 0}|${state.failed}|${state.failure?.reason ?? ""}`;
    if (digest === lastRelayed) return;
    lastRelayed = digest;
    void sendMessageToBackground({ action: ACTION.TRANSLATE_INDICATOR_STATE, data: state });
}

/** Fold a sub-frame's report in. Top frame only — called from the message handler. */
export function ingestFrameIndicatorState(frameId: number, state: FrameIndicatorState): void {
    if (!isTopFrame()) return;
    if (state.pending === 0 && state.failed === 0) frameStates.delete(frameId);
    else frameStates.set(frameId, { ...state, at: Date.now() });
    pushCorner();
}

function foldStates(): CornerIndicatorState {
    const now = Date.now();
    let pending = 0;
    let failed = 0;
    let failure: IndicatorFailure | null = null;
    let failureAt = -1;
    for (const [frameId, state] of Array.from(frameStates)) {
        // A sub-frame that stopped answering: its request can no longer land,
        // so its spinner is a lie. Its failure, if any, stays.
        const stale = frameId !== 0 && now - state.at > FRAME_PENDING_TTL_MS;
        if (!stale) pending += state.pending;
        failed += state.failed;
        if (state.failure && state.at >= failureAt) {
            failure = state.failure;
            failureAt = state.at;
        }
        if (stale && state.failed === 0) frameStates.delete(frameId);
    }
    return { pending, failed, failure };
}

let cornerModule: Promise<typeof import("./corner")> | null = null;
/** Once the pill has been mounted it must keep receiving state, even zeros. */
let cornerMounted = false;

function pushCorner(): void {
    if (!isTopFrame()) return;
    const folded = foldStates();
    // Nothing failed any more (retried, dismissed) ⇒ the pill's details button
    // is gone, so a panel anchored to it has lost its anchor.
    if (folded.failed === 0) closeFailurePanel();
    if (!cornerMounted && folded.pending === 0 && folded.failed === 0) return;
    cornerMounted = true;
    if (!cornerModule) {
        // Lazy for the same reason as the error bubble: React, i18n and the
        // Tailwind sheet are a lot to load on every page for a pill most pages
        // never show.
        cornerModule = import("./corner");
    }
    cornerModule
        .then(({ renderCornerIndicator }) => {
            renderCornerIndicator(folded, {
                onDetails: (anchor) => {
                    const reason = foldStates().failure;
                    if (reason) showFailureAt(anchor, reason);
                },
                onRetry: () => {
                    // Fanned out rather than run locally: the failures may be in
                    // sub-frames, and the top frame is on the receiving end of
                    // this broadcast too, so it needs no separate local call.
                    void sendMessageToBackground({
                        action: ACTION.RELAY_FRAMES,
                        data: { action: ACTION.RETRY_FAILED_TRANSLATIONS },
                    });
                },
                onDismiss: () => {
                    // Dismissal carries no memory (same rule as the error
                    // bubbles): this takes down what is on screen, and the next
                    // failure puts it right back. Local failures are dropped;
                    // relayed ones are forgotten here, and the frame that owns
                    // them re-reports if it fails again.
                    for (const batch of Array.from(batches)) {
                        if (batch.failure) dropBatch(batch);
                    }
                    frameStates.clear();
                    closeFailurePanel();
                    reportState();
                    pushCorner();
                },
            });
        })
        .catch(() => {
            // Rendering the indicator must never become the failure.
        });
}
