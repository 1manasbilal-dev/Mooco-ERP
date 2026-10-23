import React from 'react';
import { cn } from '../../lib/cn';

export type CardProps = React.ComponentProps<'div'> & {
  /** `raised` (default) for content cards, `inset` for panels inside a card, `interactive` for clickable cards. */
  variant?: 'raised' | 'inset' | 'interactive';
  padded?: boolean;
};

const CARD_VARIANTS = {
  raised: 'border border-line bg-surface shadow-e1',
  inset: 'border border-line/70 bg-surface-2',
  interactive:
    'border border-line bg-surface shadow-e1 cursor-pointer transition-[box-shadow,border-color,transform] duration-200 ease-out-expo hover:-translate-y-px hover:border-line-strong hover:shadow-e2',
} as const;

export function Card({ variant = 'raised', padded = false, className, ...props }: CardProps) {
  return <div className={cn('rounded-card', CARD_VARIANTS[variant], padded && 'p-5', className)} {...props} />;
}

export type CardHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small label above the title. */
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
};

export function CardHeader({ title, description, eyebrow, icon, actions, className, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pb-3 pt-4', className)} {...props}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-muted [&_svg]:size-[18px]">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{eyebrow}</p>}
          <h3 className="truncate text-[15px] font-bold tracking-tight text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-fg-subtle">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3', className)} {...props} />;
}
