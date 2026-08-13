// Cancelling a built-in AI batch.
//
// The on-device provider is the one that does its work as a QUEUE of per-text
// model calls rather than a single request, so "the user cancelled" has to be
// honoured twice: the call in flight must reject, and the calls still queued
// must never start. Neither happened at first — the signal was accepted by
// `translateText` and dropped — and the symptom was that restoring the original
// page left the translating indicator turning until the abandoned batch had
// ground through every remaining paragraph.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type TranslateFn = (text: string, options?: { signal?: AbortSignal }) => Promise<string>;

/**
 * Install the two on-device globals. `sourceLang` is always passed by these
 * tests, so the detector is never consulted — but `requireSupport()` checks for
 * both globals, so both have to exist.
 */
function installModel(translate: TranslateFn): void {
    (globalThis as any).Translator = {
        availability: async () => "available",
        create: async () => ({ translate, destroy: () => { } }),
    };
    (globalThis as any).LanguageDetector = {
        availability: async () => "available",
        create: async () => ({ detect: async () => [], destroy: () => { } }),
    };
}

beforeEach(() => {
    // The module caches translator sessions and download state at module scope.
    vi.resetModules();
});

afterEach(() => {
    delete (globalThis as any).Translator;
    delete (globalThis as any).LanguageDetector;
});

describe("builtinAiTranslateTexts — abort", () => {
    it("passes the caller's signal into every model call", async () => {
        const seen: (AbortSignal | undefined)[] = [];
        installModel(async (text, options) => {
            seen.push(options?.signal);
            return `译:${text}`;
        });
        const { builtinAiTranslateTexts } = await import("@/main/builtinAi/builtinAiService");

        const controller = new AbortController();
        const result = await builtinAiTranslateTexts(["a", "b", "c"], "zh-CN", "en", controller.signal);

        expect(result.texts).toEqual(["译:a", "译:b", "译:c"]);
        expect(seen).toHaveLength(3);
        expect(seen.every((s) => s === controller.signal)).toBe(true);
    });

    it("stops the queue instead of translating the rest of the batch", async () => {
        const controller = new AbortController();
        let calls = 0;
        installModel(async (text) => {
            calls++;
            // The user hits "restore original" while the first paragraphs are
            // still being translated.
            controller.abort();
            return `译:${text}`;
        });
        const { builtinAiTranslateTexts } = await import("@/main/builtinAi/builtinAiService");

        const texts = Array.from({ length: 40 }, (_, i) => `p${i}`);
        await expect(
            builtinAiTranslateTexts(texts, "zh-CN", "en", controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });

        // Bounded by the concurrency limit (4): only the calls already in flight
        // when the abort landed may complete. Without the per-item check the
        // workers would keep pulling from the queue and run all 40 — that delay
        // IS the bug this pins.
        expect(calls).toBeLessThanOrEqual(4);
    });

    it("does not re-run the batch after an abort", async () => {
        // The generic-failure path retries once against fresh sessions. Doing
        // that for a cancelled batch would replay the whole thing for a page the
        // user has already restored.
        const controller = new AbortController();
        let calls = 0;
        installModel(async () => {
            calls++;
            controller.abort();
            throw new DOMException("aborted", "AbortError");
        });
        const { builtinAiTranslateTexts } = await import("@/main/builtinAi/builtinAiService");

        await expect(
            builtinAiTranslateTexts(["a"], "zh-CN", "en", controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(calls).toBe(1);
    });

    it("is unaffected when no signal is given", async () => {
        const seen: (AbortSignal | undefined)[] = [];
        installModel(async (text, options) => {
            seen.push(options?.signal);
            return `译:${text}`;
        });
        const { builtinAiTranslateTexts } = await import("@/main/builtinAi/builtinAiService");

        const result = await builtinAiTranslateTexts(["a"], "zh-CN", "en");
        expect(result.texts).toEqual(["译:a"]);
        expect(seen).toEqual([undefined]);
    });
});
