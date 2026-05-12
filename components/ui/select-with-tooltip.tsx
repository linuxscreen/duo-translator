import { type ReactNode, useRef, useState } from 'react';
import { Select, SelectTrigger, SelectValue } from './select';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type Props = {
  value: string;
  onValueChange: (v: string) => void;
  tooltip: ReactNode;
  triggerClassName?: string;
  triggerLeading?: ReactNode;
  children: ReactNode;
};

/**
 * Module-level cooldown shared by every SelectWithTooltip instance.
 *
 * When any select dropdown closes we set a short window during which **no**
 * tooltip is allowed to open. That defeats Radix's `skipDelayDuration` race:
 * Radix re-arms its internal "delay" flag via `setTimeout`, so for a brief
 * moment after a tooltip closes the next hover would skip the delay. The
 * cooldown gate forces a real delay every time.
 */
const COOLDOWN_MS = 250;
let suppressUntil = 0;

const isSuppressed = () => Date.now() < suppressUntil;
const armSuppress = () => {
  suppressUntil = Date.now() + COOLDOWN_MS;
};

/**
 * Select wrapped with a Tooltip on its trigger.
 *
 * - While the dropdown is open, the tooltip is force-closed.
 * - When the dropdown closes, both the per-instance `suppressRef` (cleared on
 *   pointer leave / blur) and the shared `suppressUntil` window prevent the
 *   tooltip from re-opening immediately.
 */
export function SelectWithTooltip({
  value,
  onValueChange,
  tooltip,
  triggerClassName,
  triggerLeading,
  children,
}: Props) {
  const [selectOpen, setSelectOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const suppressRef = useRef(false);

  const handleSelectOpenChange = (next: boolean) => {
    setSelectOpen(next);
    if (!next) {
      suppressRef.current = true;
      armSuppress();
      setTipOpen(false);
    }
  };

  const handleTipOpenChange = (next: boolean) => {
    if (next && (suppressRef.current || isSuppressed())) return;
    setTipOpen(next);
  };

  const clearSuppress = () => {
    suppressRef.current = false;
  };

  return (
    <Select value={value} onValueChange={onValueChange} open={selectOpen} onOpenChange={handleSelectOpenChange}>
      <Tooltip open={!selectOpen && tipOpen} onOpenChange={handleTipOpenChange}>
        <TooltipTrigger asChild>
          <SelectTrigger
            className={triggerClassName}
            onPointerLeave={clearSuppress}
            onBlur={clearSuppress}
          >
            {triggerLeading}
            <SelectValue />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {children}
    </Select>
  );
}
