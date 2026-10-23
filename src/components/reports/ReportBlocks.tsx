import React, { memo, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Lightbulb, Minus, XCircle } from 'lucide-react';
import { Card, CardHeader, StatCard } from '../ui';
import type { Tone as UiTone } from '../ui';
import { cn } from '../../lib/cn';
import { formatValue } from '../../lib/reports/format';
import type { ReportKpi, ReportNote, ReportStatement, Tone } from '../../lib/reports/types';

/** Report tones (good/bad/...) on the design-system tones. */
export const UI_TONE: Record<Tone, UiTone> = { good: 'success', bad: 'danger', warn: 'warning', info: 'info', neutral: 'neutral' };
/** KPI figures stay in plain ink unless they are a problem (dues, losses, warnings): no rainbow of green numbers. */
export const KPI_TONE: Record<Tone, UiTone> = { good: 'neutral', bad: 'danger', warn: 'warning', info: 'neutral', neutral: 'neutral' };

/** KPI value text, a step smaller than StatCard's default so 8 figures fit a report row without truncating. */
export const KpiValue = ({ text }: { text: string }) => <span title={text} className="text-xl sm:text-2xl">{text}</span>;

const change = (current: number, previous?: number) => {
  if (previous === undefined || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

/** Percentage KPIs compare in points, so they carry their own small delta chip (StatCard's trend is always %). */
const PointsDelta = ({ delta, good, bad }: { delta: number; good: boolean; bad: boolean }) => (
  <span className={cn(
    'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold tabular-nums',
    good ? 'bg-success-soft text-success-fg' : bad ? 'bg-danger-soft text-danger-fg' : 'bg-surface-2 text-fg-subtle',
  )}>
    {delta > 0.05 ? <ArrowUpRight className="size-3" aria-hidden="true" /> : delta < -0.05 ? <ArrowDownRight className="size-3" aria-hidden="true" /> : <Minus className="size-3" aria-hidden="true" />}
    {Math.abs(delta).toFixed(1)} pts
  </span>
);

const KpiCard = memo(({ kpi, prev, previousLabel }: { kpi: ReportKpi; prev?: ReportKpi; previousLabel?: string }) => {
  const format = kpi.format || 'number';
  const text = formatValue(kpi.value, format, kpi.unit);
  const prevText = prev ? formatValue(prev.value, format, kpi.unit) : '';
  const isPoints = format === 'percent';
  const delta = prev ? (isPoints ? kpi.value - prev.value : change(kpi.value, prev.value)) : null;
  const up = delta !== null && delta > 0.05;
  const down = delta !== null && delta < -0.05;
  const good = kpi.inverse ? down : up;
  const bad = kpi.inverse ? up : down;

  // Flat (within ±0.05) shows as "no change" rather than a green 0%.
  let trend: number | null = null;
  let trendLabel: React.ReactNode = null;
  if (prev) {
    if (delta === null) trendLabel = `was ${prevText}`;
    else if (isPoints) trendLabel = <PointsDelta delta={delta} good={good} bad={bad} />;
    else if (!up && !down) trendLabel = 'No change';
    else trend = delta;
    // With no hint the previous figure fits beside the change; it is always in the tooltip.
    if (trend !== null && !kpi.hint) trendLabel = `vs ${prevText}`;
  }

  return (
    <div title={prev ? `${previousLabel || 'Previous period'}: ${prevText}` : undefined} className="min-w-0">
      <StatCard
        label={kpi.label}
        value={<KpiValue text={text} />}
        tone={KPI_TONE[kpi.tone || 'neutral']}
        trend={trend}
        trendGoodWhen={kpi.inverse ? 'down' : 'up'}
        trendLabel={trendLabel}
        hint={kpi.hint}
        className="h-full"
      />
    </div>
  );
});

export const KpiGrid = memo(({ kpis, previous, previousLabel }: { kpis: ReportKpi[]; previous?: ReportKpi[]; previousLabel?: string }) => {
  const prevByKey = useMemo(() => new Map((previous || []).map(p => [p.key, p])), [previous]);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4 print:grid-cols-4">
      {kpis.map(kpi => <KpiCard key={kpi.key} kpi={kpi} prev={prevByKey.get(kpi.key)} previousLabel={previousLabel} />)}
    </div>
  );
});

export const StatementCard = memo(({ statement }: { statement: ReportStatement }) => (
  <Card className="break-inside-avoid">
    <CardHeader title={statement.title} className="border-b border-line pb-3" />
    <dl className="divide-y divide-dashed divide-line px-3 py-2">
      {statement.lines.map((line, i) => {
        const negative = line.tone === 'bad' || line.value < 0;
        return (
          <div key={i} style={{ paddingLeft: `${0.5 + (line.indent || 0) * 1.1}rem` }}
            className={cn('flex items-baseline justify-between gap-4 py-2 pr-2 text-sm', line.strong && 'my-1 rounded-lg border-0 bg-surface-2 font-bold')}>
            <dt className={cn('min-w-0', line.strong ? 'text-fg' : 'text-fg-muted')}>
              {line.label}
              {line.note && <span className="ml-1.5 text-[11px] font-normal text-fg-subtle">{line.note}</span>}
            </dt>
            <dd className={cn('shrink-0 tabular-nums', negative ? 'text-danger-fg' : line.tone === 'good' ? 'text-success-fg' : 'text-fg')}>
              {formatValue(line.value, line.format || 'money')}
            </dd>
          </div>
        );
      })}
    </dl>
  </Card>
));

const NOTE_STYLE: Record<Tone, { cls: string; Icon: React.ElementType }> = {
  good: { cls: 'bg-success-soft text-success-fg ring-success/20', Icon: CheckCircle2 },
  bad: { cls: 'bg-danger-soft text-danger-fg ring-danger/20', Icon: XCircle },
  warn: { cls: 'bg-warning-soft text-warning-fg ring-warning/25', Icon: AlertTriangle },
  info: { cls: 'bg-info-soft text-info-fg ring-info/20', Icon: Info },
  neutral: { cls: 'bg-surface-2 text-fg-muted ring-line', Icon: Info },
};

/** Same message for many records ("... (INV-1)", "... (INV-2)") becomes one line listing them. */
function groupNotes(notes: ReportNote[]) {
  const groups = new Map<string, { tone: Tone; text: string; subjects: string[] }>();
  notes.forEach(note => {
    // The trailing "(subject)" may itself hold one bracket, e.g. "(Milk (Counter / warehouse))".
    const match = note.text.match(/^(.*?)\s*\(((?:[^()]|\([^()]*\))*)\)\s*$/);
    const base = match ? match[1] : note.text;
    const key = `${note.tone}:${base}`;
    const group = groups.get(key) || { tone: note.tone, text: base, subjects: [] };
    if (match) group.subjects.push(match[2]);
    groups.set(key, group);
  });
  return [...groups.values()];
}

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, neutral: 3, good: 4 };

