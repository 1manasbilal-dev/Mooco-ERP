import React, { useId } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../../lib/cn';

// `ds-control` opts out of the legacy `.dark input` overrides in index.css.
const CONTROL =
  'ds-control w-full rounded-control border border-line bg-surface text-sm font-medium text-fg shadow-e1 outline-none ' +
  'placeholder:font-normal placeholder:text-fg-faint transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-line-strong focus:border-brand-accent focus:ring-4 focus:ring-ring/20 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20';

export const controlClass = CONTROL;

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-xs font-semibold text-fg-muted', className)} {...props} />;
}

export interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** Render prop receives the generated id plus aria props to spread on the control. */
  children: (control: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => React.ReactNode;
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error || hint;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </Label>
      )}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': message ? messageId : undefined })}
      {message && (
        <p id={messageId} className={cn('mt-1.5 text-xs', error ? 'font-semibold text-danger-fg' : 'text-fg-subtle')}>
          {message}
        </p>
      )}
    </div>
  );
}

export type InputProps = React.ComponentProps<'input'> & {
  inputSize?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  /** Text or element at the end of the field, e.g. "Rs" or "L". */
  suffix?: React.ReactNode;
};

const INPUT_SIZES = { sm: 'h-8 px-2.5 text-xs', md: 'h-10 px-3', lg: 'h-12 px-4 text-base' } as const;

export function Input({ inputSize = 'md', leftIcon, suffix, className, ...props }: InputProps) {
  if (!leftIcon && !suffix) return <input className={cn(CONTROL, INPUT_SIZES[inputSize], className)} {...props} />;
  return (
    <div className="relative">
      {leftIcon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint [&_svg]:size-4">{leftIcon}</span>}
      <input className={cn(CONTROL, INPUT_SIZES[inputSize], leftIcon && 'pl-9', suffix && 'pr-12', className)} {...props} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-fg-subtle">{suffix}</span>}
    </div>
  );
}

export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className={cn(CONTROL, 'ds-select h-10 cursor-pointer appearance-none pl-3 pr-9', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-20 px-3 py-2.5', className)} {...props} />;
}

export type SearchInputProps = Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
  /** Keyboard hint shown on the right, e.g. "F2". */
  shortcut?: string;
};

/** Search field with icon, clear button and optional shortcut hint. Esc clears it. */
export function SearchInput({ value, onChange, shortcut, className, placeholder = 'Search...', onKeyDown, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
          onKeyDown?.(event);
        }}
        className={cn(CONTROL, 'h-10 pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden')}
        {...props}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Search saaf karein"
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          shortcut && <Kbd>{shortcut}</Kbd>
        )}
      </div>
    </div>
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-surface-2 px-1.5 font-sans text-[10px] font-semibold text-fg-subtle ring-1 ring-inset ring-line',
        className,
      )}
      {...props}
    />
  );
}
