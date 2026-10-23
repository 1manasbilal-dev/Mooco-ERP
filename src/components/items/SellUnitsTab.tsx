import React from 'react';
import { AlertTriangle, Check, Eye, EyeOff, Layers, Package, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { ItemDefinition, ItemVariant } from '../../types';
import { Badge, Button, Field, IconButton, Input, Money, Select } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { compareWithLoose, pricePerBase, sellUnitContains, sellUnitPresets, sellUnitPrice } from '../../lib/sellUnits';
import { Switch } from './Switch';

export type SellUnitKind = 'multi_unit' | 'packaging';

export interface SellUnitDraft {
  name: string;
  packId: string;
  packQty: string;
  productQty: string;
  price: string;
  fromBase: boolean;
}

interface Props {
  baseUnit: string;
  looseRate: number;
  costRate: number;
  allowLoose: boolean;
  onToggleLoose: () => void;
  variants: ItemVariant[];
  /** Live stock when editing a saved product; null while creating one. */
  liveLoose: number | null;
  liveVariantStocks: Record<string, number>;
  packagingMaterials: ItemDefinition[];
  draft: SellUnitDraft;
  setDraft: (next: SellUnitDraft) => void;
  kind: SellUnitKind;
  onKindChange: (kind: SellUnitKind) => void;
  editingIndex: number;
  onSubmit: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onToggleActive: (index: number) => void;
  onCancelEdit: () => void;
}

/** Problems with the unit being typed, shown before Save so nothing confusing gets stored. */
export function sellUnitDraftIssues(draft: SellUnitDraft, kind: SellUnitKind, baseUnit: string, variants: ItemVariant[], editingIndex: number): string[] {
  const issues: string[] = [];
  const name = draft.name.trim();
  const contains = Number(draft.productQty);
  if (name && name.toLowerCase() === baseUnit.trim().toLowerCase()) issues.push('Same as the base unit.');
  if (name && variants.some((v, i) => i !== editingIndex && (v.name || '').trim().toLowerCase() === name.toLowerCase())) issues.push('A unit with this name already exists.');
  if (draft.productQty !== '' && !(contains > 0)) issues.push('Size must be more than 0.');
  if (kind === 'multi_unit' && contains === 1 && name) issues.push(`Size is 1 ${baseUnit}, same as the base unit.`);
  if (draft.price !== '' && !(Number(draft.price) > 0)) issues.push('Leave price empty for auto, or enter more than 0.');
  if (kind === 'packaging' && draft.packId && draft.packQty !== '' && !(Number(draft.packQty) > 0)) issues.push('Packaging per pack must be more than 0.');
  return issues;
}

const KINDS = [
  { id: 'multi_unit' as const, icon: Layers, title: 'Loose stock se', sub: 'Dozen, tray, pao: main stock se katta hai' },
  { id: 'packaging' as const, icon: Package, title: 'Ready-made pack', sub: 'Cup, bottle, packet: apna alag stock' },
];

const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => event.currentTarget.blur();

/** Every way a product sells (loose and its units), plus the add / edit unit form. */
export const SellUnitsTab: React.FC<Props> = ({
  baseUnit, looseRate, costRate, allowLoose, onToggleLoose, variants, liveLoose, liveVariantStocks, packagingMaterials,
  draft, setDraft, kind, onKindChange, editingIndex, onSubmit, onEdit, onRemove, onToggleActive, onCancelEdit,
}) => {
  const isMulti = kind === 'multi_unit';
  const contains = Number(draft.productQty);
  const hasSize = contains > 0;
  const draftPrice = hasSize ? sellUnitPrice(looseRate, contains, draft.price ? Number(draft.price) : undefined) : 0;
  const draftEach = hasSize ? pricePerBase(draftPrice, contains) : 0;
  const draftCompare = compareWithLoose(draftEach, looseRate);
  const material = packagingMaterials.find(p => p.id === draft.packId);
  const materialQty = draft.packId ? (Number(draft.packQty) > 0 ? Number(draft.packQty) : 1) : 0;
  const draftCost = hasSize ? costRate * contains + (!isMulti && material ? (Number(material.cost_price) || 0) * materialQty : 0) : 0;
  const draftProfit = draftPrice - draftCost;
  const issues = sellUnitDraftIssues(draft, kind, baseUnit, variants, editingIndex);
  const canSave = Boolean(draft.name.trim()) && hasSize && issues.length === 0;
  const editing = editingIndex >= 0;
  const editingHasStock = editing && variants[editingIndex]?.deduct_from_base !== true && Math.abs(Number(liveVariantStocks[variants[editingIndex]?.id]) || 0) > 0.0001;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Selling units</h4>
          <span className="text-xs text-fg-subtle">Base: 1 {baseUnit}</span>
        </div>

        <ul className="divide-y divide-line/70">
          <li className="px-4 py-2.5">
            <Switch
              checked={allowLoose}
              onChange={onToggleLoose}
              label={<span className="flex items-center gap-2">1 {baseUnit} <Badge tone="success">Loose</Badge></span>}
              description={<>
                {looseRate > 0 ? formatCurrency(looseRate) : 'No price'}
                {liveLoose !== null ? ` · ${formatQty(liveLoose, 3)} ${baseUnit} stock mein` : ''}
                {allowLoose ? '' : ' · loose nahi bikta'}
              </>}
            />
          </li>

          {variants.map((v, index) => {
            const vContains = sellUnitContains(v);
            const price = sellUnitPrice(looseRate, vContains, v.selling_price);
            const each = pricePerBase(price, vContains);
            const compare = compareWithLoose(each, looseRate);
            const fromBase = v.deduct_from_base === true;
            const pack = packagingMaterials.find(p => p.id === v.packaging_item_id);
            const costEach = costRate * vContains + (!fromBase && pack ? (Number(pack.cost_price) || 0) * (Number(v.packaging_qty) || 0) : 0);
            const own = Number(liveVariantStocks[v.id]) || 0;
            const active = v.isActive !== false;
            const problem = costRate > 0 && price > 0 && price < costEach - 0.005
              ? `Cost se kam (${formatCurrency(costEach)})`
              : (!fromBase && own < 0 ? 'Pack stock minus mein hai' : '');
            const stock = liveLoose === null || fromBase ? '' : `${formatQty(own, 3)} stock mein`;
            return (
              <li key={v.id} className={cn('flex items-center justify-between gap-3 px-4 py-3', editingIndex === index && 'bg-brand-soft/50', !active && 'opacity-60')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-fg">{v.name}</span>
                    <span className="text-xs tabular-nums text-fg-subtle">{formatQty(vContains, 3)} {baseUnit}</span>
                    {fromBase ? <Badge tone="info">From loose</Badge> : <Badge tone="warning">Own stock</Badge>}
                    {!active && <Badge tone="neutral">Hidden</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {price > 0 ? <Money amount={price} className="font-semibold text-fg-muted" /> : 'No price'}
                    {compare.text ? ` · ${compare.text}` : ''}
                    {stock ? ` · ${stock}` : ''}
                  </p>
                  {problem && <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-danger-fg"><AlertTriangle className="size-3" />{problem}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton size="sm" aria-label={`Edit ${v.name}`} icon={<Pencil />} onClick={() => onEdit(index)} />
                  <IconButton size="sm" aria-label={active ? `${v.name} POS mein chhupayen` : `${v.name} POS mein dikhayen`} icon={active ? <Eye /> : <EyeOff />} onClick={() => onToggleActive(index)} />
                  <IconButton size="sm" aria-label={`${v.name} hatayen`} icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onRemove(index)} />
                </div>
              </li>
            );
          })}
        </ul>
        {variants.length === 0 && (
          <p className="border-t border-line/70 px-4 py-3 text-xs text-fg-subtle">Abhi koi pack ya unit nahi. Neeche se dozen, pao ya cup jaisa unit add karein.</p>
        )}
      </section>

      <section
        className="space-y-4 rounded-card border border-line bg-surface-2/60 p-4"
        onKeyDown={event => {
          // Enter in a unit field adds the unit instead of saving the whole product.
          if (event.key !== 'Enter' || (event.target as HTMLElement).tagName !== 'INPUT') return;
          event.preventDefault();
          if (canSave) onSubmit();
        }}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-[15px] font-bold tracking-tight text-fg">{editing ? `Edit: ${variants[editingIndex]?.name || 'unit'}` : 'Naya unit add karein'}</h4>
          {editing && <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button>}
        </div>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Unit ki qisam">
          {KINDS.map(option => {
            const selected = kind === option.id;
            const Icon = option.icon;
            const locked = editingHasStock && !selected;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                title={locked ? 'Is pack ka stock hai, is liye qisam nahi badal sakti' : undefined}
                onClick={() => onKindChange(option.id)}
                className={cn(
                  'flex items-center gap-3 rounded-control border bg-surface p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40',
                  selected ? 'border-brand-accent ring-1 ring-brand-accent' : 'border-line hover:border-line-strong',
                )}
              >
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-fg-subtle')}>
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">{option.title}</span>
                  <span className="block text-[11px] text-fg-subtle">{option.sub}</span>
                </span>
                {selected && <Check className="ml-auto size-4 shrink-0 text-brand-fg" />}
              </button>
            );
          })}
        </div>

        {isMulti && baseUnit && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Aam units">
            {sellUnitPresets(baseUnit).map(preset => (
              <Button key={preset.name} size="sm" variant="secondary" onClick={() => setDraft({ ...draft, name: preset.name, productQty: String(preset.contains), price: '' })}>
                {preset.name}
              </Button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Naam" className="col-span-2 sm:col-span-1">
            {control => <Input {...control} placeholder={isMulti ? 'Dozen' : 'Cup'} value={draft.name} maxLength={40} onChange={e => setDraft({ ...draft, name: e.target.value })} />}
          </Field>
          <Field label={`Size (${baseUnit})`}>
            {control => (
              <Input {...control} type="number" inputMode="decimal" min="0.001" step="any" className="tabular-nums" placeholder={isMulti ? '12' : '0.5'}
                value={draft.productQty} onWheel={blurOnWheel} onChange={e => setDraft({ ...draft, productQty: e.target.value })} />
            )}
          </Field>
          <Field label="Price">
            {control => (
              <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix="Rs" className="tabular-nums"
                placeholder={hasSize && looseRate > 0 ? `${sellUnitPrice(looseRate, contains)} auto` : 'Auto'}
                value={draft.price} onWheel={blurOnWheel} onChange={e => setDraft({ ...draft, price: e.target.value })} />
            )}
          </Field>
        </div>

        {!isMulti && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Packaging material" className="col-span-2">
              {control => (
                <Select {...control} value={draft.packId} onChange={e => setDraft({ ...draft, packId: e.target.value })}>
                  <option value="">Koi nahi</option>
                  {packagingMaterials.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Per pack">
              {control => (
                <Input {...control} type="number" inputMode="decimal" min="0.001" step="any" className="tabular-nums" placeholder="1"
                  value={draft.packQty} disabled={!draft.packId} onWheel={blurOnWheel} onChange={e => setDraft({ ...draft, packQty: e.target.value })} />
              )}
            </Field>
          </div>
        )}

        {hasSize && (
          <div className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm">
            <span className="min-w-0 font-semibold text-fg">
              1 {draft.name.trim() || 'unit'} = {formatQty(contains, 3)} {baseUnit}
              {draftCompare.text && <span className="font-normal text-fg-subtle"> · {draftCompare.text}</span>}
            </span>
            <span className="shrink-0 text-right">
              {draftPrice > 0 ? <Money amount={draftPrice} className="font-bold text-fg" /> : <span className="text-fg-faint">—</span>}
              {costRate > 0 && draftPrice > 0 && (
                <span className={cn('block text-[11px] font-semibold', draftProfit < 0 ? 'text-danger-fg' : 'text-success-fg')}>
                  {draftProfit < 0 ? 'Nuqsan' : 'Profit'} {formatCurrency(Math.abs(draftProfit))}
                </span>
              )}
            </span>
          </div>
        )}

        {issues.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-danger-fg"><AlertTriangle className="size-3.5 shrink-0" />{issues[0]}</p>
        )}

        <Button fullWidth variant={canSave ? 'primary' : 'secondary'} leftIcon={editing ? <Save /> : <Plus />} onClick={onSubmit} disabled={!canSave}>
          {editing ? 'Update unit' : 'Add unit'}
        </Button>
      </section>
    </div>
  );
};