export const NotesList = memo(({ notes }: { notes: ReportNote[] }) => {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupNotes(notes).sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]), [notes]);
  const shown = open ? groups : groups.slice(0, 2);
  return (
    <div className="space-y-2">
      {shown.map((note, i) => {
        const { cls, Icon } = NOTE_STYLE[note.tone] || NOTE_STYLE.neutral;
        const list = note.subjects.length > 1 ? `${note.subjects.slice(0, 4).join(', ')}${note.subjects.length > 4 ? ` +${note.subjects.length - 4} more` : ''}` : note.subjects[0];
        return (
          <div key={i} role={note.tone === 'bad' ? 'alert' : undefined} className={cn('flex items-start gap-2 rounded-control px-3 py-2.5 text-[13px] ring-1 ring-inset', cls)}>
            <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {note.text}
              {note.subjects.length > 1 && <b className="ml-1">({note.subjects.length} records)</b>}
              {list && <span className="ml-1 opacity-80">— {list}</span>}
            </span>
          </div>
        );
      })}
      {groups.length > 2 && (
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
          className="rounded text-xs font-semibold text-fg-subtle underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:hidden">
          {open ? 'Show fewer checks' : `Show ${groups.length - 2} more data check${groups.length - 2 === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
});

export const Insights = memo(({ items }: { items: string[] }) => (
  <ul className="flex flex-wrap gap-2" aria-label="Insights">
    {items.map((text, i) => (
      <li key={i} className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-fg ring-1 ring-inset ring-brand/20">
        <Lightbulb size={13} className="shrink-0 text-brand-accent" aria-hidden="true" />{text}
      </li>
    ))}
  </ul>
));
