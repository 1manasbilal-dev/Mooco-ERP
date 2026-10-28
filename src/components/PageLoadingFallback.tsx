import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';

/**
 * What a screen shows while its code or data loads. `page` draws a calm skeleton of a typical
 * screen (header, KPI tiles, a list) so the layout does not jump when the page arrives;
 * `overlay` covers the whole window (boot, lock screen). After 8 seconds both offer a reload.
 */
export const PageLoadingFallback: React.FC<{ message?: string; submessage?: string; variant?: 'page' | 'overlay' }> = ({
  message = 'Your workspace is on its way',
  submessage = 'Getting everything ready for you',
  variant = 'page',
}) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [message]);

  const status = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="status" aria-live="polite" aria-atomic="true">
      <Loader2 className="size-5 shrink-0 animate-spin text-brand-accent motion-reduce:animate-none" aria-hidden="true" />
      {/* Wide enough to keep the message whole; the reload button wraps below it on phones. */}
      <div className="min-w-[11rem] flex-1">
        <p className="text-sm font-semibold text-fg">{message}</p>
        <p className="text-xs text-fg-subtle">{slow ? 'Taking a little longer. You can reload if needed.' : submessage}</p>
      </div>
      {slow && (
        <Button variant="secondary" size="sm" leftIcon={<RefreshCw />} onClick={() => window.location.reload()} className="ml-auto shrink-0">
          Reload page
        </Button>
      )}
    </div>
  );

  if (variant === 'overlay') {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-canvas p-6" aria-busy="true">
        <div className="flex w-full max-w-sm flex-col items-center gap-5">
          <span className="flex size-12 items-center justify-center rounded-[14px] bg-brand text-xl font-extrabold text-brand-on shadow-e1-lit" aria-hidden="true">M</span>
          <div className="w-full rounded-card border border-line bg-surface p-4 shadow-e1">{status}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5 py-2 animate-fade-up" aria-busy="true">
      <div className="rounded-card border border-line bg-surface px-4 py-3 shadow-e1">{status}</div>
      <div className="flex items-end justify-between gap-4" aria-hidden="true">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-56 max-w-[60vw]" />
        </div>
        <Skeleton className="hidden h-10 w-32 rounded-control sm:block" />
      </div>
      {/* Phones show the KPI cards folded into one bar (StatGrid). */}
      <Skeleton className="h-[54px] rounded-card md:hidden" />
      <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-e1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28 max-w-full" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1" aria-hidden="true">
        <div className="border-b border-line bg-surface-2 px-5 py-3"><Skeleton className="h-3 w-40" /></div>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-4 border-b border-line/70 px-5 py-3.5 last:border-0">
            <Skeleton className="size-8 shrink-0 rounded-xl" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="hidden h-3.5 w-24 sm:block" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PageLoadingFallback;
