import React from 'react';
import { cn } from '../../lib/cn';

/** Placeholder block while data loads. Size it with classes: `<Skeleton className="h-4 w-24" />`. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('animate-shimmer rounded-lg bg-surface-3/70', className)} {...props} />;
}

/** A few text-line placeholders; the last line is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
