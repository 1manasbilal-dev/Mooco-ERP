import React from 'react';
import { cn } from '../../lib/cn';

export type PageHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** The app header already shows the screen name, so a page title is optional. */
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
};

/** Top of a screen: optional title/description on the left, primary actions on the right. Wraps on phones. */
export function PageHeader({ title, description, eyebrow, actions, className, children, ...props }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-fg">
              <span className="size-1.5 rounded-full bg-brand-accent" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          {title && <h2 className="text-balance text-2xl font-bold tracking-tight text-fg sm:text-[26px]">{title}</h2>}
          {description && <p className="mt-1 max-w-2xl text-sm text-fg-subtle">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Search + filters + actions row above a list. Sticks under the app header when `sticky` is set. */
export function Toolbar({ className, sticky, ...props }: React.ComponentProps<'div'> & { sticky?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-2 shadow-e1',
        sticky && 'sticky top-0 z-10',
        className,
      )}
      {...props}
    />
  );
}
