import React from 'react';
import { AlertTriangle, Check, Edit, Eye, EyeOff, Layers, Package, Plus, Save, Trash2 } from 'lucide-react';
import { ItemDefinition, ItemVariant } from '../../types';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { compareWithLoose, pricePerBase, sellUnitContains, sellUnitPresets, sellUnitPrice } from '../../lib/sellUnits';

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
  inputClass: string;
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
  return issues;
}

const chip = 'text-[10px] font-semibold px-1.5 py-0.5 rounded-md';
const iconBtn = 'p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer';

export const SellUnitsTab: React.FC<Props> = ({
  baseUnit, looseRate, costRate, allowLoose, onToggleLoose, variants, liveLoose, liveVariantStocks, packagingMaterials,
  draft, setDraft, kind, onKindChange, editingIndex, onSubmit, onEdit, onRemove, onToggleActive, onCancelEdit, inputClass,
}) => {
  const isMulti = kind === 'multi_unit';
  const contains = Number(draft.productQty);
  const hasSize = contains > 0;
  const draftPrice = hasSize ? sellUnitPrice(looseRate, contains, draft.price ? Number(draft.price) : undefined) : 0;
  const draftEach = hasSize ? pricePerBase(draftPrice, contains) : 0;
  const draftCompare = compareWithLoose(draftEach, looseRate);
  const material = packagingMaterials.find(p => p.id === draft.packId);
  const materialQty = draft.packId ? (Number(draft.packQty) > 0 ? Number(draft.packQty) : 1) : 0;
  const draftCost = hasSize ? costRate * contains + (material ? (Number(material.cost_price) || 0) * materialQty : 0) : 0;
  const issues = sellUnitDraftIssues(draft, kind, baseUnit, variants, editingIndex);
  const canSave = Boolean(draft.name.trim()) && hasSize && issues.length === 0;
  const editing = editingIndex >= 0;
  const editingHasStock = editing && variants[editingIndex]?.deduct_from_base !== true && Math.abs(Number(liveVariantStocks[variants[editingIndex]?.id]) || 0) > 0.0001;

  return (
    <div className="space-y-4 animate-in fade-in">
      {/* Every way this product sells, in one list */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Selling units</h4>
          <span className="text-[11px] text-slate-400">Base: 1 {baseUnit}</span>
        </div>

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          <li className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-900 dark:text-white">1 {baseUnit}</span>
                <span className={`${chip} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300`}>Loose</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {looseRate > 0 ? formatCurrency(looseRate) : 'No price'}
                {liveLoose !== null ? ` · ${formatQty(liveLoose, 3)} ${baseUnit} in stock` : ''}
              </p>
            </div>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 cursor-pointer">
              {allowLoose ? 'Sold loose' : 'Not sold loose'}
              <button
                type="button"
                role="switch"
                aria-checked={allowLoose}
                aria-label="Allow loose sale"
                onClick={onToggleLoose}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${allowLoose ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${allowLoose ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </label>
          </li>

          {variants.map((v, index) => {
            const vContains = sellUnitContains(v);
            const price = sellUnitPrice(looseRate, vContains, v.selling_price);
            const each = pricePerBase(price, vContains);
            const compare = compareWithLoose(each, looseRate);
            const fromBase = v.deduct_from_base === true;
            const pack = packagingMaterials.find(p => p.id === v.packaging_item_id);
            const costEach = costRate * vContains + (pack ? (Number(pack.cost_price) || 0) * (Number(v.packaging_qty) || 0) : 0);
            const own = Number(liveVariantStocks[v.id]) || 0;
            const active = v.isActive !== false;
            const problem = costRate > 0 && price > 0 && price < costEach - 0.005
              ? `Below cost (${formatCurrency(costEach)})`
              : (!fromBase && own < 0 ? 'Negative pack stock' : '');
            const stock = liveLoose === null ? '' : fromBase ? '' : `${formatQty(own, 3)} in stock`;
            return (
              <li key={v.id} className={`px-4 py-3 flex items-center justify-between gap-3 ${editingIndex === index ? 'bg-slate-50 dark:bg-slate-800/40' : ''} ${active ? '' : 'opacity-55'}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{v.name}</span>
                    <span className="text-[11px] text-slate-400">{formatQty(vContains, 3)} {baseUnit}</span>
                    {fromBase
                      ? <span className={`${chip} bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300`}>From loose</span>
                      : <span className={`${chip} bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300`}>Own stock</span>}
                    {!active && <span className={`${chip} bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}>Hidden</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{price > 0 ? formatCurrency(price) : 'No price'}</span>
                    {compare.text ? ` · ${compare.text}` : ''}
                    {stock ? ` · ${stock}` : ''}
                  </p>
                  {problem && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-0.5 flex items-center gap-1"><AlertTriangle size={11} />{problem}</p>}
                </div>
                <div className="flex items-center shrink-0">
                  <button type="button" onClick={() => onEdit(index)} title="Edit" aria-label={`Edit ${v.name}`} className={iconBtn}><Edit size={14} /></button>
                  <button type="button" onClick={() => onToggleActive(index)} title={active ? 'Hide in POS' : 'Show in POS'} aria-label={active ? `Hide ${v.name}` : `Show ${v.name}`} className={iconBtn}>{active ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                  <button type="button" onClick={() => onRemove(index)} title="Remove" aria-label={`Remove ${v.name}`} className={`${iconBtn} hover:!text-rose-600 hover:!bg-rose-50 dark:hover:!bg-rose-950/40`}><Trash2 size={14} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{editing ? `Edit ${variants[editingIndex]?.name || 'unit'}` : 'Add a unit'}</h4>
          {editing && <button type="button" onClick={onCancelEdit} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">Cancel</button>}
        </div>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Unit type">
          {([
            { id: 'multi_unit' as const, icon: Layers, title: 'From loose stock', sub: 'Dozen, tray, pao', on: 'border-indigo-500 ring-1 ring-indigo-500 text-indigo-700 dark:text-indigo-300' },
            { id: 'packaging' as const, icon: Package, title: 'Ready-made pack', sub: 'Cup, bottle, packet', on: 'border-amber-500 ring-1 ring-amber-500 text-amber-700 dark:text-amber-300' },
          ]).map(option => {
            const selected = kind === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={editingHasStock && !selected}
                title={editingHasStock && !selected ? 'This pack has stock, so its type cannot change' : undefined}
                onClick={() => onKindChange(option.id)}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border bg-white dark:bg-slate-900 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${selected ? option.on : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-400'}`}
              >
                <Icon size={16} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-900 dark:text-white">{option.title}</span>
                  <span className="block text-[11px] text-slate-400">{option.sub}</span>
                </span>
                {selected && <Check size={14} className="ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>

        {isMulti && baseUnit && (
          <div className="flex flex-wrap gap-1.5">
            {sellUnitPresets(baseUnit).map(preset => (
              <button
                key={preset.name}
                type="button"
                onClick={() => setDraft({ ...draft, name: preset.name, productQty: String(preset.contains), price: '' })}
                className="text-[11px] px-2.5 py-1 rounded-full bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 mb-1 block">Name</span>
            <input type="text" className={`${inputClass} text-xs`} placeholder={isMulti ? 'Dozen' : 'Cup'} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 mb-1 block">Size ({baseUnit})</span>
            <input type="number" min="0.001" step="any" className={`${inputClass} text-xs font-mono`} placeholder={isMulti ? '12' : '0.5'} value={draft.productQty} onChange={e => setDraft({ ...draft, productQty: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-500 mb-1 block">Price (Rs)</span>
            <input type="number" min="0" step="any" className={`${inputClass} text-xs font-mono`} placeholder={hasSize && looseRate > 0 ? `${sellUnitPrice(looseRate, contains)} auto` : 'Auto'} value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
          </label>
        </div>

        {!isMulti && (
          <div className="grid grid-cols-3 gap-2.5">
            <label className="block col-span-2">
              <span className="text-[11px] font-semibold text-slate-500 mb-1 block">Packaging material</span>
              <select className={`${inputClass} text-xs`} value={draft.packId} onChange={e => setDraft({ ...draft, packId: e.target.value })}>
                <option value="">None</option>
                {packagingMaterials.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-500 mb-1 block">Per pack</span>
              <input type="number" min="0.001" step="any" className={`${inputClass} text-xs font-mono`} placeholder="1" value={draft.packQty} disabled={!draft.packId} onChange={e => setDraft({ ...draft, packQty: e.target.value })} />
            </label>
          </div>
        )}

        {hasSize && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              1 {draft.name.trim() || 'unit'} = {formatQty(contains, 3)} {baseUnit}
              <span className="font-normal text-slate-400">{draftCompare.text ? ` · ${draftCompare.text}` : ''}</span>
            </span>
            <span className="text-right shrink-0">
              <span className="font-mono font-bold text-slate-900 dark:text-white">{draftPrice > 0 ? formatCurrency(draftPrice) : '—'}</span>
              {costRate > 0 && draftPrice > 0 && (
                <span className={`block text-[10px] font-semibold ${draftPrice - draftCost < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {draftPrice - draftCost < 0 ? 'Loss' : 'Profit'} {formatCurrency(Math.abs(draftPrice - draftCost))}
                </span>
              )}
            </span>
          </div>
        )}

        {issues.length > 0 && (
          <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5"><AlertTriangle size={12} className="shrink-0" />{issues[0]}</p>
        )}

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSave}
          className="w-full py-2.5 rounded-xl font-bold text-xs text-white bg-slate-900 hover:bg-slate-800 dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-slate-950 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98] disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          {editing ? <Save size={14} /> : <Plus size={14} />}
          {editing ? 'Update unit' : 'Add unit'}
        </button>
      </section>
    </div>
  );
};
