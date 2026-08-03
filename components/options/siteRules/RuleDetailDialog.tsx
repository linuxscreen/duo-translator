import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SiteRule } from '@/main/siteRules/types';

type Props = {
  rule: SiteRule | null;
  onClose: () => void;
};

function Field({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-mute">{label}</div>
      <ul className="mt-1 space-y-0.5">
        {values.map((v, i) => (
          <li key={i} className="break-all font-mono text-[11.5px] text-ink-soft">
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only view of one rule. Shared by all three tiers. */
export function RuleDetailDialog({ rule, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={!!rule}
      onClose={onClose}
      title={rule?.name}
      widthClass="w-[560px]"
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('close', 'Close')}
        </Button>
      }
    >
      {rule && (
        <div className="flex flex-col gap-3">
          {rule.description && <p className="text-[12.5px] text-ink-soft">{rule.description}</p>}
          <Field label="id" values={[rule.id]} />
          <Field label={t('ruleIncludeUrls', 'Include URLs')} values={rule.includeUrls} />
          <Field label={t('ruleExcludeUrls', 'Exclude URLs')} values={rule.excludeUrls} />
          <Field label={t('ruleMatchSelectors', 'Only on pages matching')} values={rule.matchSelectors} />
          <Field label={t('ruleIncludeSelectors', 'Translate only')} values={rule.includeSelectors} />
          <Field label={t('ruleExcludeSelectors', 'Never translate')} values={rule.excludeSelectors} />
          <Field label={t('ruleInjectCss', 'Inject CSS')} values={rule.injectCss} />
        </div>
      )}
    </Dialog>
  );
}
