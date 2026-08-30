import { ExternalLink, Keyboard, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { browser } from 'wxt/browser';
import { CONFIG_KEY, IS_SAFARI } from '@/main/constants';
import { useConfig } from '@/utils/reactiveConfig';
import { useIsMac } from '@/utils/useIsMac';
import { setConfig } from '@/utils/db';

type CommandInfo = {
  name: string;
  description: string;
  shortcut: string;
};

const COMMAND_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
  'shortcut-translate-restore-page': { key: 'shortcutTranslateRestorePage', fallback: 'Translate / Restore page' },
  'shortcut-ai-workbench': { key: 'shortcutAiWorkbench', fallback: 'Open AI writing workbench' },
  'shortcut-translate-restore-paragraph': { key: 'shortcutTranslateRestoreParagraph', fallback: 'Translate / Restore mouse-over paragraph' },
  'shortcut-translate-selection-input': { key: 'shortcutTranslateSelectionInput', fallback: 'Translate selection / input box' },
};

// browser.commands.update / reset are Firefox-only and absent from the Chrome
// type surface WXT ships; narrow through this typed view at the call sites.
const commandsApi = browser.commands as typeof browser.commands & {
  update?(detail: { name: string; shortcut?: string }): Promise<void>;
  reset?(name: string): Promise<void>;
};

// Who gets the in-page editor: whoever actually has the API, probed rather than
// named. Today that is Firefox alone — Chrome and Edge have never shipped
// update/reset, and Safari does not either (MDN BCD asserts `false`, not
// "unknown"). Safari 26 instead lets the user edit an extension's shortcuts in
// Safari > Settings > Extensions, which is a UI, not an API, so there is
// nothing here to call. Probing means an engine that adds it later lights the
// editor up without a code change, and — more importantly — we never hand a
// target an editor whose Save silently throws.
const canEditShortcuts =
  typeof commandsApi?.update === 'function' && typeof commandsApi?.reset === 'function';

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

// Display names for the double-tap modifier, per platform.
//
// macOS calls these Control and Option and prints exactly that on the keycap,
// next to the symbol. Double-tap asks the user to FIND a physical key, so the
// label follows the keycap rather than the cross-platform convention. Symbol
// AND word on purpose: ⌥ is widely recognized but ⌃ is the least recognized of
// the four Mac modifier symbols, so a bare symbol would leave people hunting.
//
// This is display only. The stored config value stays 'ctrl' / 'alt' (content.ts
// reads it to pick between e.ctrlKey / e.altKey) and eventToShortcut below keeps
// emitting the commands API's own grammar — neither may be localized.
const MODIFIER_LABELS: Record<'mac' | 'other', { ctrl: string; alt: string }> = {
  mac: { ctrl: '⌃ Control', alt: '⌥ Option' },
  other: { ctrl: 'Ctrl', alt: 'Alt' },
};

// The commands API's own grammar → the symbols macOS writes shortcuts with.
//
// `Ctrl` maps to ⌘ and NOT to ⌃, which looks wrong and is not: the manifest
// grammar says "On Macs, 'Ctrl' is interpreted as 'Command', so if you actually
// need 'Ctrl', specify 'MacCtrl'". So a stored `Ctrl+Y` really does fire on
// Command+Y, and drawing it as ⌃ would tell the user to press a key that does
// nothing. eventToShortcut emits MacCtrl on macOS for the same reason.
const MAC_KEY_SYMBOLS: Record<string, string> = {
  MacCtrl: '⌃',
  Ctrl: '⌘',
  Command: '⌘',
  Alt: '⌥',
  Shift: '⇧',
};

// Render a shortcut the way macOS writes them: symbols, no separators.
//
// Chrome already returns that form from commands.getAll() on macOS, so its
// tokens match nothing in the table and pass through untouched — the function
// is a no-op there rather than a second, conflicting formatting. Firefox
// returns the raw grammar ("Alt+S") on every platform, which is what this is
// for. Off macOS the string is shown exactly as the browser reported it, so it
// keeps matching what chrome://extensions/shortcuts shows.
function formatShortcut(shortcut: string, isMac: boolean): string {
  if (!isMac || !shortcut) return shortcut;
  return shortcut
    .split('+')
    .map((token) => MAC_KEY_SYMBOLS[token] ?? token)
    .join('');
}

