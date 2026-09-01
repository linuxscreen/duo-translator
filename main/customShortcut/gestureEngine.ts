// ---------------------------------------------------------------------------
// Gesture recognizer for the custom shortcuts.
//
// DOM-free on purpose: content.ts owns the listeners (they must be registered
// in content()'s first synchronous pass — see CLAUDE.md) and feeds press /
// release here. That split is also what makes this testable without a browser.
//
// Recognition is SYNCHRONOUS. Timing is the whole feature, so nothing in here
// may await; the caller awaits `startupReady` around the *action* instead, the
// same shape the double-tap modifier already uses.
//
// The unit of matching is a COMBO — a SET of keys held at once, not a single
// key. That is what makes `Ctrl+Shift+Y` and a bare `Space` the same mechanism:
// a combo is "down" exactly while the set of pressed keys EQUALS its own set.
// Exact equality, not superset, so `Ctrl+Shift+Y` cannot also fire a `Ctrl+Y`
// gesture — and, as a free consequence, pressing any key outside a combo ends
// it, which is precisely the rule that keeps real shortcuts (Ctrl+C) out of the
// recognizer without a separate "break the sequence" pass.
// ---------------------------------------------------------------------------

import {
    GESTURE_TRIGGER,
    MODIFIER_FLAGS,
    comboKeys,
    type ModifierState,
    type ShortcutDef,
} from './types';

/** Everything that can happen on one combo, precompiled once per config change. */
type ComboPlan = {
    keys: Set<string>;
    /**
     * At most one hold gesture per combo: the SMALLEST threshold wins.
     *
     * Two holds on one combo would otherwise both fire on a long press (the
     * 500ms one, then the 1500ms one), which is not a staged gesture — it is
     * two actions the user did not ask for. Firing the shortest is also the
     * only choice available at press time, since the future length of the press
     * is unknown.
     */
    hold: ShortcutDef | null;
    /** Press-count → gesture. CLICK lives here under 1, so both share one path. */
    byCount: Map<number, ShortcutDef>;
    /** Highest count anyone asked for; reaching it fires immediately. */
    maxCount: number;
    /** How long to wait for another press before settling on the current count. */
    waitMs: number;
};

type ComboState = {
    /** The combo is currently held down in full. */
    active: boolean;
    holdTimer: number | null;
    /** The hold already fired, so the upcoming release must not also click. */
    holdFired: boolean;
    count: number;
    seqTimer: number | null;
};

export type GestureEngine = {
    /** Recompile the watch list. Any in-flight sequence is dropped. */
    setGestures(defs: ShortcutDef[]): void;
    /**
     * Would pressing `key` right now complete some combo? Callers use it to
     * decide whether to preventDefault — asking about the whole combo rather
     * than the key alone is what lets `Ctrl+MouseMiddle` leave a plain
     * middle-click alone.
     */
    wouldActivate(key: string, mods?: ModifierState): boolean;
    /** A key went down. Feed EVERY key: an unwatched one is what ends a combo. */
    press(key: string, mods?: ModifierState): void;
    /** A key came up. */
    release(key: string, mods?: ModifierState): void;
    /** Drop all in-flight state (window blur, tab hidden). */
    reset(): void;
};

function buildPlans(defs: ShortcutDef[]): Map<string, ComboPlan> {
    const plans = new Map<string, ComboPlan>();
    for (const def of defs) {
        const keys = comboKeys(def.key);
        if (keys.length === 0) continue;
        let plan = plans.get(def.key);
        if (!plan) {
            plan = {
                keys: new Set(keys),
                hold: null,
                byCount: new Map(),
                maxCount: 0,
                // Starts at zero, NOT at the shipped default: the loop below
                // raises it to the slowest gesture actually on this combo, and
                // seeding it with the default would be a silent floor — a
                // gesture configured tighter than 400ms would keep the 400ms
                // window and its setting would do nothing. A combo with no
                // multi-tap never reads this (its only count is its max, so it
                // fires on release instead of waiting).
                waitMs: 0,
            };
            plans.set(def.key, plan);
        }
        if (def.trigger === GESTURE_TRIGGER.HOLD) {
            if (!plan.hold || def.holdMs < plan.hold.holdMs) plan.hold = def;
            continue;
        }
        const count = def.trigger === GESTURE_TRIGGER.MULTI ? def.count : 1;
        // First definition wins on a duplicate — the config UI warns about
        // these, and silently preferring the later one would be arbitrary.
        if (!plan.byCount.has(count)) plan.byCount.set(count, def);
        plan.maxCount = Math.max(plan.maxCount, count);
        // The wait must accommodate the SLOWEST gesture on this combo,
        // otherwise a generous 800ms triple-tap would be cut short by a strict
        // 200ms double-tap sharing it. The flip side is that binding both puts
        // the tighter one on the looser one's window — inherent to the window
        // being per combo, and the looser tolerance is the safe direction.
        if (def.trigger === GESTURE_TRIGGER.MULTI) plan.waitMs = Math.max(plan.waitMs, def.interval);
    }
    return plans;
}

const sameSet = (a: Set<string>, b: Set<string>): boolean => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
};

/**
 * @param onGesture Fired with the shortcut's id the moment its gesture completes.
 */
