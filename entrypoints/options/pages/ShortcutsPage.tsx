import { ExternalLink, Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { browser } from 'wxt/browser';

type CommandInfo = {
  name: string;
  description: string;
  shortcut: string;
};

const COMMAND_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
  'shortcut-toggle': { key: 'shortcutToggleTranslation', fallback: 'Translate/restore page' },
  'shortcut-translate': { key: 'shortcutTranslate', fallback: 'Translate page' },
  'shortcut-restore': { key: 'shortcutRestore', fallback: 'Restore page' },
  'shortcut-ai-workbench': { key: 'shortcutAiWorkbench', fallback: 'Open AI writing workbench' },
};

export function ShortcutsPage() {
  const { t } = useTranslation();
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
    const mapped = COMMAND_LABEL_KEYS[cmd.name];
    if (mapped) return t(mapped.key, mapped.fallback);
    return cmd.description || cmd.name;
  };

  return (
    <div className="flex flex-col gap-4">
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
                {c.shortcut ? (
                  <kbd className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[12px] text-ink">
                    {c.shortcut}
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

      <div className="rounded-xl border border-line bg-surface/60 p-6 backdrop-blur-sm">
        <p className="text-[13.5px] text-ink">
          {t('pleaseModifyInBrowserSettings', 'Please modify in browser settings')}
        </p>
        <p className="mt-1 text-[12px] text-ink-soft">
          Chrome / Edge: <span className="font-mono">chrome://extensions/shortcuts</span>
        </p>
        <Button className="mt-5" onClick={openBrowserShortcuts}>
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('settings', 'Open settings')}
        </Button>
      </div>
    </div>
  );
}
