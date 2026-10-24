import { Input, SegmentedControl } from '../ui';
import type { SegmentOption } from '../ui';
import type { PeriodPreset } from './ledger';

const OPTIONS: SegmentOption<PeriodPreset>[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom' },
];

interface PeriodFilterProps {
  preset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Today's Pakistan date, the latest day that can be picked. */
  maxDate: string;
}

/** Period picker for statements. Days are Pakistan business days (Asia/Karachi). */
export function PeriodFilter({ preset, onPresetChange, from, to, onFromChange, onToChange, maxDate }: PeriodFilterProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <SegmentedControl aria-label="Period" size="sm" value={preset} onChange={onPresetChange} options={OPTIONS} />
      {preset === 'custom' && (
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            type="date"
            inputSize="sm"
            aria-label="From date"
            value={from}
            max={to || maxDate}
            onChange={event => onFromChange(event.target.value)}
            className="w-[8.75rem]"
          />
          <span className="text-xs text-fg-subtle">to</span>
          <Input
            type="date"
            inputSize="sm"
            aria-label="To date"
            value={to}
            min={from || undefined}
            max={maxDate}
            onChange={event => onToChange(event.target.value)}
            className="w-[8.75rem]"
          />
        </div>
      )}
    </div>
  );
}
