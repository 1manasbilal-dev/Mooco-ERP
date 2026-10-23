import React from 'react';
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, PageHeader } from '../ui';
import { cn } from '../../lib/cn';

// Building blocks shared by every Settings tab, on top of the design-system primitives.

/** Title of the open tab (the app header already says "Settings"). */
export const TabHeader: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({ title, description, action }) => (
  <PageHeader title={title} description={description} actions={action} />
);

/** One card per group of settings: what it is in the header, the fields in the body. */
export const Section: React.FC<{
  title: string; description?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; tone?: 'default' | 'danger';
  className?: string; bodyClassName?: string; children: React.ReactNode;
}> = ({ title, description, icon, actions, tone = 'default', className, bodyClassName, children }) => (
  <Card className={cn(tone === 'danger' && 'ring-1 ring-inset ring-danger/25', className)}>
    <CardHeader title={title} description={description} icon={icon} actions={actions}
      className={cn('[&>div>div>h3]:whitespace-normal', tone === 'danger' && '[&_h3]:text-danger-fg [&>div>span]:bg-danger-soft [&>div>span]:text-danger-fg')} />
    <CardBody className={cn('space-y-4', bodyClassName)}>{children}</CardBody>
  </Card>
);

export const Toggle: React.FC<{ label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }> = ({ label, description, checked, disabled, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="group flex w-full items-start justify-between gap-4 rounded-control bg-surface-2/60 p-3.5 text-left ring-1 ring-inset ring-line transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
  >
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-fg">{label}</span>
      {description && <span className="mt-0.5 block text-xs leading-relaxed text-fg-subtle">{description}</span>}
    </span>
    <span aria-hidden="true" className={cn('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-150', checked ? 'bg-brand' : 'bg-surface-3 ring-1 ring-inset ring-line-strong')}>
      <span className={cn('absolute top-0.5 size-5 rounded-full shadow-e1 transition-transform duration-150 ease-out-expo', checked ? 'translate-x-[1.375rem] bg-brand-on' : 'translate-x-0.5 bg-surface ring-1 ring-line-strong')} />
    </span>
  </button>
);

const NOTICE = {
  info: { cls: 'bg-info-soft text-info-fg ring-info/20', Icon: Info },
  warning: { cls: 'bg-warning-soft text-warning-fg ring-warning/25', Icon: AlertTriangle },
  danger: { cls: 'bg-danger-soft text-danger-fg ring-danger/20', Icon: ShieldAlert },
} as const;

export const Notice: React.FC<{ tone?: keyof typeof NOTICE; icon?: React.ReactNode; children: React.ReactNode }> = ({ tone = 'info', icon, children }) => {
  const { cls, Icon } = NOTICE[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-control p-3 text-xs leading-relaxed ring-1 ring-inset', cls)}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon || <Icon aria-hidden="true" />}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
};

/** Sticky bar that appears while a tab has unsaved changes. */
export const SaveBar: React.FC<{ visible: boolean; saving: boolean; problems?: number; onSave: () => void; onDiscard: () => void }> = ({ visible, saving, problems = 0, onSave, onDiscard }) => {
  if (!visible) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-6 flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-e3 animate-fade-up sm:flex-row sm:items-center sm:justify-between" role="region" aria-label="Unsaved changes">
      <p className="flex items-center gap-2 px-1 text-sm font-semibold text-fg">
        <span className={cn('size-2 shrink-0 rounded-full', problems ? 'bg-danger' : 'bg-warning')} aria-hidden="true" />
        {problems ? `${problems} ${problems === 1 ? 'cheez' : 'cheezein'} theek karni hain` : 'Tabdeeliyan abhi save nahi huin'}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onDiscard} disabled={saving} className="flex-1 sm:flex-none">Discard</Button>
        <Button onClick={onSave} loading={saving} className="flex-1 sm:flex-none">{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </div>
  );
};
