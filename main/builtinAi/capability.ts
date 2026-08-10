// ---------------------------------------------------------------------------
// "Can this browser do built-in AI at all?" — the one predicate, shared by
// every context.
//
// Deliberately a runtime check rather than a build-time macro. WXT's compile
// -time globals (BROWSER / CHROME / FIREFOX / EDGE …) only describe the build
// TARGET, never the browser actually running the code: one `wxt build` artifact
// is served from the store to Chrome 138 and Chrome 153 alike, and to Brave /
// Opera / Vivaldi as well. A macro cannot be true and false at the same time.
//
// Nor is a version number the right question. Chrome 138+ on hardware that
// cannot host the model exposes the API and then reports every language pair as
// `unavailable`; Chrome on Android has no API at all. The presence of the
// globals is the fact we actually care about, so ask for it directly.
//
// Safe from anywhere: the globals were measured present in all four contexts we
// run in — page main world, content-script isolated world, extension pages, and
// the MV3 service worker — and `typeof` on an undeclared name never throws.
// ---------------------------------------------------------------------------

/**
 * True when the on-device translation APIs exist in this context.
 *
 * Both are required: `Translator` does the work, and `LanguageDetector` is what
 * picks the source language for every batch, so a browser with only one of them
 * cannot serve a page translation.
 */
export function builtinAiApiAvailable(): boolean {
    return typeof (globalThis as any).Translator !== "undefined"
        && typeof (globalThis as any).LanguageDetector !== "undefined";
}
