import { Input, Select } from '../ui';
import { rangeForPreset, type DatePreset } from '../../lib/supplierStatement';

export interface PeriodChoice {
  preset: DatePreset;
  /** Only read for the custom preset; the others work their dates out from today. */
  from: string;
  to: string;
}

export const ALL_TIME: PeriodChoice = { preset: 'all', from: '', to: '' };

/** The chosen duration as "YYYY-MM-DD" days; a reversed custom range is swapped. */
export const periodRange = (choice: PeriodChoice) => rangeForPreset(choice.preset, choice.from, choice.to);

const OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'tendays', label: '10-day cycle' },
  { value: 'fifteendays', label: '15-day cycle' },
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'custom', label: 'Custom dates' },
];

export function LedgerPeriodPicker({ value, onChange }: { value: PeriodChoice; onChange: (choice: PeriodChoice) => void }) {
  const pick = (preset: DatePreset) => {
    if (preset !== 'custom') return onChange({ preset, from: '', to: '' });
    // Custom opens on the dates already showing, so the owner adjusts them instead of starting blank.
    const current = periodRange(value);
    const seed = current.from ? current : rangeForPreset('month');
    onChange({ preset, from: seed.from, to: seed.to });
  };
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <Select aria-label="Duration" value={value.preset} onChange={e => pick(e.target.value as DatePreset)} className="w-full sm:w-40">
        {OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      {value.preset === 'custom' && (
        <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
          <Input type="date" aria-label="From date" value={value.from} max={value.to || undefined} onChange={e => onChange({ ...value, from: e.target.value })} className="min-w-0 flex-1 sm:w-[9.25rem] sm:flex-none" />
          <span className="text-xs text-fg-subtle">to</span>
          <Input type="date" aria-label="To date" value={value.to} min={value.from || undefined} onChange={e => onChange({ ...value, to: e.target.value })} className="min-w-0 flex-1 sm:w-[9.25rem] sm:flex-none" />
        </div>
      )}
    </div>
  );
}
