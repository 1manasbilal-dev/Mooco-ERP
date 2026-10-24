import React, { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3, Lock, SearchX, Star } from 'lucide-react';
import { ReportIcon } from './ReportIcon';
import { Card, CardHeader, EmptyState, IconButton, SearchInput } from '../ui';
import { cn } from '../../lib/cn';
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

const FavouriteButton = ({ on, title, onToggle, className }: { on: boolean; title: string; onToggle: () => void; className?: string }) => (
  <IconButton size="sm" variant="ghost" onClick={onToggle} aria-pressed={on} aria-label={on ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
    icon={<Star fill={on ? 'currentColor' : 'none'} />}
    className={cn(on ? 'text-warning hover:text-warning' : 'text-fg-faint hover:text-warning', className)} />
);

const Item = memo(({ report, active, locked, favourite, onOpen, onToggleFavourite }: {
  report: ReportDefinition; active: boolean; locked: boolean; favourite: boolean; onOpen: (id: string) => void; onToggleFavourite: (id: string) => void;
}) => (
  <div className={cn('group flex items-center rounded-control transition-colors duration-150', active ? 'bg-brand-soft' : 'hover:bg-surface-2')}>
    <button type="button" onClick={() => onOpen(report.id)} aria-current={active ? 'page' : undefined}
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-brand text-brand-on' : 'bg-surface-2 text-fg-subtle group-hover:bg-surface')}>
        <ReportIcon name={report.icon} size={14} />
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px] font-semibold', active ? 'text-brand-fg' : 'text-fg')}>{report.title}</span>
        <span className="block truncate text-[11px] text-fg-subtle">{report.subtitle}</span>
      </span>
      {locked && <Lock size={12} className="ml-auto shrink-0 text-fg-faint" aria-label="No access" />}
    </button>
    <FavouriteButton on={favourite} title={report.title} onToggle={() => onToggleFavourite(report.id)}
      className={cn('mr-1 shrink-0', !favourite && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100')} />
  </div>
));

const GroupLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <h4 className={cn('flex items-center gap-1.5 px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-fg-subtle', className)}>{children}</h4>
);

/** Report list for the docked sidebar and the phone drawer. */
export const ReportCatalog = memo(({ reports, activeId, favourites, recent, isLocked, onOpen, onToggleFavourite, searchRef }: Props) => {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const results = useMemo(() => searchReports(reports, query), [reports, query]);
  const byId = useMemo(() => new Map(reports.map(r => [r.id, r])), [reports]);
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);

  const row = (report: ReportDefinition) => (
    <Item key={report.id} report={report} active={report.id === activeId} locked={isLocked(report)}
      favourite={favouriteSet.has(report.id)} onOpen={onOpen} onToggleFavourite={onToggleFavourite} />
  );
  const pinned = (ids: string[]) => ids.map(id => byId.get(id)).filter(Boolean) as ReportDefinition[];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <SearchInput ref={searchRef as any} value={query} onChange={setQuery} placeholder="Find a report…" aria-label="Find a report" shortcut="/" />
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-2 pb-4" aria-label="Reports">
        {query ? (
          <div className="space-y-0.5">
            <GroupLabel>{results.length} found</GroupLabel>
            {results.map(row)}
            {!results.length && <EmptyState size="compact" icon={<SearchX />} title={`No report matches “${query}”`} />}
          </div>
        ) : (
          <>
            {favourites.length > 0 && (
              <section className="space-y-0.5">
                <GroupLabel className="text-warning-fg"><Star size={11} fill="currentColor" aria-hidden="true" />Favourites</GroupLabel>
                {pinned(favourites).map(row)}
              </section>
            )}
            {recent.length > 0 && (
              <section className="space-y-0.5">
                <GroupLabel><Clock3 size={11} aria-hidden="true" />Recent</GroupLabel>
                {pinned(recent.filter(id => !favouriteSet.has(id)).slice(0, 4)).map(row)}
              </section>
            )}
            {REPORT_CATEGORIES.map(category => {
              const list = reports.filter(r => r.category === category.id);
              if (!list.length) return null;
              const isCollapsed = collapsed.has(category.id);
              return (
                <section key={category.id} className="space-y-0.5">
                  <button type="button" aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed(prev => { const next = new Set(prev); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ReportIcon name={category.icon} size={11} />{category.label}
                    <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-[9.5px] tabular-nums text-fg-subtle">{list.length}</span>
                    <ChevronDown size={12} className={cn('ml-auto transition-transform duration-150', isCollapsed && '-rotate-90')} aria-hidden="true" />
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

/** A favourite or recent report as a card on the Reports home. */
export const ReportCard = memo(({ report, locked, favourite, onOpen, onToggleFavourite }: {
  report: ReportDefinition; locked: boolean; favourite: boolean; onOpen: (id: string) => void; onToggleFavourite: (id: string) => void;
}) => (
  <Card variant="interactive" className="group relative flex items-center gap-3 p-3">
    <button type="button" onClick={() => onOpen(report.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-control text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-fg transition-colors duration-150 group-hover:bg-brand group-hover:text-brand-on">
        <ReportIcon name={report.icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-fg">{report.title}</span>
        <span className="block truncate text-xs text-fg-subtle">{report.subtitle}</span>
      </span>
    </button>
    {locked && <Lock size={13} className="shrink-0 text-fg-faint" aria-label="No access" />}
    <FavouriteButton on={favourite} title={report.title} onToggle={() => onToggleFavourite(report.id)} className="relative z-[1] shrink-0" />
  </Card>
));

/** Every report as cards grouped by area, filtered by the home search. */
export const ReportCatalogGrid = memo(({ reports, query, isLocked, onOpen }: {
  reports: ReportDefinition[]; query: string; isLocked: (r: ReportDefinition) => boolean; onOpen: (id: string) => void;
}) => {
  const results = useMemo(() => searchReports(reports, query), [reports, query]);
  if (!results.length) {
    return (
      <Card>
        <EmptyState icon={<SearchX />} title={`No report matches “${query}”`} description="Try another word: sales, ledger, milk, stock, profit, cash…" />
      </Card>
    );
  }
  return (
    // Columns pack the uneven area cards (1 report next to 11) without gaps; reading order runs down each column.
    <div className="gap-4 md:columns-2 2xl:columns-3">
      {REPORT_CATEGORIES.map(cat => {
        const list = results.filter(r => r.category === cat.id);
        if (!list.length) return null;
        return (
          <Card key={cat.id} className="mb-4 break-inside-avoid animate-fade-up">
            <CardHeader title={cat.label} icon={<ReportIcon name={cat.icon} />}
              actions={<span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold tabular-nums text-fg-subtle">{list.length}</span>} />
            <ul className="space-y-0.5 px-2 pb-3">
              {list.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => onOpen(r.id)}
                    className="group flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ReportIcon name={r.icon} size={14} className="shrink-0 text-fg-faint group-hover:text-brand-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-fg">{r.title}</span>
                      <span className="block truncate text-[11px] text-fg-subtle">{r.subtitle}</span>
                    </span>
                    {isLocked(r)
                      ? <Lock size={12} className="shrink-0 text-fg-faint" aria-label="No access" />
                      : <ChevronRight size={14} className="shrink-0 text-fg-faint group-hover:text-brand-accent" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
});
