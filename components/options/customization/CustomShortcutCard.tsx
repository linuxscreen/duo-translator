import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CONFIG_KEY } from '@/main/constants';
import { setConfig } from '@/utils/db';
import { useConfig } from '@/utils/reactiveConfig';
import { useIsMac } from '@/utils/useIsMac';
import {
  BUILTIN_SHORTCUTS,
  CUSTOM_SHORTCUT_ACTION,
  CUSTOM_SHORTCUT_ACTION_OPTIONS,
  SHORTCUT_NONE,
  findShortcut,
  normalizeBindings,
  normalizeCustomShortcuts,
  shortcutLabel,
  type CustomShortcut,
  type ShortcutBinding,
  type ShortcutDef,
} from '@/main/customShortcut/types';
import { ShortcutEditor } from './ShortcutEditor';

function newId(): string {
  return crypto.randomUUID?.() ?? `sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The row shown when nothing has been configured yet — a Function set to the
 * default and no gesture, i.e. exactly the "defaults" the feature ships with.
 *
 * It is NOT written to storage on sight: an Options visit should not create
 * config (and sync it to every other device) for a feature the user only
 * looked at. The moment anything in it is edited it becomes a real row. Its id
 * is fixed rather than random so two devices that both start from the default
 * produce the SAME row instead of two.
 */
const DEFAULT_BINDING: ShortcutBinding = {
  id: 'default',
  action: CUSTOM_SHORTCUT_ACTION_OPTIONS[0].value,
  shortcutId: SHORTCUT_NONE,
};

export function CustomShortcutCard() {
  const { t } = useTranslation();
  const isMac = useIsMac();

  const rawList = useConfig<unknown[]>(CONFIG_KEY.CUSTOM_SHORTCUT_LIST);
  const rawBindings = useConfig<unknown[]>(CONFIG_KEY.CUSTOM_SHORTCUT_BINDINGS);
  const customs = useMemo(() => normalizeCustomShortcuts(rawList), [rawList]);
  const stored = useMemo(() => normalizeBindings(rawBindings), [rawBindings]);
  const bindings = stored.length > 0 ? stored : [DEFAULT_BINDING];

  // `null` = closed, `''` = creating, an id = editing that one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? customs.find((c) => c.id === editingId) ?? null : null;

  const labelOf = (def: ShortcutDef) => shortcutLabel(def, t, isMac);
  /** A custom shortcut's own name, falling back to its derived gesture label. */
  const nameOf = (c: CustomShortcut) => (c.name.trim() !== '' ? c.name : labelOf(c));

  const writeCustoms = (next: CustomShortcut[]) =>
    void setConfig(CONFIG_KEY.CUSTOM_SHORTCUT_LIST, next);
  const writeBindings = (next: ShortcutBinding[]) =>
    void setConfig(CONFIG_KEY.CUSTOM_SHORTCUT_BINDINGS, next);

  const saveCustom = (s: CustomShortcut) => {
    const exists = customs.some((c) => c.id === s.id);
    writeCustoms(exists ? customs.map((c) => (c.id === s.id ? s : c)) : [...customs, s]);
    setEditingId(null);
  };

  const deleteCustom = (id: string) => {
    writeCustoms(customs.filter((c) => c.id !== id));
    // Bindings pointing at it would resolve to nothing anyway, but leaving them
    // there shows the picker on a value it can no longer render. Reset them so
    // the row says "None" — which is what it now does.
    const orphaned = stored.filter((b) => b.shortcutId === id);
    if (orphaned.length > 0) {
      writeBindings(stored.map((b) => (b.shortcutId === id ? { ...b, shortcutId: SHORTCUT_NONE } : b)));
    }
    if (editingId === id) setEditingId(null);
  };

  const patchBinding = (id: string, patch: Partial<ShortcutBinding>) =>
    writeBindings(bindings.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const addBinding = () =>
    writeBindings([
      ...bindings,
      { id: newId(), action: CUSTOM_SHORTCUT_ACTION_OPTIONS[0].value, shortcutId: SHORTCUT_NONE },
    ]);

  const removeBinding = (id: string) => writeBindings(bindings.filter((b) => b.id !== id));

  /** Everything a gesture under edit must not duplicate. */
  const conflictPool = useMemo(
    () => [
      ...BUILTIN_SHORTCUTS.map((def) => ({ def, label: labelOf(def) })),
      ...customs
        .filter((c) => c.id !== editingId)
        .map((c) => ({ def: c as ShortcutDef, label: nameOf(c) })),
    ],
    // labelOf / nameOf close over `t` and `isMac` — both change only when the
    // interface language or the platform answer does, which is exactly when the
    // labels have to be rebuilt.
    [customs, editingId, t, isMac],
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12px] text-ink-soft">
        {t('customShortcutsHint', 'Coexists with the browser shortcuts and the double-tap modifier')}
      </p>

      {/* --- Custom gesture definitions ------------------------------------ */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium text-ink">
            {t('customShortcutDefinitions', 'Custom shortcuts')}
          </span>
          <Button size="sm" variant="outline" onClick={() => setEditingId('')} disabled={editingId === ''}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('customShortcutNew', 'New custom')}
          </Button>
        </div>

        {customs.length === 0 && editingId !== '' ? (
          <div className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-soft">
            {t('customShortcutEmpty', 'No custom shortcuts yet')}
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {customs.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{nameOf(c)}</span>
                {/* Only when the user renamed it — otherwise the two are the
                    same string and the row would read it out twice. */}
                {c.name.trim() !== '' && (
                  <span className="shrink-0 font-mono text-[11.5px] text-ink-mute">{labelOf(c)}</span>
                )}
                <button
                  type="button"
                  onClick={() => setEditingId(c.id)}
                  title={t('edit', 'Edit')}
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteCustom(c.id)}
                  title={t('delete', 'Delete')}
                  className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {editingId !== null && (
          <ShortcutEditor
            key={editingId || 'new'}
            shortcut={editing}
            others={conflictPool}
            onCancel={() => setEditingId(null)}
            onSave={saveCustom}
          />
        )}
      </section>

      <div className="h-px bg-line" />

      {/* --- Function ⇄ gesture bindings ------------------------------------ */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium text-ink">
            {t('customShortcutBindings', 'Bindings')}
          </span>
          <Button size="sm" variant="outline" onClick={addBinding}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('customShortcutAddBinding', 'Add binding')}
          </Button>
        </div>

        <ul className="flex flex-col gap-2">
          {bindings.map((b) => (
            <li key={b.id} className="flex items-center gap-2">
              <span className="shrink-0 text-[12.5px] text-ink-soft">
                {t('customShortcutAction', 'Function')}
              </span>
              <Select
                value={b.action}
                onValueChange={(v) => patchBinding(b.id, { action: v as CUSTOM_SHORTCUT_ACTION })}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_SHORTCUT_ACTION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.title, o.fallback)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="shrink-0 text-[12.5px] text-ink-soft">
                {t('shortcut', 'Shortcut')}
              </span>
              {/* A binding can outlive the shortcut it names — a device that
                  synced the binding but not the custom definition, or an id
                  left over from an older build. Showing "None" for an id the
                  picker has no item for beats rendering a blank trigger. */}
              <Select
                value={findShortcut(b.shortcutId, customs) ? b.shortcutId : SHORTCUT_NONE}
                onValueChange={(v) => patchBinding(b.id, { shortcutId: v })}
              >
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHORTCUT_NONE}>{t('customShortcutNone', 'None')}</SelectItem>
                  {BUILTIN_SHORTCUTS.map((def) => (
                    <SelectItem key={def.id} value={def.id}>
                      {labelOf(def)}
                    </SelectItem>
                  ))}
                  {customs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {nameOf(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Nothing to remove when the single remaining row IS the defaults. */}
              <button
                type="button"
                onClick={() => removeBinding(b.id)}
                title={t('remove', 'Remove')}
                disabled={bindings.length <= 1}
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
