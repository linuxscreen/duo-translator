// ---------------------------------------------------------------------------
// Customization › custom shortcuts — shared data model.
//
// Imported by BOTH the Options UI and the content script, so this module stays
// pure data + pure functions: no DOM, no storage, no i18n instance (the label
// helpers take a `t` function). Same rule as main/siteRules/types.ts.
//
// These gestures COEXIST with everything else that already listens for input:
// the browser `commands` shortcuts and the double-tap modifier are untouched.
// Nothing here replaces them, which is why the whole feature is behind its own
// switch and ships off.
// ---------------------------------------------------------------------------

/** How a gesture fires. */
export enum GESTURE_TRIGGER {
    /** One press + release. */
    CLICK = 'click',
    /** `count` presses, each within `interval` ms of the previous one. */
    MULTI = 'multi',
    /** Held down for at least `holdMs`, with no other key pressed meanwhile. */
    HOLD = 'hold',
}

/**
 * What a gesture does. The three actions the page already knows how to perform
 * from a pointer/key gesture — the same set the double-tap modifier offers,
 * which is why the labels reuse its i18n keys (one wording, one translation).
 */
export enum CUSTOM_SHORTCUT_ACTION {
    TRANSLATE_SELECTION = 'translateSelection',
    TRANSLATE_INPUT = 'translateInput',
    TOGGLE_PARAGRAPH = 'toggleParagraph',
}

/** Options rows for the "Function" picker, in display order. Default is the first. */
export const CUSTOM_SHORTCUT_ACTION_OPTIONS: {
    value: CUSTOM_SHORTCUT_ACTION;
    title: string;
    fallback: string;
}[] = [
        { value: CUSTOM_SHORTCUT_ACTION.TRANSLATE_SELECTION, title: 'doubleTapTranslateSelection', fallback: 'Translate selection' },
        { value: CUSTOM_SHORTCUT_ACTION.TRANSLATE_INPUT, title: 'doubleTapTranslateInput', fallback: 'Translate input box' },
        { value: CUSTOM_SHORTCUT_ACTION.TOGGLE_PARAGRAPH, title: 'doubleTapToggleParagraph', fallback: 'Translate / restore mouse-over paragraph' },
    ];

/**
 * The middle mouse button, as a key token.
 *
 * Deliberately a value in the SAME namespace as keyboard tokens rather than a
 * separate `kind` field: every downstream consumer (the recognizer's per-key
 * state, the conflict check, the label) only ever asks "which key is this
 * gesture on", and a second dimension would have to be threaded through all of
 * them for no gain. It can never collide with a `KeyboardEvent.code`.
 */
export const MOUSE_MIDDLE_KEY = 'MouseMiddle';

/** The "no gesture" entry of the shortcut picker. Not a real shortcut id. */
export const SHORTCUT_NONE = 'none';

/**
 * Bounds for the tunable timings.
 *
 * `MULTI_INTERVAL_MS.def` is 400 to match the existing double-tap window in
 * content.ts — two gestures with visibly different tolerances for "quickly"
 * would feel like a bug. The hold default is 500ms: long enough that a normal
 * Ctrl+C never crosses it (the second key cancels the hold anyway, this is the
 * belt), short enough not to feel like waiting.
 */
export const MULTI_COUNT = { min: 2, max: 4, def: 2 } as const;
export const MULTI_INTERVAL_MS = { min: 100, max: 1000, def: 400 } as const;
export const HOLD_MS = { min: 200, max: 3000, def: 500 } as const;

/** A gesture definition, built-in or user-made. */
export type ShortcutDef = {
    id: string;
    /**
     * The combo, canonical form — see {@link buildCombo}. One or more tokens
     * from {@link gestureKeyOf} / {@link MOUSE_MIDDLE_KEY} joined by `+`.
     */
    key: string;
    trigger: GESTURE_TRIGGER;
    /** MULTI only. */
    count: number;
    /** MULTI only, milliseconds. */
    interval: number;
    /** HOLD only, milliseconds. */
    holdMs: number;
};

/** A user-made gesture. Only these are stored; built-ins are referenced by id. */
export type CustomShortcut = ShortcutDef & { name: string };

/** "Run this action when that gesture fires." */
export type ShortcutBinding = {
    id: string;
    action: CUSTOM_SHORTCUT_ACTION;
    /** A built-in id, a custom shortcut's id, or {@link SHORTCUT_NONE}. */
    shortcutId: string;
};

