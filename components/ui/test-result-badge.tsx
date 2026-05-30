import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * Inline connection-test result shown under a service/provider name.
 *
 * - `ok`   → green check + short label.
 * - `fail` → red alert + the error message, visually truncated to the cell
 *   width. The full message (which can be a long HTTP/JSON body) is revealed
 *   on hover via a wrapping Tooltip, so we never hard-slice the text.
 *
 * Shared by ServicesPage (translation services) and AiProvidersCard to keep
 * the two surfaces consistent.
 */
type Props =
  | { kind: 'ok'; okLabel: string }
  | { kind: 'fail'; message: string };

export function TestResultBadge(props: Props) {
  if (props.kind === 'ok') {
    return (
      <span className="inline-flex w-fit items-center gap-1 truncate text-[11px] text-emerald-500">
        <CheckCircle2 className="h-3 w-3 shrink-0" strokeWidth={1.8} />
        {props.okLabel}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex max-w-full cursor-help items-center gap-1 text-[11px] text-red-500">
          <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">{props.message}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[320px] whitespace-pre-wrap break-words">
        {props.message}
      </TooltipContent>
    </Tooltip>
  );
}
