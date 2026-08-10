// ---------------------------------------------------------------------------
// On-device model download progress — CONTENT SIDE, top frame only.
//
// Background starts the download by itself the first time a page needs a
// language pair, because `Translator.create()` in an MV3 service worker needs
// no user activation (measured — a *web page* does need one, which is why this
// file shows progress rather than performing the download).
//
// So the whole user-visible flow is: open a page, see a progress bar, see the
// page translate itself. This surface exists so that first wait is not a
// mystery — and so it can be stopped, since a first-time model is a large
// download that nobody asked for out loud.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Languages, X } from "lucide-react";
import { ACTION } from "@/main/constants";
import { sendMessageToBackground } from "@/utils/message";
import { loadTailwindIntoShadow } from "@/main/aiWriting/shadowStyle";
import { bindThemeToElement } from "@/utils/theme";
import { t, useLang } from "@/main/aiWriting/i18n";
import type { BuiltinAiDownloadProgress } from "./types";

const HOST_ID = "duo-builtin-ai-model-host";

/** How long the finished bar stays up before it fades out. */
const DONE_LINGER_MS = 1200;

// ---------------------------------------------------------------------------
// Store (outside React, same reasoning as main/errorToast)
// ---------------------------------------------------------------------------

let current: BuiltinAiDownloadProgress | null = null;
const listeners = new Set<(v: BuiltinAiDownloadProgress | null) => void>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The download the user closed the bar on, if any.
 *
 * Closing has to be remembered for the rest of that download, because progress
 * arrives ~4×/second: without this the bar reappeared on the very next tick and
 * the close button looked broken.
 *
 * Scoped to one download and no further — the same pair downloading again later
 * is a NEW event and shows again. (Same reasoning as the error bubbles in
 * main/errorToast: a dismissal that outlives what was dismissed turns into a
 * permanent mute the user never asked for.)
 */
let dismissedKey: string | null = null;

/** Identifies one download: the detector, or one language pair. */
function progressKey(p: BuiltinAiDownloadProgress): string {
    return p.kind === "detector" ? "detector" : `${p.sourceLang}>${p.targetLang}`;
}

function emit(): void {
    const snapshot = current;
    listeners.forEach((fn) => fn(snapshot));
}

/** Take the bar down without remembering anything (auto-hide, cancel). */
function clearBar(): void {
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    current = null;
    emit();
}

/** The close button: take it down AND keep it down for this download. */
function dismiss(): void {
    if (current) dismissedKey = progressKey(current);
    clearBar();
}

/**
 * The stop button. Background aborts the download and latches the pair so the
 * next paragraph batch does not immediately start it again; it confirms with a
 * `cancelled` broadcast, which is what actually takes this bar down. Closing
 * here as well would be redundant, but the request can fail (service worker
 * asleep mid-navigation), and then leaving the bar up is the truthful outcome.
 */