/**
 * The built-in gestures, in picker order (after "None").
 *
 * Their labels are NOT stored and NOT listed here — they are derived from the
 * definition by {@link shortcutLabel}, exactly like a custom shortcut's
 * auto-generated name. So "Hold Ctrl" / "长按Ctrl" stays in the user's current
 * interface language instead of freezing at whatever it was on first install.
 */
export const BUILTIN_SHORTCUTS: readonly ShortcutDef[] = [
    { id: 'holdCtrl', key: 'Control', trigger: GESTURE_TRIGGER.HOLD, count: 0, interval: 0, holdMs: HOLD_MS.def },
    { id: 'holdAlt', key: 'Alt', trigger: GESTURE_TRIGGER.HOLD, count: 0, interval: 0, holdMs: HOLD_MS.def },
    { id: 'middleClick', key: MOUSE_MIDDLE_KEY, trigger: GESTURE_TRIGGER.CLICK, count: 0, interval: 0, holdMs: 0 },
    { id: 'holdMiddle', key: MOUSE_MIDDLE_KEY, trigger: GESTURE_TRIGGER.HOLD, count: 0, interval: 0, holdMs: HOLD_MS.def },
    { id: 'doubleMiddle', key: MOUSE_MIDDLE_KEY, trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: MULTI_INTERVAL_MS.def, holdMs: 0 },
    { id: 'doubleSpace', key: 'Space', trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: MULTI_INTERVAL_MS.def, holdMs: 0 },
    { id: 'tripleSpace', key: 'Space', trigger: GESTURE_TRIGGER.MULTI, count: 3, interval: MULTI_INTERVAL_MS.def, holdMs: 0 },
];

const BUILTIN_BY_ID = new Map(BUILTIN_SHORTCUTS.map((s) => [s.id, s]));

// --- key tokens and combos --------------------------------------------------

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** Canonical modifier order inside a combo string. */
const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Meta'];

/** Modifier flags as every DOM input event already carries them. */
export type ModifierState = {
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
};

/** The four modifier tokens, paired with the event flag that reports them. */
export const MODIFIER_FLAGS: readonly [string, keyof ModifierState][] = [
    ['Control', 'ctrlKey'],
    ['Alt', 'altKey'],
    ['Shift', 'shiftKey'],
    ['Meta', 'metaKey'],
];

export function isModifierToken(key: string): boolean {
    return MODIFIER_KEYS.has(key);
}

/**
 * The token a keyboard event contributes to gesture matching.
 *
 * `code` (physical position) for ordinary keys so a gesture recorded on a US
 * layout still fires on AZERTY, but `key` for the four modifiers: `code`
 * distinguishes ControlLeft from ControlRight, and "hold Ctrl" means either
 * one. Takes a structural shape rather than `KeyboardEvent` so this module
 * stays DOM-free and unit-testable.
 */
export function gestureKeyOf(e: { key: string; code: string }): string {
    if (MODIFIER_KEYS.has(e.key)) return e.key;
    return e.code || e.key;
}

/** Can this token be captured as a gesture key at all? */
export function isCapturableKey(key: string): boolean {
    // Escape cancels capture and Tab moves focus — recording either would trap
    // the user inside the capture control with no keyboard way out.
    return key !== '' && key !== 'Escape' && key !== 'Tab';
}

/**
 * A gesture's "key" is a COMBO: zero or more modifiers plus at most one
 * ordinary key, serialized as `Control+Shift+KeyY`.
 *
 * A single key serializes to itself, so `"Control"` / `"Space"` /
 * `"MouseMiddle"` are byte-identical to what the single-key version stored —
 * no migration, and the built-ins below are unchanged.
 *
 * A modifiers-only combo (`Control+Shift`) is legal and is the reason the main
 * key is optional: "hold Ctrl+Shift" is a perfectly ordinary gesture, and the
 * recognizer treats every combo as a SET of keys anyway, so it needs no
 * special case for it.
 */
export function buildCombo(modifiers: string[], main: string | null): string {
    const ordered = MODIFIER_ORDER.filter((m) => modifiers.includes(m));
    return (main ? [...ordered, main] : ordered).join('+');
}

/** The individual keys of a combo. `''` yields an empty list. */
export function comboKeys(combo: string): string[] {
    return combo === '' ? [] : combo.split('+');
}

/**
 * Put a stored combo into canonical form: modifiers in fixed order and
 * deduped, at most one ordinary key. Two combos are the same gesture iff their
 * canonical strings are equal, which is what `sameGesture` relies on.
 */
