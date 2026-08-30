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
// ---------------------------------------------------------------------------

import { useMemo } from 'react';
import { CONFIG_KEY } from '@/main/constants';
import { readConfig, useConfig } from '@/utils/reactiveConfig';

export interface PopupPrefs {
    theme: boolean;
    help: boolean;
    globalSwitch: boolean;
    defaultStrategy: boolean;
    bilingualHighlight: boolean;
    aiWriting: boolean;
}

/** The popup exactly as it shipped: everything shown. */
export const STOCK_POPUP_PREFS: PopupPrefs = {
    theme: true,
    help: true,
    globalSwitch: true,
    defaultStrategy: true,
    bilingualHighlight: true,
    aiWriting: true,
};

/** Every key the card owns, in display order. */
export const POPUP_OPTION_KEYS: CONFIG_KEY[] = [
    CONFIG_KEY.POPUP_SHOW_THEME,
    CONFIG_KEY.POPUP_SHOW_HELP,
    CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH,
    CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY,
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
 * `ignoreSwitch` answers with what the six settings SAY, whether or not the
 * card's master switch is on. That is for the Options preview, and only for it:
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
    const bilingualHighlight = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT);
    const aiWriting = useConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING);

    return useMemo(
        () =>
            enabled || ignoreSwitch
                ? {
                    theme: !!theme,
                    help: !!help,
                    globalSwitch: !!globalSwitch,
                    defaultStrategy: !!defaultStrategy,
                    bilingualHighlight: !!bilingualHighlight,
                    aiWriting: !!aiWriting,
                }
                : STOCK_POPUP_PREFS,
        [enabled, ignoreSwitch, theme, help, globalSwitch, defaultStrategy, bilingualHighlight, aiWriting],
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
    const [enabled, theme, help, globalSwitch, defaultStrategy, bilingualHighlight, aiWriting] =
        await Promise.all([
            readConfig<boolean>(CONFIG_KEY.CUSTOM_POPUP_SWITCH),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_THEME),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_HELP),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_GLOBAL_SWITCH),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_DEFAULT_STRATEGY),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_BILINGUAL_HIGHLIGHT),
            readConfig<boolean>(CONFIG_KEY.POPUP_SHOW_AI_WRITING),
        ]);
    if (!enabled) return STOCK_POPUP_PREFS;
    return {
        theme: !!theme,
        help: !!help,
        globalSwitch: !!globalSwitch,
        defaultStrategy: !!defaultStrategy,
        bilingualHighlight: !!bilingualHighlight,
        aiWriting: !!aiWriting,
    };
}