function cancelDownload(): void {
    const target = current;
    if (!target) return;
    void sendMessageToBackground({
        action: ACTION.BUILTIN_AI_CANCEL_DOWNLOAD,
        data: { kind: target.kind, sourceLang: target.sourceLang, targetLang: target.targetLang },
    });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function ModelDownloadBar() {
    useLang();
    const [progress, setProgress] = useState<BuiltinAiDownloadProgress | null>(current);

    useEffect(() => {
        listeners.add(setProgress);
        return () => { listeners.delete(setProgress); };
    }, []);

    if (!progress) return null;
    const failed = !!progress.error;

    return (
        // Full-width flex row + justify-center, NOT left-1/2 + -translate-x-1/2:
        // inside a Shadow DOM the latter measures the initial containing block
        // and sits visibly off-centre once the page has a scrollbar.
        <div className="pointer-events-none fixed inset-x-0 top-3 z-[2147483646] flex justify-center px-3">
            <div
                role="status"
                className="pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-lg border border-line-strong bg-surface px-3 py-2.5 shadow-lg"
            >
                <Languages className="mt-[2px] h-4 w-4 shrink-0 text-ink-soft" />
                <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink">
                        {failed
                            ? t("builtinAiModelFailed", "Could not download the translation model")
                            : progress.done
                                ? t("builtinAiModelReady", "Translation model ready")
                                : t("builtinAiModelDownloading", "Downloading the translation model…")}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-mute">
                        {/* The detector is one shared model with no language
                            pair — rendering " → " for it would read as a bug. */}
                        {progress.kind === "detector"
                            ? t("builtinAiDetectorStatus", "Language detector")
                            : `${progress.sourceLang} → ${progress.targetLang}`}
                        {!failed && !progress.done && ` · ${t("builtinAiModelOneTime", "one time only, then it works offline")}`}
                    </p>

                    {failed ? (
                        <p className="mt-1 break-words text-[11.5px] leading-snug text-error">
                            {progress.error!.slice(0, 200)}
                        </p>
                    ) : (
                        <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-hover-2">
                                <div
                                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                                    style={{ width: `${progress.percent}%` }}
                                />
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-ink-mute">
                                {progress.percent}%
                            </span>
                            {/* Stopping is only meaningful while bytes are
                                still moving — once it is done there is nothing
                                left to stop, and offering it would imply the
                                model could be un-downloaded. */}
                            {!progress.done && (
                                <button
                                    type="button"
                                    onClick={cancelDownload}
                                    className="shrink-0 rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-hover-2 hover:text-ink"
                                >
                                    {t("builtinAiCancelDownload", "Stop")}
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    aria-label={t("errDismiss", "Dismiss")}
                    title={t("errDismiss", "Dismiss")}
                    onClick={dismiss}
                    className="-mr-1 shrink-0 rounded p-1 text-ink-soft hover:bg-hover-2 hover:text-ink"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

let promptRoot: Root | null = null;

function ensureMounted(): void {
    if (promptRoot) return;
    let host = document.getElementById(HOST_ID) as HTMLElement | null;
    if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        host.setAttribute("data-duo-ai-ui", "");
        document.documentElement.appendChild(host);
    }
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    loadTailwindIntoShadow(shadow);
    const mount = document.createElement("div");
    mount.className = "duo-ai-root";
    shadow.appendChild(mount);
    // Claim the root BEFORE anything that can throw, so a failure here cannot
    // leave a half-built mount to be retried into a second React root (the
    // exact bug main/errorToast documents).
    promptRoot = createRoot(mount);
    bindThemeToElement(mount);
    promptRoot.render(<ModelDownloadBar />);
}

/**
 * Render the current download state. Driven entirely by background's
 * BUILTIN_AI_DOWNLOAD_PROGRESS broadcast — this surface only ever *requests* a
 * cancel; it never starts, stops or retries a download itself.
 *
 * A successful finish lingers briefly and then clears itself; a failure stays
 * until dismissed, because that one the user may want to read.
 */
export function showBuiltinAiDownloadProgress(progress: BuiltinAiDownloadProgress): void {
    if (!progress) return;
    // The detector is one shared model with no language pair, so an empty pair
    // is normal for it — only a translator needs a target to be meaningful.
    if (progress.kind !== "detector" && !progress.targetLang) return;

    const key = progressKey(progress);
    if (progress.cancelled) {
        // The user's own stop, coming back confirmed. Nothing to announce.
        if (dismissedKey === key) dismissedKey = null;
        clearBar();
        return;
    }
    if (dismissedKey === key) {
        // Still the download they closed. Release the memory once it ends, so
        // that a later download of the same pair is visible again.
        if (progress.done) dismissedKey = null;
        return;
    }

    current = progress;
    ensureMounted();
    emit();

    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    if (progress.done && !progress.error) {
        hideTimer = setTimeout(clearBar, DONE_LINGER_MS);
    }
}
