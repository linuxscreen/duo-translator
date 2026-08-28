import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { NumberInputWithReset } from '@/components/options/NumberInputWithReset';
import { useIsMac } from '@/utils/useIsMac';
import {
  GESTURE_TRIGGER,
  HOLD_MS,
  MOUSE_MIDDLE_KEY,
  MULTI_COUNT,
  MULTI_INTERVAL_MS,
  buildCombo,
  comboLabel,
  gestureKeyOf,
  isCapturableKey,
  isModifierToken,
  sameGesture,
  shortcutLabel,
  type CustomShortcut,
  type ShortcutDef,
} from '@/main/customShortcut/types';

type Props = {
  /** `null` = creating a new one. */
  shortcut: CustomShortcut | null;
  /** Everything the new gesture must not duplicate (built-ins + the other customs). */
  others: { def: ShortcutDef; label: string }[];
  onCancel: () => void;
  onSave: (shortcut: CustomShortcut) => void;
};

function newId(): string {
  return crypto.randomUUID?.() ?? `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Bounds = { min: number; max: number; def: number };

/**
 * Numeric setting with a caption and a reset-to-default button.
 *
 * The raw string is local state so a half-typed value ("" while backspacing,
 * "12" on the way to "120") is not clamped under the user's fingers; clamping
 * happens on commit (blur / Enter), which is also the only moment the parent
 * hears about it.
 */
function NumberField({
  label,
  bounds,
  value,
  onChange,
}: {
  label: string;
  bounds: Bounds;
  value: number;
  onChange: (n: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  const commit = () => {
    const n = Number(raw);
    const next = Number.isFinite(n) && raw.trim() !== ''
      ? Math.min(bounds.max, Math.max(bounds.min, Math.round(n)))
      : bounds.def;
    setRaw(String(next));
    onChange(next);
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[12.5px] text-ink-soft">{label}</span>
      <NumberInputWithReset
        value={raw}
        min={bounds.min}
        max={bounds.max}
        defaultValue={bounds.def}
        onChange={setRaw}
        onCommit={commit}
        onReset={() => {
          setRaw(String(bounds.def));
          onChange(bounds.def);
        }}
      />
    </div>
  );
}

/**
 * Create / edit one custom gesture, inline inside the card.
 *
 * Follows the repo's form rules even though it is not a modal: the one field
 * Save actually rejects when empty carries the red asterisk, Save is disabled
 * from a live-derived verdict rather than a check that only runs on click, and
 * the error line sits directly above the buttons where it cannot scroll away.
 */
export function ShortcutEditor({ shortcut, others, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const isMac = useIsMac();

  const [key, setKey] = useState(shortcut?.key ?? '');
  const [trigger, setTrigger] = useState<GESTURE_TRIGGER>(shortcut?.trigger ?? GESTURE_TRIGGER.CLICK);
  const [count, setCount] = useState(shortcut?.count ?? MULTI_COUNT.def);
  const [interval, setIntervalMs] = useState(shortcut?.interval ?? MULTI_INTERVAL_MS.def);
  const [holdMs, setHoldMs] = useState(shortcut?.holdMs ?? HOLD_MS.def);
  const [name, setName] = useState(shortcut?.name ?? '');
  // Once the user types a name of their own, it stops following the gesture.
  const [nameTouched, setNameTouched] = useState(!!shortcut?.name);
  const [capturing, setCapturing] = useState(false);

  const draft: ShortcutDef = { id: shortcut?.id ?? '', key, trigger, count, interval, holdMs };
  const autoName = key ? shortcutLabel(draft, t, isMac) : '';

  /**
   * The name follows the gesture until the user takes it over.
   *
   * Two distinct values, and collapsing them into one breaks editing: what the
   * FIELD shows must be the raw `name` once touched — falling back to the auto
   * name on an empty field would repopulate the box the moment the last
   * character is deleted, making it impossible to clear. What gets SAVED is the
   * empty string in that case, so `nameOf` keeps deriving the label live (and
   * in the current interface language) instead of freezing today's wording.
   */
  const displayName = nameTouched ? name : autoName;

  /**
   * Key capture. Window-level and capture-phase because the interesting keys
   * are exactly the ones a focused control would otherwise eat or act on:
   * a bare modifier never reaches a keypress handler, Space activates the
   * button, and the middle button pastes the X primary selection on Linux.
   *
   * A combo is committed by whichever comes first:
   *   - an ordinary key going DOWN  → modifiers held + that key ("Ctrl+Shift+Y")
   *   - the middle button going down → modifiers held + the button
   *   - a modifier coming UP with no ordinary key pressed → the modifiers alone
   *     ("Ctrl", "Ctrl+Shift")
   *
   * The modifiers-only case is why it cannot all be done on keydown: while
   * Ctrl is held there is no way to tell "the user means Ctrl" from "the user
   * is on their way to Ctrl+Y" — only letting go answers that.
   */
  const heldModifiers = useRef<string[]>([]);
  useEffect(() => {
    if (!capturing) {
      heldModifiers.current = [];
      return;
    }
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const commit = (combo: string) => {
      heldModifiers.current = [];
      setKey(combo);
      setCapturing(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      stop(e);
      // Escape backs out, Tab keeps its job — recording either would leave no
      // keyboard way out of the capture control.
      if (e.key === 'Escape' || e.key === 'Tab') {
        setCapturing(false);
        return;
      }
      const token = gestureKeyOf(e);
      if (isModifierToken(token)) {
        if (!heldModifiers.current.includes(token)) heldModifiers.current.push(token);
        return;
      }
      if (!isCapturableKey(token)) return;
      commit(buildCombo(heldModifiers.current, token));
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const token = gestureKeyOf(e);
      if (!isModifierToken(token) || heldModifiers.current.length === 0) return;
      stop(e);
      // Commit the set at its widest: releasing the first of Ctrl+Shift still
      // means the user asked for both.
      commit(buildCombo(heldModifiers.current, null));
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) {
        stop(e);
        commit(buildCombo(heldModifiers.current, MOUSE_MIDDLE_KEY));
        return;
      }
      // Any other click means "never mind" — clicking away is the obvious exit.
      setCapturing(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('auxclick', stop, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('auxclick', stop, true);
    };
  }, [capturing]);

  const conflict = useMemo(() => {
    if (!key) return null;
    return others.find((o) => sameGesture(o.def, draft)) ?? null;
    // `draft` is rebuilt every render; the fields `sameGesture` actually reads
    // are the real dependencies (interval / holdMs do not change a gesture's
    // identity — see sameGesture).
  }, [key, trigger, count, others]);

  const missing = key === '';
  const error = conflict
    ? t('customShortcutConflict', 'This gesture is already used by "{{name}}"', { name: conflict.label })
    : '';

  const save = () => {
    if (missing || error) return;
    onSave({
      id: shortcut?.id || newId(),
      // Empty = "still following the gesture"; the list and the picker derive
      // the label from the definition in that case.
      name: nameTouched ? name.trim() : '',
      key,
      trigger,
      count: trigger === GESTURE_TRIGGER.MULTI ? count : MULTI_COUNT.def,
      interval,
      holdMs,
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface/70 p-3">
      {/* Key — the only required field, hence the only asterisk. */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-[12.5px] font-medium text-ink">
          {t('customShortcutKey', 'Key')}
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCapturing((v) => !v)}
          className={`h-9 min-w-[200px] rounded-md border px-3 text-[13px] transition-colors ${
            capturing
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line bg-surface text-ink hover:border-accent'
          }`}
        >
          {capturing
            ? t('customShortcutKeyCapturing', 'Press a key, a combo, or the middle mouse button…')
            : key
              ? comboLabel(key, t, isMac)
              : t('customShortcutKeyPrompt', 'Click, then press a key or combo')}
        </button>
      </div>

      {capturing && (
        <p className="text-right text-[11.5px] text-ink-soft">
          {t(
            'customShortcutKeyHint',
            'Modifiers on their own (Ctrl, Ctrl+Shift) are recorded when you let go.',
          )}
        </p>
      )}

      {/* Hidden until there is a key: it has nothing to be named after yet. */}
      {key !== '' && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[12.5px] font-medium text-ink">{t('name', 'Name')}</span>
          <Input
            value={displayName}
            placeholder={autoName}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
            className="w-[240px]"
          />
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <span className="mt-1 text-[12.5px] font-medium text-ink">
          {t('customShortcutTrigger', 'Trigger')}
        </span>
        <RadioGroup
          className="w-[240px] flex-row flex-wrap gap-1"
          value={trigger}
          onValueChange={(v) => setTrigger(v as GESTURE_TRIGGER)}
        >
          <RadioGroupItem
            value={GESTURE_TRIGGER.CLICK}
            label={t('customShortcutTriggerClick', 'Single press')}
            className="w-auto"
          />
          <RadioGroupItem
            value={GESTURE_TRIGGER.MULTI}
            label={t('customShortcutTriggerMulti', 'Multi-press')}
            className="w-auto"
          />
          <RadioGroupItem
            value={GESTURE_TRIGGER.HOLD}
            label={t('customShortcutTriggerHold', 'Press and hold')}
            className="w-auto"
          />
        </RadioGroup>
      </div>

      {trigger === GESTURE_TRIGGER.MULTI && (
        <>
          <NumberField
            label={t('customShortcutCount', 'Press count')}
            bounds={MULTI_COUNT}
            value={count}
            onChange={setCount}
          />
          <NumberField
            label={t('customShortcutInterval', 'Max interval between presses (ms)')}
            bounds={MULTI_INTERVAL_MS}
            value={interval}
            onChange={setIntervalMs}
          />
        </>
      )}

      {trigger === GESTURE_TRIGGER.HOLD && (
        <NumberField
          label={t('customShortcutHoldMs', 'Minimum hold time (ms)')}
          bounds={HOLD_MS}
          value={holdMs}
          onChange={setHoldMs}
        />
      )}

      {/* Pinned right above the buttons: an error the user has to scroll to find
          is indistinguishable from a Save button that is broken. */}
      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button size="sm" onClick={save} disabled={missing || !!error}>
          {t('save', 'Save')}
        </Button>
      </div>
    </div>
  );
}
