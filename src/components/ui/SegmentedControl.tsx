import React from 'react';
import { cn } from '../../lib/cn';

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Small count bubble after the label. */
  count?: number;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `pill`: filled track (filters, periods). `underline`: page-level tabs. */
  variant?: 'pill' | 'underline';
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  'aria-label': string;
  className?: string;
}

/** Tabs / period switcher. Arrow keys move between options. */
export function SegmentedControl<T extends string>({
  options, value, onChange, variant = 'pill', size = 'md', fullWidth, className, ...props
}: SegmentedControlProps<T>) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const enabled = options.filter(o => !o.disabled);
    const index = enabled.findIndex(o => o.value === value);
    const next = enabled[(index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons[options.indexOf(next)]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={props['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        'flex max-w-full items-center overflow-x-auto scrollbar-hide',
        variant === 'pill' ? 'gap-1 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line/70' : 'gap-5 border-b border-line',
        fullWidth ? 'w-full' : 'w-fit',
        className,
      )}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
              fullWidth && 'flex-1',
              variant === 'pill'
                ? cn(
                    'rounded-[calc(var(--radius-control)-4px)]',
                    size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
                    active ? 'bg-surface text-fg shadow-e1' : 'text-fg-subtle hover:text-fg',
                  )
                : cn(
                    '-mb-px border-b-2 pb-2.5 pt-1 text-sm',
                    active ? 'border-brand-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg',
                  ),
            )}
          >
            {option.icon}
            {option.label}
            {typeof option.count === 'number' && (
              <span
                className={cn(
                  'min-w-5 rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4',
                  active ? 'bg-brand-soft text-brand-fg' : 'bg-surface-3 text-fg-subtle',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
