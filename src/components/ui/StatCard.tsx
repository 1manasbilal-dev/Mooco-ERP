import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Tone } from './Badge';
import { Skeleton } from './Skeleton';

const ICON_TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  brand: 'bg-brand-soft text-brand-fg',
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  info: 'bg-info-soft text-info-fg',
};

const VALUE_TONE: Partial<Record<Tone, string>> = {
  success: 'text-success-fg',
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
};

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Colours the icon chip; `success`/`danger`/`warning` also colour the value. */
  tone?: Tone;
  /** Change versus a previous period, in percent. */
  trend?: number | null;
  /** Expenses and dues get better when they go down. */
  trendGoodWhen?: 'up' | 'down';
  trendLabel?: React.ReactNode;
  /** Small line under the value, e.g. "6 bills". */
  hint?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

/** KPI tile: label, big tabular value, optional trend and hint. Clickable when `onClick` is set. */
export function StatCard({
  label, value, icon, tone = 'neutral', trend, trendGoodWhen = 'up', trendLabel, hint, loading, onClick, className,
}: StatCardProps) {
  const hasTrend = typeof trend === 'number' && Number.isFinite(trend);
  const isUp = hasTrend && trend >= 0;
  const isGood = hasTrend && (trendGoodWhen === 'up' ? isUp : !isUp);
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 text-left shadow-e1 sm:p-5',
        onClick && 'cursor-pointer transition-[box-shadow,border-color,transform] duration-200 ease-out-expo hover:-translate-y-px hover:border-line-strong hover:shadow-e2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {/* Two cards share a phone row: the label gets the icon's room there, so it is not cut off. */}
        {icon && <span className={cn('hidden size-8 shrink-0 items-center justify-center rounded-lg sm:flex [&_svg]:size-4', ICON_TONE[tone])}>{icon}</span>}
        <span className="truncate text-[13px] font-semibold text-fg-subtle">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-32" />
      ) : (
        <div className={cn('truncate text-2xl font-bold leading-none tracking-tight tabular-nums text-fg sm:text-[28px]', VALUE_TONE[tone])}>{value}</div>
      )}
      {(hasTrend || hint || trendLabel) && (
        <div className="flex min-w-0 items-center gap-2 text-xs">
          {hasTrend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold tabular-nums',
                isGood ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger-fg',
              )}
            >
              {isUp ? <ArrowUpRight className="size-3" aria-hidden="true" /> : <ArrowDownRight className="size-3" aria-hidden="true" />}
              {Math.abs(trend).toFixed(1).replace(/\.0$/, '')}%
            </span>
          )}
          {trendLabel && <span className="truncate text-fg-subtle">{trendLabel}</span>}
          {hint && <span className="ml-auto truncate text-fg-subtle">{hint}</span>}
        </div>
      )}
    </Comp>
  );
}
