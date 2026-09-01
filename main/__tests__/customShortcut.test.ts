// Custom shortcuts: the gesture recognizer (main/customShortcut/gestureEngine.ts)
// and the shared data model (main/customShortcut/types.ts). Both are pure — no
// DOM, no storage — so this suite is the real coverage for the timing rules.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGestureEngine } from "@/main/customShortcut/gestureEngine";
import { browserShortcutsFrom, commandShortcutToCombo } from "@/main/customShortcut/browserShortcuts";
import {
    BUILTIN_SHORTCUTS,
    CUSTOM_SHORTCUT_ACTION,
    GESTURE_TRIGGER,
    HOLD_MS,
    MOUSE_MIDDLE_KEY,
    MULTI_COUNT,
    MULTI_INTERVAL_MS,
    SHORTCUT_NONE,
    actionsForGesture,
    buildCombo,
    comboLabel,
    findShortcut,
    gestureKeyOf,
    keyLabel,
    normalizeCombo,
    normalizeBindings,
    normalizeCustomShortcuts,
    resolveGestures,
    sameGesture,
    shortcutLabel,
    type CustomShortcut,
    type ModifierState,
    type ShortcutBinding,
    type ShortcutDef,
} from "@/main/customShortcut/types";
import {
    extendTypedRun,
    typedRunForShortcut,
    type TypedKey,
    type TypedRun,
} from "@/main/customShortcut/typedRun";

/** Modifier flags as an event would report them. */
const mods = (held: string[] = []): ModifierState => ({
    ctrlKey: held.includes("Control"),
    altKey: held.includes("Alt"),
    shiftKey: held.includes("Shift"),
    metaKey: held.includes("Meta"),
});

const def = (over: Partial<ShortcutDef> & { id: string; key: string }): ShortcutDef => ({
    trigger: GESTURE_TRIGGER.CLICK,
    count: MULTI_COUNT.def,
    interval: MULTI_INTERVAL_MS.def,
    holdMs: HOLD_MS.def,
    ...over,
});