export function createGestureEngine(onGesture: (shortcutId: string) => void): GestureEngine {
    let plans = new Map<string, ComboPlan>();
    const states = new Map<string, ComboState>();
    /**
     * Every key currently held, watched or not.
     *
     * It has to include keys no gesture cares about: matching is by exact set,
     * so a stray Shift is exactly what must stop a bare-Space gesture from
     * firing while the user types a capital letter.
     */
    const down = new Set<string>();

    const stateOf = (combo: string): ComboState => {
        let s = states.get(combo);
        if (!s) {
            s = { active: false, holdTimer: null, holdFired: false, count: 0, seqTimer: null };
            states.set(combo, s);
        }
        return s;
    };

    const clearTimers = (s: ComboState) => {
        if (s.holdTimer !== null) { clearTimeout(s.holdTimer); s.holdTimer = null; }
        if (s.seqTimer !== null) { clearTimeout(s.seqTimer); s.seqTimer = null; }
    };

    /** Abandon a combo entirely — no gesture fires, the tap count is lost. */
    const cancel = (s: ComboState) => {
        clearTimers(s);
        s.active = false;
        s.holdFired = false;
        s.count = 0;
    };

    const reset = () => {
        for (const s of states.values()) cancel(s);
        down.clear();
    };

    const fire = (id: string) => {
        try {
            onGesture(id);
        } catch {
            // A throwing consumer must not leave the recognizer wedged mid-state.
        }
    };

    /** Settle a finished tap sequence: fire whatever matches this count, if anything. */
    const settle = (combo: string) => {
        const s = stateOf(combo);
        s.seqTimer = null;
        const hit = plans.get(combo)?.byCount.get(s.count);
        s.count = 0;
        if (hit) fire(hit.id);
    };

    const beginCombo = (combo: string, plan: ComboPlan) => {
        const s = stateOf(combo);
        if (s.active) return;
        // A new press continues the sequence, so the pending settle must not
        // fire underneath it.
        if (s.seqTimer !== null) { clearTimeout(s.seqTimer); s.seqTimer = null; }
        s.active = true;
        s.holdFired = false;
        if (plan.hold) {
            const def = plan.hold;
            s.holdTimer = setTimeout(() => {
                s.holdTimer = null;
                s.holdFired = true;
                // A completed hold consumes the press: the release that ends it
                // is not also a click.
                s.count = 0;
                fire(def.id);
            }, def.holdMs) as unknown as number;
        }
    };

    const endCombo = (combo: string, plan: ComboPlan) => {
        const s = stateOf(combo);
        if (!s.active) return;
        s.active = false;
        if (s.holdTimer !== null) { clearTimeout(s.holdTimer); s.holdTimer = null; }
        if (s.holdFired) {
            s.holdFired = false;
            s.count = 0;
            return;
        }
        if (plan.maxCount === 0) return; // hold-only combo
        s.count += 1;
        if (s.count >= plan.maxCount) {
            const hit = plan.byCount.get(s.count);
            s.count = 0;
            if (hit) fire(hit.id);
            return;
        }
        // Not the longest gesture on this combo yet — wait to see whether the
        // user is on their way to it. This is why a plain press on a combo that
        // ALSO carries a double-tap is delayed rather than instant.
        s.seqTimer = setTimeout(() => settle(combo), plan.waitMs) as unknown as number;
    };

    /** A key left the pressed set: end every combo that contained it. */
    const lift = (key: string) => {
        if (!down.delete(key)) return;
        for (const [combo, plan] of plans) {
            if (plan.keys.has(key)) endCombo(combo, plan);
        }
    };

    /**
     * Reconcile the four modifiers against what the event says is held.
     *
     * Not paranoia: a modifier can go down or up while the page has no focus,
     * and macOS suppresses `keyup` for other keys while Command is held — both
     * leave `down` describing a world that no longer exists, and exact-set
     * matching then silently stops working. `except` is the key this very event
     * is about, which the caller handles itself.
     */
    const syncModifiers = (mods: ModifierState | undefined, except: string) => {
        if (!mods) return;
        for (const [token, flag] of MODIFIER_FLAGS) {
            if (token === except) continue;
            const held = mods[flag];
            if (held) down.add(token);
            else if (down.has(token)) lift(token);
        }
    };

    return {
        setGestures(defs: ShortcutDef[]) {
            // Cancel BEFORE dropping the states: clearing the map first would
            // orphan the running timers, and an armed hold would still fire —
            // with the id of a gesture the user just deleted.
            for (const s of states.values()) cancel(s);
            states.clear();
            plans = buildPlans(defs);
            // `down` survives: which keys are physically held did not change.
        },

        wouldActivate(key: string, mods?: ModifierState): boolean {
            if (plans.size === 0) return false;
            const probe = new Set(down);
            if (mods) {
                for (const [token, flag] of MODIFIER_FLAGS) {
                    if (token === key) continue;
                    if (mods[flag]) probe.add(token);
                    else probe.delete(token);
                }
            }
            probe.add(key);
            for (const plan of plans.values()) {
                if (sameSet(probe, plan.keys)) return true;
            }
            return false;
        },

        press(key: string, mods?: ModifierState) {
            syncModifiers(mods, key);
            // Guard against a repeat/duplicate down with no intervening up
            // (auto-repeat is filtered by the caller, but a page may synthesize).
            if (down.has(key)) return;
            down.add(key);
            for (const [combo, plan] of plans) {
                // A key outside the combo ends it: mid-hold it cancels the hold,
                // mid-sequence it throws the tap count away. This one line is
                // what keeps Ctrl+C from ever looking like a Ctrl gesture.
                if (!plan.keys.has(key)) {
                    cancel(stateOf(combo));
                    continue;
                }
                if (sameSet(down, plan.keys)) beginCombo(combo, plan);
            }
        },

        release(key: string, mods?: ModifierState) {
            syncModifiers(mods, key);
            lift(key);
        },

        reset,
    };
}
