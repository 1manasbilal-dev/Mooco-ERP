import React, { memo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Lightbulb, Minus, XCircle } from 'lucide-react';
import { formatValue } from '../../lib/reports/format';
import type { ReportKpi, ReportNote, ReportStatement, Tone } from '../../lib/reports/types';

const KPI_ACCENT: Record<Tone, string> = {
  good: 'before:bg-emerald-500', bad: 'before:bg-red-500', warn: 'before:bg-amber-500', info: 'before:bg-blue-500', neutral: 'before:bg-slate-300 dark:before:bg-slate-600',
};

const change = (current: number, previous?: number) => {
  if (previous === undefined || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

export const KpiGrid = memo(({ kpis, previous, previousLabel }: { kpis: ReportKpi[]; previous?: ReportKpi[]; previousLabel?: string }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {kpis.map(kpi => {
      const prev = previous?.find(p => p.key === kpi.key);
      const delta = prev && kpi.format !== 'percent' ? change(kpi.value, prev.value) : prev ? kpi.value - prev.value : null;
      const up = delta !== null && delta > 0.05;
      const down = delta !== null && delta < -0.05;
      const good = kpi.inverse ? down : up;
      const bad = kpi.inverse ? up : down;
      return (
        <div key={kpi.key} className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xs before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full dark:border-slate-800 ${KPI_ACCENT[kpi.tone || 'neutral']}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{kpi.label}</div>
          <div className="mt-1 truncate text-lg font-black tabular-nums text-slate-900 sm:text-xl dark:text-white" title={formatValue(kpi.value, kpi.format || 'number', kpi.unit)}>
            {formatValue(kpi.value, kpi.format || 'number', kpi.unit)}
          </div>
          <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
            {prev && delta !== null && (
              <span title={`${previousLabel || 'Previous period'}: ${formatValue(prev.value, kpi.format || 'number', kpi.unit)}`}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-bold ${good ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : bad ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                {up ? <ArrowUpRight size={11} /> : down ? <ArrowDownRight size={11} /> : <Minus size={11} />}
                {kpi.format === 'percent' ? `${Math.abs(delta).toFixed(1)} pts` : `${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`}
              </span>
            )}
            {prev && delta === null && <span className="text-slate-400">was {formatValue(prev.value, kpi.format || 'number', kpi.unit)}</span>}
            {kpi.hint && <span className="truncate text-slate-500 dark:text-slate-400">{kpi.hint}</span>}
          </div>
        </div>
      );
    })}
  </div>
));

export const StatementCard = memo(({ statement }: { statement: ReportStatement }) => (
  <div className="rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800">
    <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800 dark:border-slate-800 dark:text-slate-100">{statement.title}</h3>
    <dl className="divide-y divide-dashed divide-slate-100 px-2 py-1 dark:divide-slate-800">
      {statement.lines.map((line, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-4 px-2 py-2 text-sm ${line.strong ? 'my-1 rounded-lg bg-slate-50 font-bold dark:bg-slate-900' : ''}`} style={{ paddingLeft: `${0.5 + (line.indent || 0) * 1.1}rem` }}>
          <dt className={`min-w-0 ${line.strong ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'}`}>
            {line.label}
            {line.note && <span className="ml-1.5 text-[11px] font-normal text-slate-400">{line.note}</span>}
          </dt>
          <dd className={`shrink-0 tabular-nums ${line.tone === 'bad' || line.value < 0 ? 'text-red-600 dark:text-red-400' : line.tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100'}`}>
            {formatValue(line.value, line.format || 'money')}
          </dd>
        </div>
      ))}
    </dl>
  </div>
));

const NOTE_STYLE: Record<Tone, { cls: string; Icon: React.ElementType }> = {
  good: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200', Icon: CheckCircle2 },
  bad: { cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200', Icon: XCircle },
  warn: { cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200', Icon: AlertTriangle },
  info: { cls: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200', Icon: Info },
  neutral: { cls: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300', Icon: Info },
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
  const groups = groupNotes(notes).sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  const shown = open ? groups : groups.slice(0, 2);
  return (
    <div className="space-y-2">
      {shown.map((note, i) => {
        const { cls, Icon } = NOTE_STYLE[note.tone] || NOTE_STYLE.neutral;
        const list = note.subjects.length > 1 ? `${note.subjects.slice(0, 4).join(', ')}${note.subjects.length > 4 ? ` +${note.subjects.length - 4} more` : ''}` : note.subjects[0];
        return (
          <div key={i} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${cls}`}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <span>
              {note.text}
              {note.subjects.length > 1 && <b className="ml-1">({note.subjects.length} records)</b>}
              {list && <span className="ml-1 opacity-75">— {list}</span>}
            </span>
          </div>
        );
      })}
      {groups.length > 2 && (
        <button type="button" onClick={() => setOpen(v => !v)} className="text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline dark:hover:text-slate-200">
          {open ? 'Show fewer checks' : `Show ${groups.length - 2} more data check${groups.length - 2 === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
});

export const Insights = memo(({ items }: { items: string[] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((text, i) => (
      <div key={i} className="flex items-center gap-1.5 rounded-full border border-lime-200 bg-lime-50 px-3 py-1.5 text-xs font-medium text-lime-900 dark:border-lime-900 dark:bg-lime-950/30 dark:text-lime-200">
        <Lightbulb size={13} className="shrink-0 text-lime-600" />{text}
      </div>
    ))}
  </div>
));