export function normalizeCombo(raw: string): string {
    const parts = comboKeys(raw).filter((p) => p !== '');
    const main = parts.find((p) => !isModifierToken(p)) ?? null;
    return buildCombo(parts.filter(isModifierToken), main);
}

// --- labels -----------------------------------------------------------------

/** The subset of i18next's `t` this module needs. */
export type TFn = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

const MAC_MODIFIER_LABELS: Record<string, string> = {
    // Same reasoning as ShortcutsPage's MODIFIER_LABELS: a gesture asks the user
    // to find a PHYSICAL key, so the label follows the keycap. Symbol + word
    // because ⌃ is the least recognized of the four Mac modifier symbols.
    Control: '⌃ Control',
    Alt: '⌥ Option',
    Meta: '⌘ Command',
    Shift: '⇧ Shift',
};

const MODIFIER_LABELS: Record<string, string> = {
    Control: 'Ctrl',
    Alt: 'Alt',
    Meta: 'Win',
    Shift: 'Shift',
};

/** Compact modifier symbols, for combos where the word forms would not fit. */
const MAC_MODIFIER_SYMBOLS: Record<string, string> = {
    Control: '⌃',
    Alt: '⌥',
    Meta: '⌘',
    Shift: '⇧',
};

/** Human label for one key token. */
export function keyLabel(key: string, t: TFn, isMac = false): string {
    if (key === MOUSE_MIDDLE_KEY) return t('customShortcutKeyMiddle', 'Middle button');
    if (key === 'Space') return t('customShortcutKeySpace', 'Space');
    const modifier = (isMac ? MAC_MODIFIER_LABELS : MODIFIER_LABELS)[key];
    if (modifier) return modifier;
    // KeyboardEvent.code sugar: the prefixes carry no information for a reader.
    if (/^Key[A-Z]$/.test(key)) return key.slice(3);
    if (/^Digit[0-9]$/.test(key)) return key.slice(5);
    if (/^Numpad/.test(key)) return `Num ${key.slice(6)}`;
    if (/^Arrow/.test(key)) return key.slice(5);
    return key;
}

/**
 * Human label for a whole combo.
 *
 * A one-key combo keeps the spelled-out form ("Ctrl", "⌃ Control") — it has to
 * send the user hunting for one physical key. From two keys up that would read
 * as a sentence, so macOS switches to the symbols it writes shortcuts with
 * (⌃⇧Y) and everything else joins the names with `+` (Ctrl+Shift+Y).
 */
export function comboLabel(combo: string, t: TFn, isMac = false): string {
    const parts = comboKeys(combo);
    if (parts.length <= 1) return keyLabel(combo, t, isMac);
    if (!isMac) return parts.map((p) => keyLabel(p, t, false)).join('+');
    const head = parts.filter(isModifierToken).map((m) => MAC_MODIFIER_SYMBOLS[m] ?? m).join('');
    const rest = parts.filter((p) => !isModifierToken(p)).map((p) => keyLabel(p, t, true));
    if (rest.length === 0) return head;
    const tail = rest.join('+');
    // "⌃⇧Y" reads as one chord; "⌃⇧Middle button" would read as one word.
    return tail.length === 1 ? head + tail : `${head} ${tail}`;
}

/**
 * Human label for a gesture — also the auto-generated name of a new custom
 * shortcut ("名字" defaults to this and is then freely editable).
 *
 * One naming scheme for every language: the interpolated templates live in the
 * locale files, so English and everything that falls back to it read
 * "Double-tap Space" while zh-CN reads "双击空格".
 */
export function shortcutLabel(def: ShortcutDef, t: TFn, isMac = false): string {
    const key = comboLabel(def.key, t, isMac);
    switch (def.trigger) {
        case GESTURE_TRIGGER.HOLD:
            return t('customShortcutNameHold', 'Hold {{key}}', { key });
        case GESTURE_TRIGGER.MULTI:
            switch (def.count) {
                case 3: return t('customShortcutNameMulti3', 'Triple-tap {{key}}', { key });
                case 4: return t('customShortcutNameMulti4', 'Quadruple-tap {{key}}', { key });
                default: return t('customShortcutNameMulti2', 'Double-tap {{key}}', { key });
            }
        default:
            return t('customShortcutNameClick', 'Click {{key}}', { key });
    }
}

// --- normalization ----------------------------------------------------------
//
// Stored values can arrive from an older build or from another device's sync
// snapshot, so nothing read out of storage is trusted. A record that cannot be
// repaired into something meaningful is dropped rather than allowed to reach
// the recognizer.

