import React from 'react';
import { Loader2 } from 'lucide-react';

// Building blocks shared by every Settings tab.

export const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 shadow-2xs outline-none transition focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-900 dark:disabled:text-slate-500';

export const buttonClass = {
  primary: 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-lime-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-lime-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
  secondary: 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50',
  ghost: 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800',
};

export const PageHeader: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({ title, description, action }) => (
  <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-slate-800">
    <div className="min-w-0">
      <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">{title}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

/** Two-column section: what it is on the left, the fields on the right (stacks on phones). */
export const Section: React.FC<{ title: string; description?: React.ReactNode; children: React.ReactNode }> = ({ title, description, children }) => (
  <section className="grid gap-4 border-b border-slate-100 py-6 last:border-b-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8 dark:border-slate-800/70">
    <div>
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
      {description && <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
    <div className="min-w-0 space-y-4">{children}</div>
  </section>
);

export const Field: React.FC<{ label: string; hint?: React.ReactNode; required?: boolean; htmlFor?: string; children: React.ReactNode }> = ({ label, hint, required, htmlFor, children }) => (
  <div className="min-w-0 space-y-1.5">
    <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-700 dark:text-slate-300">
      {label} {required && <span className="text-rose-500">*</span>}
    </label>
    {children}
    {hint && <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">{hint}</p>}
  </div>
);

export const Toggle: React.FC<{ label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }> = ({ label, description, checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="flex w-full items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600"
  >
    <span className="min-w-0">
      <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>
      {description && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</span>}
    </span>
    <span className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-lime-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

export const Notice: React.FC<{ tone?: 'info' | 'warning' | 'danger'; icon?: React.ReactNode; children: React.ReactNode }> = ({ tone = 'info', icon, children }) => {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
    warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
    danger: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
  };
  return (
    <div className={`flex gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${tones[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
};

export const Pill: React.FC<{ tone?: 'lime' | 'slate' | 'amber' | 'violet' | 'rose'; children: React.ReactNode }> = ({ tone = 'slate', children }) => {
  const tones = {
    lime: 'bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
};

/** Sticky bar that appears while a tab has unsaved changes. */
export const SaveBar: React.FC<{ visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }> = ({ visible, saving, onSave, onDiscard }) => {
  if (!visible) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900/95" role="region" aria-label="Unsaved changes">
      <p className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
        Tabdeeliyan abhi save nahi huin
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onDiscard} disabled={saving} className={`${buttonClass.secondary} flex-1 sm:flex-none`}>Discard</button>
        <button type="button" onClick={onSave} disabled={saving} className={`${buttonClass.primary} flex-1 sm:flex-none`}>
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
};
