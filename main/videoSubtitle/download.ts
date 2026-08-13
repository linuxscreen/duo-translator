import type { SubtitleCue } from "./types";

/**
 * Subtitle download — SRT generation and the browser save.
 *
 * Pure formatting lives here (testable, no DOM state); the job that segments the
 * whole track, translates it with progress and can be cancelled is driven by the
 * controller (index.ts), because it needs the session's words and the same
 * service/target-language resolution the on-screen subtitles use.
 *
 * SRT rather than WebVTT: it is the format every player and every subtitle site
 * accepts, and a bilingual cue is just two lines — no styling needed.
 */

export type SubtitleDownloadKind = "bilingual" | "original" | "translation";

/** Live state of the running job, pushed into the player menu. */
export interface SubtitleDownloadState {
    kind: SubtitleDownloadKind;
    /** 0..100, integer. */
    percent: number;
    /** Set when the job failed — the panel stays up until dismissed. */
    error?: string;
}

/** `hh:mm:ss,mmm`, the SRT timestamp. Negative times clamp to zero. */
export function srtTimestamp(ms: number): string {
    const total = Math.max(0, Math.round(ms));
    const h = Math.floor(total / 3_600_000);
    const m = Math.floor((total % 3_600_000) / 60_000);
    const s = Math.floor((total % 60_000) / 1000);
    const milli = total % 1000;
    const p = (v: number, len = 2) => String(v).padStart(len, "0");
    return `${p(h)}:${p(m)}:${p(s)},${p(milli, 3)}`;
}

/**
 * Translations come back as `translatedMappedHtmlText`, so they can carry the
 * inline tags the provider was given. A subtitle line is plain text.
 *
 * Parsed with DOMParser rather than a throwaway `div.innerHTML`: the resulting
 * document is inert, so nothing in provider-returned markup can fetch a
 * resource on its way to being stripped.
 */
export function stripHtml(text: string): string {
    if (!text.includes("<") && !text.includes("&")) return text;
    try {
        return new DOMParser().parseFromString(text, "text/html").body.textContent ?? "";
    } catch {
        return text;
    }
}

/** The lines one cue contributes, in the same order the overlay stacks them. */
function cueLines(cue: SubtitleCue, kind: SubtitleDownloadKind): string[] {
    const original = cue.text.trim();
    const translated = stripHtml(cue.translated ?? "").trim();
    // A missing translation degrades to the original rather than to an empty
    // cue: same-language tracks are never translated at all, and a "translation"
    // file that is blank from top to bottom would just look broken.
    if (kind === "original" || !translated) return [original];
    if (kind === "translation") return [translated];
    return [original, translated];
}

/** Render cues as an SRT document. Cues with no text at all are dropped. */
export function buildSrt(cues: SubtitleCue[], kind: SubtitleDownloadKind): string {
    const blocks: string[] = [];
    for (const cue of cues) {
        const lines = cueLines(cue, kind).filter((l) => l !== "");
        if (lines.length === 0) continue;
        blocks.push(
            `${blocks.length + 1}\n` +
            `${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n` +
            `${lines.join("\n")}\n`,
        );
    }
    return blocks.join("\n");
}

/**
 * A file name every OS accepts: path separators, the Windows-reserved
 * characters and control characters are dropped, runs of whitespace collapse,
 * and the stem is capped so the full name stays well inside the 255-byte limit
 * once the suffixes below are appended.
 *
 * Spaces and hyphens are KEPT — they are legal everywhere and are most of what
 * makes a video title readable as a file name.
 */
function sanitizeFileName(name: string): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|]/g, " ")
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.slice(0, 80).trim();
}

const KIND_SUFFIX: Record<SubtitleDownloadKind, string> = {
    bilingual: "bilingual",
    original: "original",
    translation: "translation",
};

/** `<video title>.<lang>.<kind>.srt`, falling back to the video id. */
export function subtitleFileName(
    title: string,
    kind: SubtitleDownloadKind,
    lang: string,
    fallback: string,
): string {
    const stem = sanitizeFileName(title) || sanitizeFileName(fallback) || "subtitle";
    const langPart = kind === "original" ? "" : `.${sanitizeFileName(lang) || "translated"}`;
    return `${stem}${langPart}.${KIND_SUFFIX[kind]}.srt`;
}

/** Save `text` as a file through a transient object URL. */
export function downloadTextFile(fileName: string, text: string): void {
    // BOM: Windows players (and Excel-style tooling) read a BOM-less UTF-8 SRT
    // as the local ANSI codepage and mojibake every non-ASCII line.
    const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a later task: some browsers abort the save if the URL dies
    // while the download is still being handed off.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
