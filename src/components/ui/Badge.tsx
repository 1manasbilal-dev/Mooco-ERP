import React from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'info';

const SOFT: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted ring-line',
  brand: 'bg-brand-soft text-brand-fg ring-brand/20',
  success: 'bg-success-soft text-success-fg ring-success/20',
  danger: 'bg-danger-soft text-danger-fg ring-danger/20',
  warning: 'bg-warning-soft text-warning-fg ring-warning/25',
  info: 'bg-info-soft text-info-fg ring-info/20',
};

const SOLID: Record<Tone, string> = {
  neutral: 'bg-fg text-surface ring-transparent',
  brand: 'bg-brand text-brand-on ring-transparent',
  success: 'bg-success text-white ring-transparent',
  danger: 'bg-danger text-white ring-transparent',
  warning: 'bg-warning text-white ring-transparent',
  info: 'bg-info text-white ring-transparent',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-fg-faint',
  brand: 'bg-brand-accent',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
};

export type BadgeProps = React.ComponentProps<'span'> & {
  tone?: Tone;
  variant?: 'soft' | 'solid';
  size?: 'sm' | 'md';
  /** Leading status dot. */
  dot?: boolean;
  icon?: React.ReactNode;
};

/** Status pill. Uses a ring (not `border`) so the legacy dark-mode border overrides never recolour it. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'sm', dot, icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
        size === 'sm' ? 'h-6 px-2.5 text-[11px] [&_svg]:size-3' : 'h-7 px-3 text-xs [&_svg]:size-3.5',
        variant === 'solid' ? SOLID[tone] : SOFT[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('size-1.5 rounded-full', variant === 'solid' ? 'bg-current' : DOT[tone])} aria-hidden="true" />}
      {icon}
      {children}
    </span>
  );
}

export const TONE_DOT = DOT;
