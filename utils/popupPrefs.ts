// ---------------------------------------------------------------------------
// Options › Customization › "Extension popup" — which parts of the toolbar
// popup are surfaced.
//
// Shared by the popup itself and by the Options preview, which renders the REAL
// popup: one shape, one set of defaults, so the preview cannot drift from what
// clicking the toolbar icon actually shows.
//
// These switches only HIDE controls. None of them changes the setting behind
// the control — hiding the global switch does not turn the extension off, it
// stops offering that control here; Options still has it.
//
// One gate comes from outside this card: `aiWriting` is also false while the
// AI Writing feature's own master switch (AI_WRITING_SWITCH) is off. That
// switch only ever gated the floating dot, so the popup kept offering an entry
// to a feature the user had turned off — and it still opened the workbench.
// Folding it in here rather than at the render site keeps the first paint and
// the live view in step, and the Options preview follows for free.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { CONFIG_KEY } from '@/main/constants';
import { readConfig, useConfig } from '@/utils/reactiveConfig';

export interface PopupPrefs {
    theme: boolean;
    help: boolean;
    globalSwitch: boolean;
    defaultStrategy: boolean;
    alwaysTranslateSite: boolean;
    neverTranslateSite: boolean;
    bilingualHighlight: boolean;
    aiWriting: boolean;
}

/** The popup exactly as it shipped: everything shown. */
export const STOCK_POPUP_PREFS: PopupPrefs = {
    theme: true,
    help: true,
    globalSwitch: true,
    defaultStrategy: true,
    alwaysTranslateSite: true,
    neverTranslateSite: true,
    bilingualHighlight: true,
    aiWriting: true,
};

/** Every key the card owns, in display order. */
export const POPUP_OPTION_KEYS: CONFIG_KEY[] = [
    CONFIG_KEY.POPUP_SHOW_THEME,
    CONFIG_KEY.POPUP_SHOW_HELP,
    CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH,
    CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY,
    CONFIG_KEY.POPUP_SHOW_ALWAYS_TRANSLATE_SITE,
    CONFIG_KEY.POPUP_SHOW_NEVER_TRANSLATE_SITE,
    CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT,
    CONFIG_KEY.POPUP_SHOW_AI_WRITING,
];

/**
 * Live view of the card's settings — for REACTING to later edits.
 *
 * Not for the first paint. `useConfig` cannot await, so it answers with the
 * shipped defaults (everything shown) until storage has hydrated. In the popup
 * that is visible: the window sizes itself to its content, so painting once
 * with every section and again without them makes it snap from full height to
 * the trimmed height. The popup therefore takes its first answer from
 * {@link loadPopupPrefs} and only adopts this one afterwards.
 *
 * `ignoreSwitch` answers with what the card's settings SAY, whether or not the
 * card's master switch is on. (The AI Writing master switch is NOT bypassed by
 * it — that one is not a card setting, and the preview should show the entry
 * missing for the same reason the real popup does.) That is for the Options preview, and only for it:
 * the preview's job is to show what these settings do, so having it snap back
 * to the full popup when the switch goes off would hide the very thing the user
 * is adjusting. Anything that actually renders the popup wants the gate.
 */
export function usePopupPrefs(options?: { ignoreSwitch?: boolean }): PopupPrefs {
    const ignoreSwitch = !!options?.ignoreSwitch;
    const enabled = useConfig<boolean>(CONFIG_KEY.CUSTOM_POPUP_SWITCH);
    const theme = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_THEME);
    const help = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_HELP);
    const globalSwitch = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH);
    const defaultStrategy = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY);
    const alwaysTranslateSite = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_ALWAYS_TRANSLATE_SITE);
    const neverTranslateSite = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_NEVER_TRANSLATE_SITE);
    const bilingualHighlight = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT);
    const aiWriting = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING);
    const aiWritingFeature = useConfig<boolean>(CONFIG_KEY.AI_WRITING_SWITCH);

    return useMemo(
        () =>
            enabled || ignoreSwitch
                ? {
                    theme: !!theme,
                    help: !!help,
                    globalSwitch: !!globalSwitch,
                    defaultStrategy: !!defaultStrategy,
                    alwaysTranslateSite: !!alwaysTranslateSite,
                    neverTranslateSite: !!neverTranslateSite,
                    bilingualHighlight: !!bilingualHighlight,
                    aiWriting: !!aiWriting && !!aiWritingFeature,
                }
                : withAiWritingFeature(STOCK_POPUP_PREFS, !!aiWritingFeature),
        [
            enabled, ignoreSwitch, theme, help, globalSwitch, defaultStrategy,
            alwaysTranslateSite, neverTranslateSite, bilingualHighlight, aiWriting, aiWritingFeature,
        ],
    );
}

/**
 * The same settings, read imperatively.
 *
 * The popup folds this into the hydration it already awaits before painting
 * anything, so the first frame it draws is the final layout. (An earlier
 * version relied on `useConfig` landing before the popup's own background round
 * trips — it usually does, and "usually" is exactly a flash the user sees.)
 */
export async function loadPopupPrefs(): Promise<PopupPrefs> {
    const [
        enabled, theme, help, globalSwitch, defaultStrategy,
        alwaysTranslateSite, neverTranslateSite, bilingualHighlight, aiWriting, aiWritingFeature,
    ] = await Promise.all([
        readConfig<boolean>(CONFIG_KEY.CUSTOM_POPUP_SWITCH),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_THEME),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_HELP),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_ALWAYS_TRANSLATE_SITE),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_NEVER_TRANSLATE_SITE),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT),
        readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING),
        readConfig<boolean>(CONFIG_KEY.AI_WRITING_SWITCH),
    ]);
    if (!enabled) return withAiWritingFeature(STOCK_POPUP_PREFS, !!aiWritingFeature);
    return {
        theme: !!theme,
        help: !!help,
        globalSwitch: !!globalSwitch,
        defaultStrategy: !!defaultStrategy,
        alwaysTranslateSite: !!alwaysTranslateSite,
        neverTranslateSite: !!neverTranslateSite,
        bilingualHighlight: !!bilingualHighlight,
        aiWriting: !!aiWriting && !!aiWritingFeature,
    };
}

/** The stock layout, minus the AI Writing entry when that feature is off. */
function withAiWritingFeature(prefs: PopupPrefs, aiWritingFeature: boolean): PopupPrefs {
    return aiWritingFeature ? prefs : { ...prefs, aiWriting: false };
}
