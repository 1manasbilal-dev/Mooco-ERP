import React from 'react';
import { cn } from '../../lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off setting with its label and an optional line of explanation. The whole row is clickable. */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full cursor-pointer items-start justify-between gap-4 rounded-control px-1 py-1 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-fg-subtle">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150',
          checked ? 'bg-brand' : 'bg-surface-3 ring-1 ring-inset ring-line-strong/60',
        )}
      >
        <span className={cn('size-5 rounded-full bg-white shadow-e1 transition-transform duration-150 ease-out-expo', checked ? 'translate-x-4' : 'translate-x-0')} />
      </span>
    </button>
  );
}
