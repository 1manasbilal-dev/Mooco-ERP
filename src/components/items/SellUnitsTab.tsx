import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Eye, EyeOff, Info, Layers, Lock, Package, PackagePlus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import type { ItemDefinition, ItemVariant } from '../../types';
import { Badge, Button, Field, IconButton, Input, Money, Select } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { compareWithLoose, pricePerBase, sellUnitContains, sellUnitPresets, sellUnitPrice } from '../../lib/sellUnits';
import { formatBaseQty } from '../../lib/stockRules';
import { countOnUnit } from './catalogModel';
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
  /** Starts a new ready-made pack next to one whose size is locked by its stock. */
  onStartNewPack: (from: ItemVariant) => void;
}

/** Problems with the unit being typed, shown before Save so nothing confusing gets stored. */
export function sellUnitDraftIssues(draft: SellUnitDraft, kind: SellUnitKind, baseUnit: string, variants: ItemVariant[], editingIndex: number): string[] {
  const issues: string[] = [];
  const name = draft.name.trim();
  const contains = Number(draft.productQty);
  if (name && name.toLowerCase() === baseUnit.trim().toLowerCase()) issues.push(`Naam base unit (${baseUnit}) jaisa hai. Koi aur naam rakhein, e.g. "1 ${baseUnit} pack".`);
  if (name && variants.some((v, i) => i !== editingIndex && (v.name || '').trim().toLowerCase() === name.toLowerCase())) issues.push(`"${name}" naam ka unit pehle se hai.`);
  if (draft.productQty !== '' && !(contains > 0)) issues.push(`Size 0 se zyada likhein (${baseUnit} mein).`);
  if (kind === 'multi_unit' && contains === 1 && name) issues.push(`Size 1 ${baseUnit} hai, yeh loose sale hi hai. Multi-unit 1 ${baseUnit} se bara ya chhota ho.`);
  if (draft.price !== '' && !(Number(draft.price) > 0)) issues.push('Price khali chhoren (auto) ya 0 se zyada likhein.');
  if (kind === 'packaging' && draft.packId && draft.packQty !== '' && !(Number(draft.packQty) > 0)) issues.push('Har pack mein packaging 0 se zyada ho.');
  return issues;
}

/** One worked example per kind, in the product's own base unit. */
function kindExamples(baseUnit: string): { multi: { name: string; contains: number }; pack: { name: string; contains: number } } {
  const unit = baseUnit.toLowerCase();
  const multi = sellUnitPresets(baseUnit)[0] || { name: 'Dozen', contains: 12 };
  if (unit === 'kg') return { multi, pack: { name: '500 g pouch', contains: 0.5 } };
  if (unit === 'g') return { multi, pack: { name: '500 g pouch', contains: 500 } };
  if (unit === 'l' || unit === 'liter' || unit === 'liters') return { multi, pack: { name: '1 L bottle', contains: 1 } };
  if (unit === 'ml') return { multi, pack: { name: '1 L bottle', contains: 1000 } };
  return { multi, pack: { name: 'Sealed carton', contains: 24 } };
}

const KINDS = [
  { id: 'multi_unit' as const, icon: Layers, title: 'Multi-unit (loose se)', sub: 'Dozen, tray, pao: loose stock se katta hai' },
  { id: 'packaging' as const, icon: Package, title: 'Ready-made pack', sub: 'Pouch, cup, bottle: apna alag count' },
];