const clamp = (n: unknown, { min, max, def }: { min: number; max: number; def: number }): number => {
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : def;
    return Math.min(max, Math.max(min, v));
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function normalizeTrigger(v: unknown): GESTURE_TRIGGER {
    return v === GESTURE_TRIGGER.MULTI || v === GESTURE_TRIGGER.HOLD ? v : GESTURE_TRIGGER.CLICK;
}

export function normalizeCustomShortcut(raw: unknown): CustomShortcut | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = str(o.id);
    const key = normalizeCombo(str(o.key));
    // No id → nothing can reference it; no key → nothing can trigger it.
    if (!id || !key) return null;
    const trigger = normalizeTrigger(o.trigger);
    return {
        id,
        key,
        trigger,
        name: str(o.name),
        count: trigger === GESTURE_TRIGGER.MULTI ? clamp(o.count, MULTI_COUNT) : MULTI_COUNT.def,
        interval: clamp(o.interval, MULTI_INTERVAL_MS),
        holdMs: clamp(o.holdMs, HOLD_MS),
    };
}

export function normalizeCustomShortcuts(raw: unknown): CustomShortcut[] {
    if (!Array.isArray(raw)) return [];
    const out: CustomShortcut[] = [];
    const seen = new Set<string>();
    for (const el of raw) {
        const s = normalizeCustomShortcut(el);
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        out.push(s);
    }
    return out;
}

const ACTIONS = new Set<string>(CUSTOM_SHORTCUT_ACTION_OPTIONS.map((o) => o.value));

export function normalizeBinding(raw: unknown): ShortcutBinding | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const id = str(o.id);
    if (!id) return null;
    const action = str(o.action);
    return {
        id,
        action: (ACTIONS.has(action) ? action : CUSTOM_SHORTCUT_ACTION_OPTIONS[0].value) as CUSTOM_SHORTCUT_ACTION,
        shortcutId: str(o.shortcutId) || SHORTCUT_NONE,
    };
}

export function normalizeBindings(raw: unknown): ShortcutBinding[] {
    if (!Array.isArray(raw)) return [];
    const out: ShortcutBinding[] = [];
    const seen = new Set<string>();
    for (const el of raw) {
        const b = normalizeBinding(el);
        if (!b || seen.has(b.id)) continue;
        seen.add(b.id);
        out.push(b);
    }
    return out;
}

// --- resolution -------------------------------------------------------------

/** Look one shortcut id up across both tiers. `null` for NONE / a dangling id. */
export function findShortcut(id: string, custom: CustomShortcut[]): ShortcutDef | null {
    if (!id || id === SHORTCUT_NONE) return null;
    return BUILTIN_BY_ID.get(id) ?? custom.find((s) => s.id === id) ?? null;
}

/**
 * The gestures the recognizer must watch: one per DISTINCT shortcut actually
 * referenced by a binding.
 *
 * Deduped on purpose — a shortcut bound to two functions must stay ONE gesture,
 * otherwise the recognizer's per-key plan would silently keep whichever it saw
 * first. Which of the bound actions runs is decided afterwards, by
 * {@link actionsForGesture}.
 */
export function resolveGestures(custom: CustomShortcut[], bindings: ShortcutBinding[]): ShortcutDef[] {
    const out: ShortcutDef[] = [];
    const seen = new Set<string>();
    for (const b of bindings) {
        if (seen.has(b.shortcutId)) continue;
        const def = findShortcut(b.shortcutId, custom);
        if (!def) continue;
        seen.add(b.shortcutId);
        out.push(def);
    }
    return out;
}

/**
 * The actions bound to one gesture, in the user's own list order.
 *
 * A list rather than a single action because the same gesture may be bound
 * twice. The caller runs them in order and stops at the first whose
 * precondition holds (a selection exists, an input is focused, …) — the same
 * "one action per gesture, priority order" rule the double-tap modifier uses,
 * except the priority here is the order the user arranged the rows in.
 */
export function actionsForGesture(shortcutId: string, bindings: ShortcutBinding[]): CUSTOM_SHORTCUT_ACTION[] {
    return bindings.filter((b) => b.shortcutId === shortcutId).map((b) => b.action);
}

/**
 * Do two definitions describe the same physical gesture? Used for conflict
 * warnings. Combos compare as plain strings because `normalizeCombo` gives
 * equal gestures equal spellings.
 */
export function sameGesture(a: ShortcutDef, b: ShortcutDef): boolean {
    if (a.key !== b.key || a.trigger !== b.trigger) return false;
    return a.trigger !== GESTURE_TRIGGER.MULTI || a.count === b.count;
}
