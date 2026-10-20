import React, { memo, useMemo, useState } from 'react';
import { ChevronDown, Clock3, Lock, Search, Star, X } from 'lucide-react';
import { ReportIcon } from './ReportIcon';
import { REPORT_CATEGORIES, searchReports } from '../../lib/reports/registry';
import type { ReportDefinition } from '../../lib/reports/types';

interface Props {
  reports: ReportDefinition[];
  activeId?: string;
  favourites: string[];
  recent: string[];
  isLocked: (report: ReportDefinition) => boolean;
  onOpen: (id: string) => void;
  onToggleFavourite: (id: string) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

const Item: React.FC<{
  report: ReportDefinition; active: boolean; locked: boolean; favourite: boolean; onOpen: () => void; onToggleFavourite: () => void;
}> = ({ report, active, locked, favourite, onOpen, onToggleFavourite }) => (
  <div className={`group flex items-center rounded-xl transition-colors ${active ? 'bg-lime-100/80 dark:bg-lime-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800/60'}`}>
    <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined}
      className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-lime-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-white dark:bg-slate-800 dark:text-slate-400'}`}>
        <ReportIcon name={report.icon} size={14} />
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[13px] font-semibold ${active ? 'text-lime-900 dark:text-lime-200' : 'text-slate-700 dark:text-slate-200'}`}>{report.title}</span>
        <span className="block truncate text-[10.5px] text-slate-400">{report.subtitle}</span>
      </span>
      {locked && <Lock size={12} className="ml-auto shrink-0 text-slate-400" aria-label="No access" />}
    </button>
    <button type="button" onClick={onToggleFavourite} aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={favourite}
      className={`mr-1 rounded-lg p-1.5 transition-opacity ${favourite ? 'text-amber-500' : 'text-slate-300 opacity-0 hover:text-amber-500 group-hover:opacity-100 focus:opacity-100'}`}>
      <Star size={13} fill={favourite ? 'currentColor' : 'none'} />
    </button>
  </div>
);

export const ReportCatalog = memo(({ reports, activeId, favourites, recent, isLocked, onOpen, onToggleFavourite, searchRef }: Props) => {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const results = useMemo(() => searchReports(reports, query), [reports, query]);
  const byId = useMemo(() => new Map(reports.map(r => [r.id, r])), [reports]);

  const row = (report: ReportDefinition) => (
    <Item key={report.id} report={report} active={report.id === activeId} locked={isLocked(report)}
      favourite={favourites.includes(report.id)} onOpen={() => onOpen(report.id)} onToggleFavourite={() => onToggleFavourite(report.id)} />
  );

  const pinned = (ids: string[]) => ids.map(id => byId.get(id)).filter(Boolean) as ReportDefinition[];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <label className="relative flex items-center">
          <Search size={14} className="pointer-events-none absolute left-3 text-slate-400" />
          <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a report…  ( / )" aria-label="Find a report"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="absolute right-2 rounded p-1 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
        </label>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4" aria-label="Reports">
        {query ? (
          <div className="space-y-0.5">
            <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{results.length} found</p>
            {results.map(row)}
            {!results.length && <p className="px-3 py-6 text-center text-xs text-slate-400">No report matches “{query}”</p>}
          </div>
        ) : (
          <>
            {favourites.length > 0 && (
              <section className="space-y-0.5">
                <h4 className="flex items-center gap-1.5 px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-amber-600"><Star size={11} fill="currentColor" />Favourites</h4>
                {pinned(favourites).map(row)}
              </section>
            )}
            {recent.length > 0 && (
              <section className="space-y-0.5">
                <h4 className="flex items-center gap-1.5 px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Clock3 size={11} />Recent</h4>
                {pinned(recent.filter(id => !favourites.includes(id)).slice(0, 4)).map(row)}
              </section>
            )}
            {REPORT_CATEGORIES.map(category => {
              const list = reports.filter(r => r.category === category.id);
              if (!list.length) return null;
              const isCollapsed = collapsed.has(category.id);
              return (
                <section key={category.id} className="space-y-0.5">
                  <button type="button" aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed(prev => { const next = new Set(prev); next.has(category.id) ? next.delete(category.id) : next.add(category.id); return next; })}
                    className="flex w-full items-center gap-1.5 px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                    <ReportIcon name={category.icon} size={11} />{category.label}
                    <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[9px] text-slate-500 dark:bg-slate-800">{list.length}</span>
                    <ChevronDown size={12} className={`ml-auto transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                  {!isCollapsed && list.map(row)}
                </section>
              );
            })}
          </>
        )}
      </nav>
    </div>
  );
});