// Map a KeyboardEvent to the main (non-modifier) key token in the format the
// commands API expects (e.g. "Y", "1", "F5", "Up", "Space"). Returns null when
// the key can't be part of a valid shortcut.
function normalizeKey(e: ReactKeyboardEvent): string | null {
  const { key, code } = e;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  switch (key) {
    case 'ArrowUp': return 'Up';
    case 'ArrowDown': return 'Down';
    case 'ArrowLeft': return 'Left';
    case 'ArrowRight': return 'Right';
    case ' ': return 'Space';
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
    case 'Insert':
    case 'Delete':
      return key;
  }
  // Fall back to physical code for numpad digits / letters with dead layouts.
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  return null;
}

// Build a full shortcut string ("Ctrl+Shift+Y") from a keydown event, or null
// if the combo isn't a valid browser shortcut yet (still on a bare modifier, or
// missing the required primary modifier).
function eventToShortcut(e: ReactKeyboardEvent, isMac: boolean): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const main = normalizeKey(e);
  if (!main) return null;

  const hasPrimary = e.ctrlKey || e.altKey || e.metaKey;
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(main);
  // The commands API rejects Shift-only combos; require Ctrl/Alt/Command unless
  // it's a standalone function key.
  if (!hasPrimary && !isFunctionKey) return null;

  const parts: string[] = [];
  // e.ctrlKey is the physical Control key, but the grammar's `Ctrl` means
  // Command on macOS (see MAC_KEY_SYMBOLS) — emitting it there would bind
  // Command+<key> to a Control+<key> press, i.e. record one shortcut and
  // install a different one.
  if (e.ctrlKey) parts.push(isMac ? 'MacCtrl' : 'Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Command');
  if (e.shiftKey) parts.push('Shift');
  parts.push(main);
  return parts.join('+');
}