function KindExplainer({ kind, baseUnit }: { kind: SellUnitKind; baseUnit: string }) {
  const ex = kindExamples(baseUnit);
  if (kind === 'multi_unit') {
    const two = formatQty(ex.multi.contains * 2, 3);
    return (
      <p className="flex items-start gap-2 rounded-control bg-info-soft px-3.5 py-2.5 text-xs leading-relaxed text-info-fg">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <strong className="font-bold">Multi-unit</strong> sirf bechne ka tareeqa hai, is ka apna stock nahi hota.
          Misal: 1 {ex.multi.name} = {formatBaseQty(ex.multi.contains, baseUnit)}. 2 {ex.multi.name} bikne par loose stock se {two} {baseUnit} kat jata hai.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3.5 py-2.5 text-xs leading-relaxed text-warning-fg">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        <strong className="font-bold">Ready-made pack</strong> pehle se bhara hua pack hai, jis ka apna count hota hai.
        Misal: {ex.pack.name} = {formatBaseQty(ex.pack.contains, baseUnit)}. 40 {ex.pack.name} stock mein hon to 1 bikne par 39 reh jate hain; loose {baseUnit} nahi katta.
        Pack ka stock purchase, production ya opening stock se aata hai.
      </span>
    </p>
  );
}

/** "Rs 300/kg · loose Rs 320/kg · 6% below loose" */
function perBaseLine(each: number, looseRate: number, baseUnit: string): string {
  if (!(each > 0)) return '';
  const compare = compareWithLoose(each, looseRate);
  const parts = [`${formatCurrency(each)}/${baseUnit}`];
  if (compare.text) parts.push(`loose ${formatCurrency(looseRate)}/${baseUnit}`, compare.text);
  return parts.join(' · ');
}

const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => event.currentTarget.blur();

/** Every way a product sells (loose and its units), plus the add / edit unit form. */
export const SellUnitsTab: React.FC<Props> = ({
  baseUnit, looseRate, costRate, allowLoose, onToggleLoose, variants, liveLoose, liveVariantStocks, packagingMaterials,
  draft, setDraft, kind, onKindChange, editingIndex, onSubmit, onEdit, onRemove, onToggleActive, onCancelEdit, onStartNewPack,
}) => {
  const isMulti = kind === 'multi_unit';
  const contains = Number(draft.productQty);
  const hasSize = contains > 0;
  const draftPrice = hasSize ? sellUnitPrice(looseRate, contains, draft.price ? Number(draft.price) : undefined) : 0;
  const draftEach = hasSize ? pricePerBase(draftPrice, contains) : 0;
  const material = packagingMaterials.find(p => p.id === draft.packId);
  const materialQty = draft.packId ? (Number(draft.packQty) > 0 ? Number(draft.packQty) : 1) : 0;
  const draftCost = hasSize ? costRate * contains + (!isMulti && material ? (Number(material.cost_price) || 0) * materialQty : 0) : 0;
  const draftProfit = draftPrice - draftCost;
  const issues = sellUnitDraftIssues(draft, kind, baseUnit, variants, editingIndex);
  const canSave = Boolean(draft.name.trim()) && hasSize && issues.length === 0;
  const editing = editingIndex >= 0;
  const editingUnit = editing ? variants[editingIndex] : undefined;
  // A count on the unit being edited (a pack's own stock, or a stray count on a multi-unit) locks its kind;
  // a ready-made pack's count also locks its size, or the stock on the shelf would be re-read at the new size.
  const editingCount = countOnUnit(liveVariantStocks, editingUnit?.id);
  const kindLocked = editingCount !== 0;
  const sizeLocked = kindLocked && editingUnit?.deduct_from_base !== true;
  const looseStuck = liveLoose !== null && liveLoose > 0 && !allowLoose && !variants.some(v => v.deduct_from_base === true && v.isActive !== false);
  const examples = kindExamples(baseUnit);

  // Starting or leaving an edit (or "Naya pack add karein") brings the editor into view with the cursor in Naam.
  const editorRef = useRef<HTMLElement>(null);
  const lastEditing = useRef(editingIndex);
  useEffect(() => {
    if (lastEditing.current === editingIndex) return;
    lastEditing.current = editingIndex;
    editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    editorRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus({ preventScroll: true });
  }, [editingIndex]);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Selling units</h4>
          <span className="text-xs text-fg-subtle">Base unit: {baseUnit}</span>
        </div>

        <ul className="divide-y divide-line/70">
          <li className="px-4 py-2.5">
            <Switch
              checked={allowLoose}
              onChange={onToggleLoose}
              label={<span className="flex items-center gap-2">1 {baseUnit} <Badge tone="success">Loose</Badge></span>}
              description={<>
                {looseRate > 0 ? `${formatCurrency(looseRate)}/${baseUnit}` : 'No price'}
                {liveLoose !== null ? ` · ${formatBaseQty(liveLoose, baseUnit)} loose stock mein` : ''}
                {allowLoose ? '' : ' · loose nahi bikta'}
              </>}
            />
            {looseStuck && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-warning-fg">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {formatBaseQty(liveLoose || 0, baseUnit)} loose stock POS mein nahi bikega: loose sale band hai aur koi multi-unit nahi.
              </p>
            )}
          </li>

          {variants.map((v, index) => {
            const vContains = sellUnitContains(v);
            const price = sellUnitPrice(looseRate, vContains, v.selling_price);
            const each = pricePerBase(price, vContains);
            const fromBase = v.deduct_from_base === true;
            const pack = packagingMaterials.find(p => p.id === v.packaging_item_id);
            const costEach = costRate * vContains + (!fromBase && pack ? (Number(pack.cost_price) || 0) * (Number(v.packaging_qty) || 0) : 0);
            const own = countOnUnit(liveVariantStocks, v.id);
            const active = v.isActive !== false;
            const problem = costRate > 0 && price > 0 && price < costEach - 0.005
              ? `Cost se kam (${formatCurrency(costEach)})`
              : !fromBase && own < 0 ? 'Pack stock minus mein hai'
              : fromBase && own !== 0 ? `Purana count ${formatQty(own, 3)} para hai: Inventory stock count mein 0 karein`
              : '';
            const perBase = perBaseLine(each, looseRate, baseUnit);
            return (
              <li key={v.id} className={cn('flex items-center justify-between gap-3 px-4 py-3', editingIndex === index && 'bg-brand-soft/50')}>
                <div className={cn('min-w-0', !active && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-fg">{v.name}</span>
                    {fromBase ? <Badge tone="info">Loose se</Badge> : <Badge tone="warning">Ready-made pack</Badge>}
                    {!active && <Badge tone="neutral">Hidden</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-fg-muted">
                    1 {v.name} = {formatBaseQty(vContains, baseUnit)}{fromBase ? ' loose se' : ', apna count'}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-subtle">
                    {price > 0 ? <Money amount={price} className="font-semibold text-fg-muted" /> : 'No price'}
                    {perBase ? ` · ${perBase}` : ''}
                    {liveLoose !== null && !fromBase ? ` · ${formatQty(own, 3)} stock mein` : ''}
                  </p>
                  {!active && !fromBase && own !== 0 && (
                    <p className="mt-0.5 text-xs text-fg-subtle">POS mein nahi bikta; yeh stock Inventory mein "(hidden)" dikhta hai.</p>
                  )}
                  {problem && <p className="mt-0.5 flex items-start gap-1 text-xs font-semibold text-danger-fg"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{problem}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton size="sm" aria-label={`Edit ${v.name}`} icon={<Pencil />} onClick={() => onEdit(index)} />
                  <IconButton size="sm" aria-label={active ? `${v.name} POS mein chhupayen` : `${v.name} POS mein dikhayen`} title={active ? 'POS mein chhupayen' : 'POS mein dikhayen'} icon={active ? <Eye /> : <EyeOff />} onClick={() => onToggleActive(index)} />
                  <IconButton size="sm" aria-label={`${v.name} hatayen`} icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onRemove(index)} />
                </div>
              </li>
            );
          })}
        </ul>
        {variants.length === 0 && (
          <p className="border-t border-line/70 px-4 py-3 text-xs text-fg-subtle">Abhi koi pack ya unit nahi. Neeche se dozen, pao jaisa multi-unit ya pouch, cup jaisa ready-made pack add karein.</p>
        )}
      </section>

      <section
        ref={editorRef}
        className="scroll-mt-4 space-y-4 rounded-card border border-line bg-surface-2/60 p-4"
        onKeyDown={event => {
          // Enter in a unit field adds the unit instead of saving the whole product.
          if (event.key !== 'Enter' || (event.target as HTMLElement).tagName !== 'INPUT') return;
          event.preventDefault();
          if (canSave) onSubmit();
        }}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-[15px] font-bold tracking-tight text-fg">{editing ? `Edit: ${editingUnit?.name || 'unit'}` : 'Naya unit add karein'}</h4>
          {editing && <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button>}
        </div>

        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Unit ki qisam">
          {KINDS.map(option => {
            const selected = kind === option.id;
            const Icon = option.icon;
            const locked = kindLocked && !selected;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                title={locked ? 'Is unit par stock count hai, is liye qisam nahi badal sakti' : undefined}
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

        <KindExplainer kind={kind} baseUnit={baseUnit} />

        {isMulti && baseUnit && !sizeLocked && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Aam units">
            {sellUnitPresets(baseUnit).map(preset => (
              <Button key={preset.name} size="sm" variant="secondary" onClick={() => setDraft({ ...draft, name: preset.name, productQty: String(preset.contains), price: '' })}>
                {preset.name}
                {preset.name.toLowerCase() !== formatBaseQty(preset.contains, baseUnit).toLowerCase() && (
                  <span className="text-fg-subtle">· {formatBaseQty(preset.contains, baseUnit)}</span>
                )}
              </Button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Naam" className="col-span-2 sm:col-span-1">
            {control => <Input {...control} placeholder={isMulti ? examples.multi.name : examples.pack.name} value={draft.name} maxLength={40} onChange={e => setDraft({ ...draft, name: e.target.value })} />}
          </Field>
          <Field label={`Size (kitne ${baseUnit})`}>
            {control => (
              <Input {...control} type="number" inputMode="decimal" min="0.001" step="any" className="tabular-nums" placeholder={String(isMulti ? examples.multi.contains : examples.pack.contains)}
                suffix={baseUnit} disabled={sizeLocked} value={draft.productQty} onWheel={blurOnWheel} onChange={e => setDraft({ ...draft, productQty: e.target.value })} />
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

        {kindLocked && editingUnit && (
          <div className="space-y-2 rounded-control border border-line bg-surface px-3.5 py-2.5 text-xs text-fg-muted">
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
              {sizeLocked ? (
                <span>
                  <strong className="font-semibold text-fg">{formatQty(editingCount, 3)} × {editingUnit.name}</strong> abhi stock mein hain, is liye size ({formatBaseQty(sellUnitContains(editingUnit), baseUnit)}) aur qisam lock hain.
                  Size badalne se shelf par para stock naye size se gina jata aur hisaab ghalat ho jata. Naam aur price badal sakte hain.
                  Size badalna hai to pehle Inventory mein is pack ka count 0 karein, ya naya pack add karein.
                </span>
              ) : (
                <span>
                  Is multi-unit par purana count ({formatQty(editingCount, 3)}) para hai, is liye qisam lock hai. Inventory stock count mein isko 0 karein.
                </span>
              )}
            </p>
            {sizeLocked && (
              <Button size="sm" variant="secondary" leftIcon={<PackagePlus />} onClick={() => onStartNewPack(editingUnit)}>Naya pack add karein</Button>
            )}
          </div>
        )}

        {!isMulti && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Packaging material" className="col-span-2" hint={packagingMaterials.length === 0 ? 'Koi packaging material nahi (optional).' : undefined}>
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
            <span className="min-w-0">
              <span className="block font-semibold text-fg">
                1 {draft.name.trim() || 'unit'} = {formatBaseQty(contains, baseUnit)}{isMulti ? ' loose se' : ', apna count'}
              </span>
              {draftEach > 0 && <span className="block text-xs text-fg-subtle">{perBaseLine(draftEach, looseRate, baseUnit)}</span>}
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
          <p role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-danger-fg"><AlertTriangle className="size-3.5 shrink-0" />{issues[0]}</p>
        )}

        <Button fullWidth variant={canSave ? 'primary' : 'secondary'} leftIcon={editing ? <Save /> : <Plus />} onClick={onSubmit} disabled={!canSave}>
          {editing ? 'Update unit' : 'Add unit'}
        </Button>
      </section>
    </div>
  );
};