describe("gesture engine", () => {
    let fired: string[];
    let engine: ReturnType<typeof createGestureEngine>;

    beforeEach(() => {
        vi.useFakeTimers();
        fired = [];
        engine = createGestureEngine((id) => fired.push(id));
    });
    afterEach(() => vi.useRealTimers());

    const tap = (key: string) => {
        engine.press(key);
        engine.release(key);
    };

    it("fires a single press immediately when nothing longer shares the key", () => {
        engine.setGestures([def({ id: "g", key: MOUSE_MIDDLE_KEY })]);
        tap(MOUSE_MIDDLE_KEY);
        expect(fired).toEqual(["g"]);
    });

    it("fires a double tap on the second release, with no wait", () => {
        engine.setGestures([
            def({ id: "g", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        tap("Space");
        expect(fired).toEqual([]);
        tap("Space");
        expect(fired).toEqual(["g"]);
    });

    it("does not fire when the taps are further apart than the interval", () => {
        engine.setGestures([
            def({ id: "g", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        tap("Space");
        vi.advanceTimersByTime(401);
        tap("Space");
        expect(fired).toEqual([]);
    });

    // The reason the recognizer is fed EVERY key, watched or not.
    it("a different key breaks the sequence, so real combos never trigger", () => {
        engine.setGestures([
            def({ id: "g", key: "Control", trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        tap("Control");
        engine.press("KeyC"); // Ctrl+C
        engine.release("KeyC");
        tap("Control");
        expect(fired).toEqual([]);
    });

    it("holds fire while still held, and the release that ends them is not a click", () => {
        engine.setGestures([
            def({ id: "hold", key: "Control", trigger: GESTURE_TRIGGER.HOLD, holdMs: 500 }),
            def({ id: "click", key: "Control" }),
        ]);
        engine.press("Control");
        vi.advanceTimersByTime(499);
        expect(fired).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(fired).toEqual(["hold"]);
        engine.release("Control");
        vi.runAllTimers();
        expect(fired).toEqual(["hold"]);
    });

    it("a short press on a hold+click key is a click, not a hold", () => {
        engine.setGestures([
            def({ id: "hold", key: "Control", trigger: GESTURE_TRIGGER.HOLD, holdMs: 500 }),
            def({ id: "click", key: "Control" }),
        ]);
        engine.press("Control");
        vi.advanceTimersByTime(100);
        engine.release("Control");
        vi.runAllTimers();
        expect(fired).toEqual(["click"]);
    });

    it("pressing another key cancels an armed hold", () => {
        engine.setGestures([def({ id: "hold", key: "Control", trigger: GESTURE_TRIGGER.HOLD, holdMs: 500 })]);
        engine.press("Control");
        engine.press("KeyC");
        vi.advanceTimersByTime(1000);
        expect(fired).toEqual([]);
    });

    // A key carrying both 2x and 3x must not let the shorter one preempt the
    // longer one; the 2x therefore waits out the window.
    it("double and triple on one key resolve by waiting", () => {
        engine.setGestures([
            def({ id: "d", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
            def({ id: "tr", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 3, interval: 400 }),
        ]);
        tap("Space");
        tap("Space");
        expect(fired).toEqual([]);
        vi.advanceTimersByTime(400);
        expect(fired).toEqual(["d"]);

        fired.length = 0;
        tap("Space");
        tap("Space");
        tap("Space");
        expect(fired).toEqual(["tr"]);
    });

    it("a single press on a key that also carries a double tap waits, then fires once", () => {
        engine.setGestures([
            def({ id: "c", key: MOUSE_MIDDLE_KEY }),
            def({ id: "d", key: MOUSE_MIDDLE_KEY, trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        tap(MOUSE_MIDDLE_KEY);
        expect(fired).toEqual([]);
        vi.advanceTimersByTime(400);
        expect(fired).toEqual(["c"]);
    });

    it("the shortest hold wins when a key carries two", () => {
        engine.setGestures([
            def({ id: "long", key: "Control", trigger: GESTURE_TRIGGER.HOLD, holdMs: 1500 }),
            def({ id: "short", key: "Control", trigger: GESTURE_TRIGGER.HOLD, holdMs: 500 }),
        ]);
        engine.press("Control");
        vi.advanceTimersByTime(2000);
        expect(fired).toEqual(["short"]);
    });

    it("wouldActivate() answers for the whole combo, not the key alone", () => {
        engine.setGestures([def({ id: "g", key: MOUSE_MIDDLE_KEY })]);
        expect(engine.wouldActivate(MOUSE_MIDDLE_KEY, mods())).toBe(true);
        expect(engine.wouldActivate("Space", mods())).toBe(false);
        // A held modifier makes the pressed set bigger than the combo.
        expect(engine.wouldActivate(MOUSE_MIDDLE_KEY, mods(["Control"]))).toBe(false);
        engine.setGestures([]);
        expect(engine.wouldActivate(MOUSE_MIDDLE_KEY, mods())).toBe(false);
    });

    // The reason content.ts asks wouldActivate() instead of "is this button
    // watched": a Ctrl+middle gesture must leave a plain middle-click — and
    // therefore open-link-in-new-tab — completely alone.
    it("a modified mouse gesture does not claim the bare button", () => {
        engine.setGestures([def({ id: "g", key: buildCombo(["Control"], MOUSE_MIDDLE_KEY) })]);
        expect(engine.wouldActivate(MOUSE_MIDDLE_KEY, mods())).toBe(false);
        expect(engine.wouldActivate(MOUSE_MIDDLE_KEY, mods(["Control"]))).toBe(true);
    });

    it("turning the feature off mid-sequence cannot fire the removed gesture", () => {
        const g = def({ id: "g", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 });
        engine.setGestures([g]);
        tap("Space");
        engine.setGestures([]);
        engine.setGestures([g]);
        tap("Space");
        vi.runAllTimers();
        expect(fired).toEqual([]);
    });

    it("reset() drops a latched press so it cannot pair with the next one", () => {
        engine.setGestures([
            def({ id: "g", key: MOUSE_MIDDLE_KEY, trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        tap(MOUSE_MIDDLE_KEY);
        engine.reset();
        tap(MOUSE_MIDDLE_KEY);
        vi.runAllTimers();
        expect(fired).toEqual([]);
    });

    it("a duplicate press with no release in between is ignored", () => {
        engine.setGestures([def({ id: "g", key: MOUSE_MIDDLE_KEY })]);
        engine.press(MOUSE_MIDDLE_KEY);
        engine.press(MOUSE_MIDDLE_KEY);
        engine.release(MOUSE_MIDDLE_KEY);
        vi.runAllTimers();
        expect(fired).toEqual(["g"]);
    });
});

describe("combos", () => {
    let fired: string[];
    let engine: ReturnType<typeof createGestureEngine>;

    beforeEach(() => {
        vi.useFakeTimers();
        fired = [];
        engine = createGestureEngine((id) => fired.push(id));
    });
    afterEach(() => vi.useRealTimers());

    const CTRL_Y = buildCombo(["Control"], "KeyY");

    it("fires only while every key of the combo is held", () => {
        engine.setGestures([def({ id: "g", key: CTRL_Y })]);
        engine.press("Control");
        engine.press("KeyY");
        engine.release("KeyY");
        expect(fired).toEqual(["g"]);
    });

    it("does not fire from the main key alone", () => {
        engine.setGestures([def({ id: "g", key: CTRL_Y })]);
        engine.press("KeyY");
        engine.release("KeyY");
        vi.runAllTimers();
        expect(fired).toEqual([]);
    });

    // Exact-set matching, not "contains": this is what stops a longer combo
    // from also firing every shorter one inside it.
    it("an extra held modifier is a different gesture", () => {
        engine.setGestures([def({ id: "g", key: CTRL_Y })]);
        engine.press("Control");
        engine.press("Shift");
        engine.press("KeyY");
        engine.release("KeyY");
        vi.runAllTimers();
        expect(fired).toEqual([]);
    });

    it("a bare-key gesture stays quiet while a modifier is held", () => {
        engine.setGestures([def({ id: "g", key: "Space" })]);
        engine.press("Shift");
        engine.press("Space");
        engine.release("Space");
        vi.runAllTimers();
        expect(fired).toEqual([]);
    });

    it("multi-tap works with the modifier held down throughout", () => {
        engine.setGestures([
            def({ id: "g", key: CTRL_Y, trigger: GESTURE_TRIGGER.MULTI, count: 2, interval: 400 }),
        ]);
        engine.press("Control");
        engine.press("KeyY");
        engine.release("KeyY");
        expect(fired).toEqual([]);
        engine.press("KeyY");
        engine.release("KeyY");
        expect(fired).toEqual(["g"]);
    });

    it("a modifiers-only combo is a real gesture", () => {
        engine.setGestures([
            def({ id: "g", key: buildCombo(["Control", "Shift"], null), trigger: GESTURE_TRIGGER.HOLD, holdMs: 500 }),
        ]);
        engine.press("Control");
        vi.advanceTimersByTime(600);
        expect(fired).toEqual([]); // not the full combo yet
        engine.press("Shift");
        vi.advanceTimersByTime(499);
        expect(fired).toEqual([]);
        vi.advanceTimersByTime(1);
        expect(fired).toEqual(["g"]);
    });

    // A modifier can go up while the page has no focus, and macOS suppresses
    // keyup for other keys while Command is held. Either leaves the pressed set
    // describing a world that no longer exists, and exact matching then stops
    // working silently — which is what the event's own flags repair.
    it("repairs the pressed set from the event's modifier flags", () => {
        engine.setGestures([def({ id: "g", key: "Space" })]);
        engine.press("Control", mods(["Control"]));   // Ctrl goes down…
        engine.press("Space", mods());                // …and was released off-page
        engine.release("Space", mods());
        expect(fired).toEqual(["g"]);
    });
});

describe("key tokens", () => {
    it("keeps modifiers side-agnostic and everything else layout-agnostic", () => {
        expect(gestureKeyOf({ key: "Control", code: "ControlRight" })).toBe("Control");
        expect(gestureKeyOf({ key: "a", code: "KeyA" })).toBe("KeyA");
        expect(gestureKeyOf({ key: " ", code: "Space" })).toBe("Space");
    });
});

describe("combo serialization", () => {
    it("orders modifiers canonically and drops duplicates", () => {
        expect(buildCombo(["Shift", "Control"], "KeyY")).toBe("Control+Shift+KeyY");
        expect(normalizeCombo("Shift+Control+KeyY")).toBe("Control+Shift+KeyY");
        expect(normalizeCombo("Control+Control")).toBe("Control");
        // Only one ordinary key can be held meaningfully; extras are dropped.
        expect(normalizeCombo("KeyA+KeyB")).toBe("KeyA");
        expect(normalizeCombo("")).toBe("");
    });

    // The single-key spelling is unchanged from the pre-combo version, which is
    // what makes every stored shortcut and every built-in migrate for free.
    it("leaves a lone key byte-identical", () => {
        for (const k of ["Control", "Space", MOUSE_MIDDLE_KEY]) {
            expect(normalizeCombo(k)).toBe(k);
        }
    });
});

describe("labels", () => {
    // A stand-in for i18next's t(key, fallback, vars): the fallback with the
    // variables filled in, i.e. exactly what a locale without the key renders.
    const t = (_k: string, fallback: string, vars?: Record<string, unknown>) =>
        fallback.replace(/\{\{(\w+)\}\}/g, (_, n) => String(vars?.[n] ?? ""));

    it("names the built-ins the way the picker lists them", () => {
        const label = (id: string) => shortcutLabel(BUILTIN_SHORTCUTS.find((s) => s.id === id)!, t);
        expect(label("holdCtrl")).toBe("Hold Ctrl");
        expect(label("middleClick")).toBe("Click Middle button");
        expect(label("holdMiddle")).toBe("Hold Middle button");
        expect(label("doubleMiddle")).toBe("Double-tap Middle button");
        expect(label("tripleSpace")).toBe("Triple-tap Space");
    });

    it("draws modifiers by their keycap on macOS", () => {
        expect(keyLabel("Control", t, false)).toBe("Ctrl");
        expect(keyLabel("Control", t, true)).toBe("⌃ Control");
        expect(keyLabel("KeyQ", t)).toBe("Q");
        expect(keyLabel("Digit7", t)).toBe("7");
    });

    it("spells combos out off macOS and as a chord on it", () => {
        const combo = buildCombo(["Control", "Shift"], "KeyY");
        expect(comboLabel(combo, t, false)).toBe("Ctrl+Shift+Y");
        expect(comboLabel(combo, t, true)).toBe("⌃⇧Y");
        // A multi-character key name would run into the symbols, so it keeps a gap.
        expect(comboLabel(buildCombo(["Control"], MOUSE_MIDDLE_KEY), t, true)).toBe("⌃ Middle button");
        // One key keeps the spelled-out form — it has to be found on a keyboard.
        expect(comboLabel("Control", t, true)).toBe("⌃ Control");
    });

    it("names a 4x gesture", () => {
        expect(shortcutLabel(def({ id: "x", key: "KeyJ", trigger: GESTURE_TRIGGER.MULTI, count: 4 }), t))
            .toBe("Quadruple-tap J");
    });
});

describe("normalization", () => {
    it("drops records that can never work and clamps the rest", () => {
        const out = normalizeCustomShortcuts([
            null,
            { key: "Space" },                                   // no id
            { id: "a" },                                        // no key
            { id: "b", key: "Space", trigger: "multi", count: 99, interval: 5, holdMs: 99999 },
            { id: "b", key: "KeyX" },                           // duplicate id
        ]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            id: "b",
            count: MULTI_COUNT.max,
            interval: MULTI_INTERVAL_MS.min,
            holdMs: HOLD_MS.max,
        });
    });

    it("falls back to the default action and to NONE for a garbled binding", () => {
        const out = normalizeBindings([{ id: "x", action: "nope", shortcutId: 0 }]);
        expect(out).toEqual([
            { id: "x", action: CUSTOM_SHORTCUT_ACTION.TRANSLATE_SELECTION, shortcutId: SHORTCUT_NONE },
        ]);
    });
});

describe("resolution", () => {
    const custom: CustomShortcut[] = [
        { ...def({ id: "mine", key: "KeyG" }), name: "Mine" },
    ];
    const bind = (action: CUSTOM_SHORTCUT_ACTION, shortcutId: string, id = shortcutId + action): ShortcutBinding =>
        ({ id, action, shortcutId });

    it("resolves built-ins and customs, and skips NONE / dangling ids", () => {
        expect(findShortcut("holdCtrl", custom)?.trigger).toBe(GESTURE_TRIGGER.HOLD);
        expect(findShortcut("mine", custom)?.key).toBe("KeyG");
        expect(findShortcut(SHORTCUT_NONE, custom)).toBeNull();
        expect(findShortcut("gone", custom)).toBeNull();
    });

    // The dedupe is load-bearing: two specs for one gesture would collide in
    // the recognizer's per-key plan and one of them would be silently dropped.
    it("emits ONE gesture for a shortcut bound to two functions", () => {
        const bindings = [
            bind(CUSTOM_SHORTCUT_ACTION.TRANSLATE_SELECTION, "holdCtrl"),
            bind(CUSTOM_SHORTCUT_ACTION.TRANSLATE_INPUT, "holdCtrl"),
            bind(CUSTOM_SHORTCUT_ACTION.TOGGLE_PARAGRAPH, SHORTCUT_NONE),
        ];
        expect(resolveGestures(custom, bindings).map((d) => d.id)).toEqual(["holdCtrl"]);
        expect(actionsForGesture("holdCtrl", bindings)).toEqual([
            CUSTOM_SHORTCUT_ACTION.TRANSLATE_SELECTION,
            CUSTOM_SHORTCUT_ACTION.TRANSLATE_INPUT,
        ]);
    });

    it("compares gestures by what the user physically does", () => {
        const a = def({ id: "a", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2 });
        expect(sameGesture(a, def({ id: "b", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 2 }))).toBe(true);
        expect(sameGesture(a, def({ id: "b", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 3 }))).toBe(false);
        expect(sameGesture(a, def({ id: "b", key: "KeyA", trigger: GESTURE_TRIGGER.MULTI, count: 2 }))).toBe(false);
        // Count is irrelevant outside MULTI — two holds on one key are the same
        // gesture no matter what `count` happens to be carrying.
        const h = def({ id: "a", key: "Control", trigger: GESTURE_TRIGGER.HOLD, count: 2 });
        expect(sameGesture(h, def({ id: "b", key: "Control", trigger: GESTURE_TRIGGER.HOLD, count: 4 }))).toBe(true);
    });
});

// --- browser-level shortcuts ------------------------------------------------
//
// A `chrome.commands` shortcut is handled by the BROWSER, so a page gesture on
// the same combo can never fire. Translating the command syntax into combo form
// is what lets the editor say so instead of leaving the user with a shortcut
// that silently does nothing (this extension's own Alt+W, in practice).

describe("browser shortcut parsing", () => {
    it("translates the command syntax into gesture combos", () => {
        expect(commandShortcutToCombo("Alt+W", false)).toBe("Alt+KeyW");
        expect(commandShortcutToCombo("Ctrl+Shift+Y", false)).toBe("Control+Shift+KeyY");
        expect(commandShortcutToCombo("Command+Shift+1", true)).toBe("Shift+Meta+Digit1");
        expect(commandShortcutToCombo("Alt+Up", false)).toBe("Alt+ArrowUp");
        expect(commandShortcutToCombo("F5", false)).toBe("F5");
        expect(commandShortcutToCombo("Ctrl+Period", false)).toBe("Control+Period");
    });

    it("orders modifiers canonically, so comparison is a string equality", () => {
        expect(commandShortcutToCombo("Shift+Alt+W", false)).toBe("Alt+Shift+KeyW");
    });

    it("reads Ctrl as Command on macOS, and MacCtrl as the real Control key", () => {
        // Not a quirk of ours: the command syntax defines it that way, and
        // reading it literally would warn about a combo the user never bound.
        expect(commandShortcutToCombo("Ctrl+Y", true)).toBe("Meta+KeyY");
        expect(commandShortcutToCombo("MacCtrl+Y", true)).toBe("Control+KeyY");
        expect(commandShortcutToCombo("Ctrl+Y", false)).toBe("Control+KeyY");
    });

    it("answers null rather than guessing — no warning beats a wrong one", () => {
        expect(commandShortcutToCombo("", false)).toBeNull();
        expect(commandShortcutToCombo("Search+A", false)).toBeNull();
        // Modifiers alone are not something the browser can register.
        expect(commandShortcutToCombo("Ctrl", false)).toBeNull();
        expect(commandShortcutToCombo("Ctrl+A+B", false)).toBeNull();
        expect(commandShortcutToCombo("Ctrl+F13", false)).toBeNull();
    });

    it("drops unassigned and unparsable commands, and names the rest", () => {
        expect(
            browserShortcutsFrom(
                [
                    { name: "workbench", description: "AI workbench", shortcut: "Alt+W" },
                    // No key bound — collides with nothing.
                    { name: "translate", description: "Translate", shortcut: "" },
                    { name: "chromeos", description: "ChromeOS", shortcut: "Search+A" },
                    // Falls back to the command name when the browser gives no
                    // description; a nameless warning helps nobody.
                    { name: "bare", shortcut: "Alt+Q" },
                ],
                false,
            ),
        ).toEqual([
            { combo: "Alt+KeyW", label: "AI workbench" },
            { combo: "Alt+KeyQ", label: "bare" },
        ]);
    });
});

// --- typed run (the characters a printable-key shortcut inserts) ------------
//
// main/customShortcut/typedRun.ts. Every way of getting this wrong is silent:
// too few characters leaves a space in the user's text, too many makes
// removeTypedEcho's verification fail and leaves ALL of them behind.
// A gesture configured TIGHTER than the shipped default has to actually get
// that window. The per-combo wait used to be seeded with MULTI_INTERVAL_MS.def,
// which silently floored it — the built-in triple-tap's 250ms, and any custom
// gesture set below 400ms, would have kept the 400ms window.
describe("a tighter-than-default interval", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("is enforced rather than floored at the default", () => {
        const fired: string[] = [];
        const engine = createGestureEngine((id) => fired.push(id));
        engine.setGestures([
            def({ id: "t", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count: 3, interval: 250 }),
        ]);
        const tap = () => { engine.press("Space", mods()); engine.release("Space", mods()); };

        // 300ms gaps: inside the old 400ms floor, outside this gesture's 250ms.
        tap();
        vi.advanceTimersByTime(300);
        tap();
        vi.advanceTimersByTime(300);
        tap();
        vi.advanceTimersByTime(300);
        expect(fired).toEqual([]);

        // The same three presses inside the window do fire.
        tap();
        tap();
        tap();
        expect(fired).toEqual(["t"]);
    });
});

describe("typedRun", () => {
    const el = { nodeName: "TEXTAREA" } as unknown as HTMLElement;
    const other = { nodeName: "INPUT" } as unknown as HTMLElement;
    const tap = (key: string, extra: Partial<TypedKey> = {}): TypedKey =>
        ({ key, ctrlKey: false, altKey: false, metaKey: false, ...extra });
    const feed = (keys: TypedKey[], target: HTMLElement | null = el) =>
        keys.reduce<TypedRun | null>((run, k) => extendTypedRun(run, k, target), null);

    const multi = (count: number): ShortcutDef =>
        ({ id: "x", key: "Space", trigger: GESTURE_TRIGGER.MULTI, count, interval: 400, holdMs: 0 });

    it("collects a run of the same character", () => {
        expect(feed([tap(" "), tap(" "), tap(" ")])?.text).toBe("   ");
    });

    it("starts over on a different character, so typed text is not counted as shortcut", () => {
        expect(feed([tap("h"), tap("i"), tap(" "), tap(" ")])?.text).toBe("  ");
    });

    it("drops the run on a modifier combo or a non-character key", () => {
        expect(feed([tap(" "), tap("c", { ctrlKey: true })])).toBeNull();
        expect(feed([tap(" "), tap("Enter")])).toBeNull();
    });

    it("drops the run when the focus is not in an editable, and when it moves", () => {
        expect(feed([tap(" ")], null)).toBeNull();
        const run = feed([tap(" ")]);
        expect(extendTypedRun(run, tap(" "), other)?.text).toBe(" ");
    });

    // The reported bug: in a Chinese IME the Space that COMMITS the candidate
    // inserts no space of its own, so three presses put two spaces in the field.
    // Counting it made the run longer than the text really there, and since the
    // removal verifies before it cuts, NOTHING was removed — the shortcut left
    // two spaces in the message it had just translated.
    it("ignores a press the IME consumed", () => {
        const run = feed([tap(" ", { isComposing: true }), tap(" "), tap(" ")]);
        expect(run?.text).toBe("  ");
        expect(typedRunForShortcut(run, multi(3))?.text).toBe("  ");
    });

    it("ignores a legacy keyCode-229 press the same way", () => {
        expect(feed([tap(" ", { keyCode: 229 }), tap(" "), tap(" ")])?.text).toBe("  ");
    });

    it("takes only what the shortcut can account for", () => {
        // Three spaces, but a double-tap: the first was the user's own.
        const run = feed([tap(" "), tap(" "), tap(" ")]);
        expect(typedRunForShortcut(run, multi(2))?.text).toBe("  ");
        expect(typedRunForShortcut(run, multi(3))?.text).toBe("   ");
        // More presses than characters is fine — take what is there.
        expect(typedRunForShortcut(run, multi(4))?.text).toBe("   ");
    });

    it("takes one for a click and the whole run for a hold", () => {
        const run = feed([tap(" "), tap(" "), tap(" ")]);
        const at = (trigger: GESTURE_TRIGGER): ShortcutDef =>
            ({ id: "x", key: "Space", trigger, count: 0, interval: 0, holdMs: 500 });
        expect(typedRunForShortcut(run, at(GESTURE_TRIGGER.CLICK))?.text).toBe(" ");
        expect(typedRunForShortcut(run, at(GESTURE_TRIGGER.HOLD))?.text).toBe("   ");
    });

    it("has nothing to take without a run or without a definition", () => {
        expect(typedRunForShortcut(null, multi(2))).toBeNull();
        expect(typedRunForShortcut(feed([tap(" ")]), null)).toBeNull();
    });
});