// Double-tap shortcuts: double-tapping Ctrl/Alt runs a quick action in the
// content script. The modifier + the three per-action toggles are plain config
// keys read live via useConfig; content.ts reads the same keys on trigger.
function DoubleTapShortcutsCard() {
  const { t } = useTranslation();
  const labels = MODIFIER_LABELS[useIsMac() ? 'mac' : 'other'];
  const modifier = useConfig<string>(CONFIG_KEY.DOUBLE_TAP_MODIFIER);
  const translateSelection = useConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_SELECTION);
  const toggleParagraph = useConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TOGGLE_PARAGRAPH);
  const translateInput = useConfig<boolean>(CONFIG_KEY.DOUBLE_TAP_TRANSLATE_INPUT);

  const toggles: { key: CONFIG_KEY; label: string; checked: boolean }[] = [
    {
      key: CONFIG_KEY.DOUBLE_TAP_TRANSLATE_SELECTION,
      label: t('doubleTapTranslateSelection', 'Translate selection'),
      checked: translateSelection,
    },
    {
      key: CONFIG_KEY.DOUBLE_TAP_TRANSLATE_INPUT,
      label: t('doubleTapTranslateInput', 'Translate input box'),
      checked: translateInput,
    },
    {
      key: CONFIG_KEY.DOUBLE_TAP_TOGGLE_PARAGRAPH,
      label: t('doubleTapToggleParagraph', 'Translate / restore mouse-over paragraph'),
      checked: toggleParagraph,
    },
  ];

  return (
    <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Keyboard className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.6} />
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
          {t('doubleTapShortcuts', 'Double-tap shortcuts')}
        </span>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3">
        <p className="text-[12px] text-ink-soft">
          {t('doubleTapShortcutsHint', 'Double-tap the modifier key to run a quick action')}
        </p>
        <div className="flex items-center justify-between gap-6">
          <span className="text-[13.5px] text-ink">{t('doubleTapModifier', 'Modifier key')}</span>
          <RadioGroup
            className="flex-row gap-1"
            value={modifier}
            onValueChange={(v) => void setConfig(CONFIG_KEY.DOUBLE_TAP_MODIFIER, v)}
          >
            <RadioGroupItem value="ctrl" label={labels.ctrl} className="w-auto" />
            <RadioGroupItem value="alt" label={labels.alt} className="w-auto" />
          </RadioGroup>
        </div>
        <ul className="flex flex-col gap-3">
          {toggles.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-6">
              <span className="text-[13.5px] text-ink">{item.label}</span>
              <Switch
                checked={item.checked}
                onCheckedChange={(v) => void setConfig(item.key, v)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ShortcutsPage() {
  const { t } = useTranslation();
  const isMac = useIsMac();
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void browser.commands.getAll().then((list) => {
      if (cancelled) return;
      // Filter out the synthetic `_execute_action`/`_execute_browser_action`
      // entries — they don't show up in our manifest and have empty
      // descriptions; surfacing them only confuses the table.
      const visible = (list || [])
        .filter((c) => !!c.name && !c.name.startsWith('_'))
        .map((c) => ({
          name: c.name || '',
          description: c.description || '',
          shortcut: c.shortcut || '',
        }));
      setCommands(visible);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openBrowserShortcuts = () => {
    browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  };

  const labelFor = (cmd: CommandInfo): string => {
    // const mapped = COMMAND_LABEL_KEYS[cmd.name];
    // if (mapped) return t(mapped.key, mapped.fallback);
    return cmd.description || cmd.name;
  };

  const setLocalShortcut = (name: string, shortcut: string) => {
    setCommands((prev) => prev.map((c) => (c.name === name ? { ...c, shortcut } : c)));
  };

  // Firefox only — persist a new shortcut via the commands API.
  const applyShortcut = async (name: string, shortcut: string) => {
    await commandsApi.update?.({ name, shortcut });
    setLocalShortcut(name, shortcut);
  };

  // Clear (empty) the shortcut so the command has no binding.
  const clearShortcut = (name: string) => {
    void applyShortcut(name, '');
  };

  // Restore the manifest's suggested default and re-read what it resolved to.
  const resetShortcut = async (name: string) => {
    await commandsApi.reset?.(name);
    const list = await browser.commands.getAll();
    const found = (list || []).find((c) => c.name === name);
    setLocalShortcut(name, found?.shortcut || '');
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>, name: string) => {
    // Swallow every keystroke so typing doesn't leak into the field / page.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.currentTarget.blur();
      return;
    }
    const shortcut = eventToShortcut(e, isMac);
    if (shortcut) void applyShortcut(name, shortcut);
  };

  return (
    <div className="flex flex-col gap-4">
      <DoubleTapShortcutsCard />
      <div className="rounded-xl border border-line bg-surface/60 backdrop-blur-sm">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Keyboard className="h-3.5 w-3.5 text-ink-soft" strokeWidth={1.6} />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-mute">
            {t('currentShortcuts', 'Current shortcuts')}
          </span>
        </div>
        {!ready ? (
          <div className="h-24" />
        ) : commands.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-ink-soft">
            {t('noShortcutsRegistered', 'No shortcuts registered.')}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {commands.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-6 px-4 py-3"
              >
                <span className="text-[13.5px] text-ink">{labelFor(c)}</span>
                {canEditShortcuts ? (
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={formatShortcut(c.shortcut, isMac)}
                      placeholder={t('pressShortcutKeys', 'Press keys…')}
                      onKeyDown={(e) => handleKeyDown(e, c.name)}
                      className="w-44 cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-center font-mono text-[12px] text-ink placeholder:text-ink-mute focus:border-accent focus:outline-none"
                    />
                    {c.shortcut ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        title={t('clearShortcut', 'Clear')}
                        onClick={() => clearShortcut(c.name)}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        title={t('resetShortcut', 'Reset to default')}
                        onClick={() => void resetShortcut(c.name)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </Button>
                    )}
                  </div>
                ) : c.shortcut ? (
                  <kbd className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[12px] text-ink">
                    {formatShortcut(c.shortcut, isMac)}
                  </kbd>
                ) : (
                  <span className="font-mono text-[12px] text-ink-mute">
                    {t('notSet', 'Not set')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* No editor: point at the browser's own UI. Safari gets its own copy —
          chrome://extensions/shortcuts does not exist there, and its settings
          pane is not reachable from an extension, so that card is text only. */}
      {!canEditShortcuts && (
        <div className="rounded-xl border border-line bg-surface/60 p-6 backdrop-blur-sm">
          <p className="text-[13.5px] text-ink">
            {t('pleaseModifyInBrowserSettings', 'Please modify in browser settings')}
          </p>
          {IS_SAFARI ? (
            <p className="mt-1 text-[12px] text-ink-soft">
              {t(
                'modifyShortcutsInSafariSettings',
                'Safari 26 and later: Safari > Settings > Extensions > DuoTranslator.',
              )}
            </p>
          ) : (
            <>
              <p className="mt-1 text-[12px] text-ink-soft">
                Chrome / Edge: <span className="font-mono">chrome://extensions/shortcuts</span>
              </p>
              <Button className="mt-5" onClick={openBrowserShortcuts}>
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                {t('settings', 'Open settings')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
