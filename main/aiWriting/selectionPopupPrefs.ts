// ---------------------------------------------------------------------------
// Options › Customization › "Selection translate popup" — the card's settings,
// as the popup itself consumes them.
//
// Shared by the live popup (content script) and by the Options preview, which
// renders the REAL card: one shape, one set of defaults, so the preview cannot
// drift from what the page actually shows.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { CONFIG_KEY } from '@/main/constants';
import { readConfig, useConfig } from '@/utils/reactiveConfig';

export interface SelectionPopupPrefs {
    /** Show every selected service's answer at once, each labelled. */
    multiService: boolean;
    /** Service keys chosen for {@link multiService}. Empty ⇒ the page default. */
    services: string[];
    dict: boolean;
    dictExamples: boolean;
    showOriginal: boolean;
    translationTts: boolean;
    translationCopy: boolean;
    originalTts: boolean;
    originalCopy: boolean;
    /** Pickers move out of the header and behind a gear button. */
    hideHeaderConfig: boolean;
}

/**
 * The card exactly as it shipped before this feature existed.
 *
 * Used both as the value when the card's master switch is off and as the
 * per-key defaults, so "switch off" and "everything at its default" are the
 * same card rather than two subtly different ones.
 */
export const STOCK_SELECTION_POPUP_PREFS: SelectionPopupPrefs = {
    multiService: false,
    services: [],
    dict: true,
    dictExamples: true,
    showOriginal: true,
    translationTts: true,
    translationCopy: true,
    originalTts: true,
    originalCopy: true,
    hideHeaderConfig: false,
};

/**
 * Live view of the card's settings.
 *
 * Reactive on purpose: the Options preview has to redraw the moment a switch is
 * flipped, and an already-open popup in a page picks the change up with no
 * reload. Every key is read unconditionally (hooks cannot be conditional) and
 * the master switch is applied afterwards.
 *
 * Memoized so the object identity only changes when a value does — the popup
 * feeds some of these into effects that restart translations.
 *
 * `ignoreSwitch` answers with what the settings SAY, whether or not the card's
 * master switch is on. That is for the Options preview, and only for it: the
 * preview exists to show what these settings do, so snapping it back to the
 * stock card when the switch goes off would hide the very thing being adjusted.
 * Anything that actually renders the card wants the gate.
 */
export function useSelectionPopupPrefs(options?: { ignoreSwitch?: boolean }): SelectionPopupPrefs {
    const ignoreSwitch = !!options?.ignoreSwitch;
    const enabled = useConfig<boolean>(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH);
    const multiService = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_MULTI_SERVICE);
    const services = useConfig<string[]>(CONFIG_KEY.SELECTION_POPUP_SERVICES);
    const dict = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT);
    const dictExamples = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES);
    const showOriginal = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL);
    const translationTts = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS);
    const translationCopy = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY);
    const originalTts = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS);
    const originalCopy = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY);
    const hideHeaderConfig = useConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG);

    // The service list is the one value that can arrive as anything (an older
    // build, another device's snapshot), so it is filtered rather than trusted.
    const cleanServices = useMemo(
        () => (Array.isArray(services) ? services.filter((s) => typeof s === 'string' && s !== '') : []),
        [services],
    );

    return useMemo(
        () =>
            enabled || ignoreSwitch
                ? {
                    multiService: !!multiService,
                    services: cleanServices,
                    dict: !!dict,
                    dictExamples: !!dictExamples,
                    showOriginal: !!showOriginal,
                    translationTts: !!translationTts,
                    translationCopy: !!translationCopy,
                    originalTts: !!originalTts,
                    originalCopy: !!originalCopy,
                    hideHeaderConfig: !!hideHeaderConfig,
                }
                : STOCK_SELECTION_POPUP_PREFS,
        [
            enabled, ignoreSwitch, multiService, cleanServices, dict, dictExamples, showOriginal,
            translationTts, translationCopy, originalTts, originalCopy, hideHeaderConfig,
        ],
    );
}

/**
 * The same settings, read imperatively.
 *
 * The popup needs these BEFORE it decides what to request — how many services
 * to ask, whether to look the word up at all — and `useConfig` cannot await, so
 * on the first open of a fresh page it would still be handing back the shipped
 * defaults. Acting on a provisional value there means one popup per page load
 * quietly ignores the user's settings, which is precisely the class of bug
 * `readConfig` exists for. Rendering keeps using the hook; the two converge.
 */
export async function loadSelectionPopupPrefs(): Promise<SelectionPopupPrefs> {
    const [
        enabled, multiService, services, dict, dictExamples, showOriginal,
        translationTts, translationCopy, originalTts, originalCopy, hideHeaderConfig,
    ] = await Promise.all([
        readConfig<boolean>(CONFIG_KEY.CUSTOM_SELECTION_POPUP_SWITCH),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_MULTI_SERVICE),
        readConfig<string[]>(CONFIG_KEY.SELECTION_POPUP_SERVICES),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_DICT_EXAMPLES),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_SHOW_ORIGINAL),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_TTS),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_TRANSLATION_COPY),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_TTS),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_ORIGINAL_COPY),
        readConfig<boolean>(CONFIG_KEY.SELECTION_POPUP_HIDE_HEADER_CONFIG),
    ]);
    if (!enabled) return STOCK_SELECTION_POPUP_PREFS;
    return {
        multiService: !!multiService,
        services: Array.isArray(services) ? services.filter((x) => typeof x === 'string' && x !== '') : [],
        dict: !!dict,
        dictExamples: !!dictExamples,
        showOriginal: !!showOriginal,
        translationTts: !!translationTts,
        translationCopy: !!translationCopy,
        originalTts: !!originalTts,
        originalCopy: !!originalCopy,
        hideHeaderConfig: !!hideHeaderConfig,
    };
}

/**
 * Which services the card should ask, given the settings and the page default.
 *
 * Never empty: an empty stored list means "the user has not picked yet", and a
 * card that answers with nothing at all is indistinguishable from a broken one.
 * Keys the picker no longer offers (an AI provider that was deleted) are
 * dropped here rather than at render time, so a stale entry cannot cost a
 * request that is guaranteed to fail.
 */
export function resolveSelectionServices(
    prefs: SelectionPopupPrefs,
    pageService: string,
    available: readonly { value: string }[],
    singleOverride: string | null,
): string[] {
    if (!prefs.multiService) return [singleOverride || pageService].filter(Boolean);
    const known = new Set(available.map((o) => o.value));
    const picked = prefs.services.filter((k) => known.has(k));
    return picked.length > 0 ? picked : [pageService].filter(Boolean);
}
