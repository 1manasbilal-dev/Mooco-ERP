import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'lg';

// `ds-button` opts out of the legacy `.dark button:disabled` repaint in index.css.
const BASE =
  'ds-button inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none cursor-pointer ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo active:scale-[.98] ' +
  'disabled:pointer-events-none disabled:opacity-50 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-on shadow-e1-lit hover:bg-brand-hover',
  secondary: 'border border-line bg-surface text-fg shadow-e1 hover:border-line-strong hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  soft: 'bg-brand-soft text-brand-fg hover:bg-brand/15',
  danger: 'bg-danger text-white shadow-e1 hover:bg-danger/90',
  'danger-soft': 'bg-danger-soft text-danger-fg hover:bg-danger/15',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-xs [&_svg]:size-3.5',
  md: 'h-10 rounded-control px-4 text-sm [&_svg]:size-4',
  lg: 'h-12 rounded-control px-5 text-[15px] [&_svg]:size-[18px]',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-lg [&_svg]:size-4',
  md: 'size-10 rounded-control [&_svg]:size-[18px]',
  lg: 'size-12 rounded-control [&_svg]:size-5',
};

export type ButtonProps = React.ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
};

/** The one button for the app. Default `type="button"` so it never submits a form by accident. */
export function Button({
  variant = 'primary', size = 'md', loading = false, leftIcon, rightIcon, fullWidth, className, children, disabled, type = 'button', ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, 'leftIcon' | 'rightIcon' | 'fullWidth' | 'children'> & {
  /** Required: icon-only buttons need an accessible name. */
  'aria-label': string;
  icon: React.ReactNode;
};

/** Square icon-only button. Shows `aria-label` as its tooltip unless a `title` is given. */
export function IconButton({ variant = 'ghost', size = 'md', icon, loading, className, title, disabled, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      title={title ?? props['aria-label']}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], ICON_SIZES[size], className)}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : icon}
    </button>
  );
}
