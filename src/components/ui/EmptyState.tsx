import React from 'react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Usually one primary Button. */
  action?: React.ReactNode;
  /** `compact` for empty table bodies and side panels. */
  size?: 'compact' | 'default';
  className?: string;
}

/** What a list or panel shows when there is nothing in it yet: what is missing and what to do next. */
export function EmptyState({ icon, title, description, action, size = 'default', className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', size === 'compact' ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      {icon && (
        <span
          className={cn(
            'flex items-center justify-center rounded-2xl bg-surface-2 text-fg-faint ring-1 ring-inset ring-line',
            size === 'compact' ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-6',
          )}
        >
          {icon}
        </span>
      )}
      <div className="max-w-sm space-y-1">
        <p className={cn('font-bold text-fg', size === 'compact' ? 'text-sm' : 'text-base')}>{title}</p>
        {description && <p className="text-[13px] text-fg-subtle">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
