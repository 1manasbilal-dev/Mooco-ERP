import { useMemo, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { Badge, Button, EmptyState, IconButton, Input, Modal } from '../ui';
import { confirmAction } from '../ui/ConfirmDialog';
import { categoryOptions } from './catalogModel';

interface Props {
  onClose: () => void;
  canManage: boolean;
}

/** Add and remove the product categories offered in the product form and the catalog filter. */
export default function CategoryManagerDialog({ onClose, canManage }: Props) {
  const { categories, items, addCategory, removeCategory } = useDairy();
  const [name, setName] = useState('');

  const usage = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(item => (item.category || []).forEach(c => map.set(c.toLowerCase(), (map.get(c.toLowerCase()) || 0) + 1)));
    return map;
  }, [items]);
  const saved = useMemo(() => new Set(categories.map(c => c.toLowerCase())), [categories]);
  const all = useMemo(() => categoryOptions(categories, items), [categories, items]);

  const trimmed = name.trim();
  const duplicate = Boolean(trimmed) && all.some(c => c.toLowerCase() === trimmed.toLowerCase());

  const add = () => {
    if (!trimmed || duplicate) return;
    addCategory(trimmed);
    setName('');
  };

  const remove = async (category: string) => {
    const count = usage.get(category.toLowerCase()) || 0;
    if (count > 0 && !(await confirmAction({
      title: `"${category}" list se hatayen?`,
      message: `${count} product${count === 1 ? '' : 's'} abhi is category mein hain.`,
      consequences: ['Woh products apni category rakhenge.', 'Naye products ke liye yeh option list mein nahi aayega.'],
      confirmLabel: 'Haan, hatayen',
      tone: 'warning',
    }))) return;
    removeCategory(category);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      icon={<div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-muted"><Tag className="size-5" /></div>}
      title="Product categories"
      description="Catalog filter aur product form mein yehi categories aati hain."
      footer={<Button variant="secondary" onClick={onClose}>Band karein</Button>}
    >
      <div className="space-y-4">
        {canManage && (
          <form
            className="flex items-start gap-2"
            onSubmit={event => { event.preventDefault(); add(); }}
          >
            <div className="flex-1">
              <Input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Nayi category, e.g. Sweets"
                aria-label="Nayi category ka naam"
                aria-invalid={duplicate || undefined}
                maxLength={40}
              />
              {duplicate && <p className="mt-1.5 text-xs font-semibold text-danger-fg">Yeh category pehle se maujood hai.</p>}
            </div>
            <Button type="submit" leftIcon={<Plus />} disabled={!trimmed || duplicate}>Add</Button>
          </form>
        )}

        {all.length === 0 ? (
          <EmptyState size="compact" icon={<Tag />} title="Koi category nahi" description="Upar se pehli category add karein." />
        ) : (
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto rounded-control border border-line">
            {all.map(category => {
              const count = usage.get(category.toLowerCase()) || 0;
              const isSaved = saved.has(category.toLowerCase());
              return (
                <li key={category} className="flex items-center justify-between gap-3 px-3.5 py-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-fg">{category}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="neutral">{count} {count === 1 ? 'product' : 'products'}</Badge>
                    {canManage && isSaved ? (
                      <IconButton size="sm" aria-label={`${category} hatayen`} icon={<X />} onClick={() => remove(category)} />
                    ) : (
                      <span className="size-8" aria-hidden="true" />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
