import React, { lazy, Suspense, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Briefcase, ChefHat, Check, Factory, Lock, Plus, Ruler, Save, Trash2, Truck, X,
} from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import type { ItemDefinition, ItemType, ItemVariant, RecipeIngredient } from '../../types';
import { Badge, Button, Field, IconButton, Input, Money, SegmentedControl, Select } from '../ui';
import { confirmAction } from '../ui/ConfirmDialog';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { detectUnitGroupId } from '../../lib/unitConversion';
import { UnitSelector } from '../units/UnitSelector';
import { SellUnitsTab, sellUnitDraftIssues, type SellUnitDraft, type SellUnitKind } from './SellUnitsTab';
import { ImageUploadField } from './ImageUploadField';
import { SideSheet } from './SideSheet';
import { Switch } from './Switch';
import { ITEM_TYPES, categoryOptions, profitBasisFor, profitOf } from './catalogModel';

const UnitManagerModal = lazy(() => import('../units/UnitManagerModal').then(m => ({ default: m.UnitManagerModal })));

type FormTab = 'details' | 'recipe' | 'variants';

interface Props {
  mode: 'create' | 'edit';
  item: ItemDefinition | null;
  canDelete: boolean;
  /** Closes the sheet without asking; the sheet asks about unsaved changes itself. */
  onClose: () => void;
  onSaved: () => void;
  onDelete: (itemId: string) => void;
}

interface NumberDrafts {
  cost: string;
  sell: string;
  reorder: string;
  sortOrder: string;
  recipeBase: string;
  recipeOutput: string;
}

const TYPE_LABEL: Record<ItemType, { label: string; hint: string }> = {
  'Sale product': { label: 'Sale product', hint: 'POS mein bikta hai' },
  'Raw material': { label: 'Raw material', hint: 'Recipe mein lagta hai' },
  'Packaging material': { label: 'Packaging', hint: 'Cup, dabba, lifafa' },
};

const SOURCES = [
  { value: 'Supplier', label: 'Vendor', icon: <Truck /> },
  { value: 'Production', label: 'In-House', icon: <Factory /> },
  { value: 'Both', label: 'Hybrid', icon: <Briefcase /> },
] as const;

const CASH_PRESETS = [
  { label: 'Standard dairy (50-300)', value: '50, 100, 150, 200, 250, 300' },
  { label: 'Small cash (20-100)', value: '20, 30, 50, 70, 100' },
];
const QUICK_ADD = [20, 30, 50, 70, 100, 150, 200, 250, 300, 500];

const EMPTY_DRAFT: SellUnitDraft = { name: '', packId: '', packQty: '1', productQty: '', price: '', fromBase: true };

const numberOrNull = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : NaN;
};

const toDraft = (value: number | undefined | null, emptyWhenZero = false) =>
  value === undefined || value === null || !Number.isFinite(Number(value)) || (emptyWhenZero && Number(value) === 0) ? '' : String(value);

/** Rejects page scrolls that would silently change a number field under the mouse. */
const blurOnWheel = (event: React.WheelEvent<HTMLInputElement>) => event.currentTarget.blur();

function parseQuickAmounts(raw: string): { values: number[]; invalid: boolean } {
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);
  const values: number[] = [];
  let invalid = false;
  tokens.forEach(token => {
    const n = Number(token);
    if (!Number.isFinite(n) || n <= 0) invalid = true;
    else if (!values.includes(n)) values.push(n);
  });
  return { values, invalid };
}

function FormSection({ title, description, aside, children }: { title: string; description?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line/70 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[15px] font-bold tracking-tight text-fg">{title}</h4>
          {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Add / edit product form in the side sheet: details, prices, stock alert, POS setup, recipe and sell units. */
export default function ItemFormSheet({ mode, item, canDelete, onClose, onSaved, onDelete }: Props) {
  const { items, inventory, categories, unitGroups, settings, addItem, updateItem, canPerform } = useDairy();
  const { showToast } = useToast();
  const titleId = useId();
  const isEdit = mode === 'edit' && Boolean(item);
  const canSave = isEdit ? canPerform('items', 'edit') : canPerform('items', 'create');

  // Everything the form starts with, built once. The snapshot tells us later whether anything changed.
  const [initial] = useState(() => {
    const ITEM_TYPE_SET = new Set<string>(ITEM_TYPES);
    if (item && mode === 'edit') {
      const clean: ItemDefinition = JSON.parse(JSON.stringify(item));
      let groupId = clean.unit_group_id;
      if (!groupId && clean.unit) groupId = unitGroups.find(g => g.units.some(u => u.symbol === clean.unit))?.id || '';
      const form: Partial<ItemDefinition> = {
        ...clean,
        item_type: Array.from(new Set((clean.item_type || []).filter(t => ITEM_TYPE_SET.has(t)))),
        category: (clean.category || []).slice(0, 1),
        unit_group_id: groupId,
        recipe: clean.recipe || [],
        variants: clean.variants || [],
        recipe_base_item_id: clean.recipe_base_item_id || 'MILK_BASE',
        quick_amounts: clean.quick_amounts || [],
        allow_loose_sale: clean.allow_loose_sale !== false,
        pos_primary_mode: clean.pos_primary_mode || 'amount',
        image_url: clean.image_url || '',
      };
      const nums: NumberDrafts = {
        cost: toDraft(clean.cost_price),
        sell: toDraft(clean.selling_price),
        reorder: toDraft(clean.reorder_level || 10),
        sortOrder: toDraft(clean.sort_order ?? 999),
        recipeBase: toDraft(clean.recipe_base_quantity, true),
        recipeOutput: toDraft(clean.recipe_expected_output, true),
      };
      const quick = Array.isArray(clean.quick_amounts) && clean.quick_amounts.length > 0 ? clean.quick_amounts.join(', ') : '';
      return { form, nums, quick };
    }
    // New products go to the end of the POS grid.
    const saleOrders = items.filter(i => i.item_type?.includes('Sale product')).map(i => Number(i.sort_order ?? 999)).filter(n => n < 999);
    const nextSortOrder = Math.min(999, (saleOrders.length ? Math.max(...saleOrders) : 0) + 1);
    const form: Partial<ItemDefinition> = {
      name: '', category: ['Uncategorized'], item_type: ['Sale product'], unit: '', unit_group_id: '',
      source: 'Both', isActive: true, recipe: [], variants: [], recipe_base_item_id: 'MILK_BASE',
      quick_amounts: [], allow_loose_sale: true, pos_primary_mode: 'amount', image_url: '',
    };
    const nums: NumberDrafts = { cost: '', sell: '', reorder: '10', sortOrder: String(nextSortOrder), recipeBase: '', recipeOutput: '' };
    return { form, nums, quick: '' };
  });

  const [formData, setFormData] = useState<Partial<ItemDefinition>>(initial.form);
  const [nums, setNums] = useState<NumberDrafts>(initial.nums);
  const [quickAmountsRaw, setQuickAmountsRaw] = useState(initial.quick);
  const [snapshot] = useState(() => JSON.stringify([initial.form, initial.nums, initial.quick]));
  const [activeTab, setActiveTab] = useState<FormTab>('details');
  const [showErrors, setShowErrors] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [unitManagerOpen, setUnitManagerOpen] = useState(false);
  const [newIngredient, setNewIngredient] = useState<{ itemId: string; qty: string }>({ itemId: '', qty: '' });
  const [variantKind, setVariantKind] = useState<SellUnitKind>('multi_unit');
  const [variantDraft, setVariantDraft] = useState<SellUnitDraft>(EMPTY_DRAFT);
  const [editingVariantIndex, setEditingVariantIndex] = useState(-1);

  const patch = (next: Partial<ItemDefinition>) => setFormData(prev => ({ ...prev, ...next }));
  const setNum = (key: keyof NumberDrafts, value: string) => setNums(prev => ({ ...prev, [key]: value }));

  const isSystem = Boolean(formData.isSystem);
  const types = formData.item_type || [];
  const isSale = types.includes('Sale product');
  const unit = (formData.unit || '').trim();
  const showRecipe = formData.source === 'Production' || formData.source === 'Both';
  const tab: FormTab = activeTab === 'recipe' && !showRecipe ? 'details' : activeTab;

  const liveInv = item ? inventory?.find(i => i.item_id === item.id) : undefined;
  const liveLoose = item ? Number(liveInv?.quantity ?? (item as { stock?: number }).stock ?? 0) : null;
  const liveVariantStocks = (liveInv?.variant_stocks || item?.variant_stocks || {}) as Record<string, number>;

  // The base unit measures stock, cost and every pack size, so it cannot be relabelled while stock exists.
  const unitLocked = isEdit && (
    Math.abs(liveLoose || 0) > 0.0001 || Object.values(liveVariantStocks).some(v => Math.abs(Number(v) || 0) > 0.0001)
  );

  const categoryChoices = useMemo(() => {
    const list = categoryOptions(['Uncategorized', ...categories], items);
    const current = formData.category?.[0];
    return current && !list.some(c => c.toLowerCase() === current.toLowerCase()) ? [...list, current] : list;
  }, [categories, items, formData.category]);

  const rawMaterials = useMemo(() => items.filter(i => i.item_type.includes('Raw material') && i.id !== item?.id), [items, item?.id]);
  const packagingMaterials = useMemo(() => items.filter(i => i.item_type.includes('Packaging material') && i.id !== item?.id), [items, item?.id]);

  const cost = numberOrNull(nums.cost);
  const sell = numberOrNull(nums.sell);
  const reorder = numberOrNull(nums.reorder);
  const sortOrder = numberOrNull(nums.sortOrder);
  const recipeBase = numberOrNull(nums.recipeBase);
  const recipeOutput = numberOrNull(nums.recipeOutput);
  const quick = parseQuickAmounts(quickAmountsRaw);
  const trimmedName = (formData.name || '').trim();
  const duplicateOf = trimmedName
    ? items.find(i => i.id !== item?.id && i.name.trim().toLowerCase() === trimmedName.toLowerCase())
    : undefined;

  const errors = {
    name: !trimmedName ? 'Product ka naam likhein.' : duplicateOf ? `"${duplicateOf.name}" naam ka product pehle se hai.` : '',
    item_type: types.length === 0 ? 'Kam az kam ek type chunein.' : '',
    unit: !unit ? 'Base unit chunein.' : '',
    cost: cost !== null && !(cost >= 0) ? 'Cost 0 ya us se zyada ho.' : '',
    sell: sell !== null && !(sell >= 0) ? 'Rate 0 ya us se zyada ho.' : '',
    reorder: reorder === null || !(reorder > 0) ? 'Alert ki miqdar 0 se zyada likhein.' : '',
    sortOrder: isSale && (sortOrder === null || !Number.isInteger(sortOrder) || sortOrder < 1 || sortOrder > 999) ? '1 se 999 tak poora number likhein.' : '',
    quick: isSale && quick.invalid ? 'Sirf rupay ki raqam likhein, comma se alag (e.g. 50, 100).' : '',
    recipe: (recipeBase !== null && !(recipeBase >= 0)) || (recipeOutput !== null && !(recipeOutput >= 0)) ? 'Batch ki miqdar 0 ya us se zyada ho.' : '',
  };
  const errorTab: Record<keyof typeof errors, FormTab> = {
    name: 'details', item_type: 'details', unit: 'details', cost: 'details', sell: 'details', reorder: 'details', sortOrder: 'details', quick: 'details', recipe: 'recipe',
  };
  // Errors show after the first Save; a duplicate name shows while typing.
  const shown = (key: keyof typeof errors) => ((showErrors || (key === 'name' && Boolean(duplicateOf))) && errors[key]) || undefined;

  const basis = profitBasisFor({ selling_price: sell ?? 0, cost_price: cost ?? 0, unit: unit || 'unit', allow_loose_sale: formData.allow_loose_sale, variants: formData.variants });
  const pricing = profitOf(basis);

  const variantPending = editingVariantIndex >= 0 || Boolean(variantDraft.name.trim() || variantDraft.productQty.trim());
  const isDirty = JSON.stringify([formData, nums, quickAmountsRaw]) !== snapshot || variantPending;

  const requestClose = async () => {
    if (submittingRef.current) return;
    if (isDirty && !(await confirmAction({
      title: 'Changes save nahi hue',
      message: 'Form band karne se yeh changes chale jayenge.',
      confirmLabel: 'Haan, band karein',
      cancelLabel: 'Form par wapas',
      tone: 'warning',
    }))) return;
    onClose();
  };

  /* ---------- Types, recipe and sell units ---------- */

  const toggleType = (type: ItemType) => {
    if (isSystem) return;
    patch({ item_type: types.includes(type) ? types.filter(t => t !== type) : [...types, type] });
  };

  const addIngredient = () => {
    const qty = Number(newIngredient.qty);
    const material = items.find(i => i.id === newIngredient.itemId);
    if (!material) { showToast('Pehle raw material chunein', 'warning'); return; }
    if (!(qty > 0)) { showToast('Miqdar 0 se zyada likhein', 'warning'); return; }
    if ((formData.recipe || []).some(r => r.item_id === material.id)) { showToast(`${material.name} recipe mein pehle se hai`, 'warning'); return; }
    const next: RecipeIngredient = { item_id: material.id, item_name: material.name, quantity: qty, unit: material.unit, type: 'Ingredient' } as RecipeIngredient;
    patch({ recipe: [...(formData.recipe || []), next] });
    setNewIngredient({ itemId: '', qty: '' });
  };

  const removeIngredient = (index: number) => patch({ recipe: (formData.recipe || []).filter((_, i) => i !== index) });

  const resetVariantForm = (kind: SellUnitKind = variantKind) => {
    setVariantDraft({ ...EMPTY_DRAFT, fromBase: kind === 'multi_unit' });
    setEditingVariantIndex(-1);
  };

  const submitVariant = () => {
    const contains = parseFloat(variantDraft.productQty);
    if (!variantDraft.name.trim() || !(contains > 0)) {
      showToast(`Naam aur size (${unit || 'units'} mein) likhein`, 'warning');
      return;
    }
    const variants = formData.variants || [];
    const issues = sellUnitDraftIssues(variantDraft, variantKind, unit, variants, editingVariantIndex);
    if (issues.length > 0) { showToast(issues[0], 'warning'); return; }
    const isMulti = variantKind === 'multi_unit';
    const packItem = !isMulti && variantDraft.packId ? items.find(i => i.id === variantDraft.packId) : undefined;
    const existing = editingVariantIndex >= 0 ? variants[editingVariantIndex] : undefined;
    const packQty = parseFloat(variantDraft.packQty);
    const variant: ItemVariant = {
      id: existing?.id || `var_${Date.now()}`,
      name: variantDraft.name.trim(),
      packaging_item_id: isMulti ? '' : (variantDraft.packId || ''),
      packaging_item_name: isMulti ? '' : (packItem?.name || ''),
      packaging_qty: isMulti || !variantDraft.packId ? 0 : (packQty > 0 ? packQty : 1),
      quantity_in_base_unit: contains,
      selling_price: variantDraft.price ? parseFloat(variantDraft.price) : undefined,
      deduct_from_base: isMulti,
      isActive: existing ? existing.isActive !== false : true,
    };
    const next = [...variants];
    if (existing) next[editingVariantIndex] = variant;
    else next.push(variant);
    patch({ variants: next });
    showToast(existing ? `${variant.name} update ho gaya` : `${variant.name} add ho gaya`, 'success');
    resetVariantForm();
  };

  const editVariant = (index: number) => {
    const v = (formData.variants || [])[index];
    if (!v) return;
    const isMulti = v.deduct_from_base === true;
    setVariantKind(isMulti ? 'multi_unit' : 'packaging');
    setVariantDraft({
      name: v.name,
      packId: v.packaging_item_id || '',
      packQty: String(v.packaging_qty || 1),
      productQty: String(v.quantity_in_base_unit),
      price: v.selling_price ? String(v.selling_price) : '',
      fromBase: isMulti,
    });
    setEditingVariantIndex(index);
    setActiveTab('variants');
  };

  const removeVariant = (index: number) => {
    const target = (formData.variants || [])[index];
    if (!target) return;
    const onHand = Number(liveVariantStocks[target.id] || 0);
    if (target.deduct_from_base !== true && Math.abs(onHand) > 0.0001) {
      showToast(`${target.name} ke abhi ${formatQty(onHand, 3)} packs stock mein hain. Pehle count karke 0 karein, ya isko hide kar dein.`, 'warning');
      return;
    }
    patch({ variants: (formData.variants || []).filter((_, i) => i !== index) });
    if (editingVariantIndex === index) resetVariantForm();
    else if (editingVariantIndex > index) setEditingVariantIndex(editingVariantIndex - 1);
  };

  // Hidden units stay on old bills and keep their stock; they just stop showing in POS.
  const toggleVariantActive = (index: number) => {
    const next = [...(formData.variants || [])];
    if (!next[index]) return;
    next[index] = { ...next[index], isActive: next[index].isActive === false };
    patch({ variants: next });
  };

  /* ---------- Save ---------- */

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!canSave) { showToast('Aap ko products save karne ki ijazat nahi', 'warning'); return; }
    setShowErrors(true);
    const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find(key => errors[key]);
    if (firstError) {
      setActiveTab(errorTab[firstError]);
      showToast(errors[firstError], 'warning');
      return;
    }
    if (imageBusy) { showToast('Photo abhi process ho rahi hai, thora ruk kar save karein', 'warning'); return; }
    if (variantPending) {
      setActiveTab('variants');
      showToast(editingVariantIndex >= 0 ? 'Unit ki edit adhoori hai: "Update unit" ya "Cancel" dabayein' : 'Naya unit abhi add nahi hua: "Add unit" dabayein ya fields khali karein', 'warning');
      return;
    }

    const finalData: Partial<ItemDefinition> = {
      ...formData,
      name: trimmedName,
      unit,
      category: formData.category?.length ? formData.category.slice(0, 1) : ['Uncategorized'],
      item_type: Array.from(new Set(types)),
      cost_price: cost ?? 0,
      selling_price: sell ?? 0,
      reorder_level: reorder as number,
      sort_order: isSale ? (sortOrder as number) : (formData.sort_order ?? 999),
      recipe_base_quantity: recipeBase ?? 0,
      recipe_expected_output: recipeOutput ?? 0,
      pos_primary_mode: formData.pos_primary_mode || 'amount',
      quick_amounts: quick.values,
    };

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const ok = isEdit && item
        ? await updateItem(item.id, finalData)
        : await addItem(finalData as Omit<ItemDefinition, 'id'>);
      if (ok) {
        submittingRef.current = false;
        onSaved();
        return;
      }
    } catch (err: any) {
      showToast('Product save nahi hua: ' + (err?.message || 'Failed'), 'error');
    }
    submittingRef.current = false;
    setIsSubmitting(false);
  };

  /* ---------- Render ---------- */

  const errorCount = showErrors ? Object.values(errors).filter(Boolean).length : 0;
  const tabOptions = [
    { value: 'details' as const, label: 'Details' },
    ...(showRecipe ? [{ value: 'recipe' as const, label: 'Recipe', icon: <ChefHat />, count: formData.recipe?.length || undefined }] : []),
    { value: 'variants' as const, label: 'Sell units', count: formData.variants?.length || undefined },
  ];
  const recipeBaseUnit = formData.recipe_base_item_id && formData.recipe_base_item_id !== 'MILK_BASE'
    ? (items.find(i => i.id === formData.recipe_base_item_id)?.unit || 'units')
    : 'L';

  return (
    <SideSheet onClose={requestClose} labelledBy={titleId} className="max-w-2xl">
      <header className="shrink-0 border-b border-line px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-start gap-3">
          {isSystem && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info-fg"><Lock className="size-[18px]" /></span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-subtle">{isEdit ? 'Edit product' : 'Naya product'}</p>
            <h2 id={titleId} className="truncate text-xl font-bold tracking-tight text-fg">{trimmedName || (isEdit ? item?.name : 'Product ka naam')}</h2>
          </div>
          {isEdit && item && canDelete && !isSystem && (
            <IconButton aria-label="Product delete karein" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onDelete(item.id)} />
          )}
          <IconButton aria-label="Band karein" icon={<X />} onClick={requestClose} />
        </div>
        <SegmentedControl aria-label="Form sections" variant="underline" value={tab} onChange={setActiveTab} options={tabOptions} className="mt-3" />
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {tab === 'details' && (
            <>
              {isSystem && (
                <div className="flex items-start gap-3 rounded-card border border-info/20 bg-info-soft px-4 py-3 text-info-fg">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    <strong className="font-bold">System milk variety.</strong> Naam, type aur unit nahi badal sakte taake hisaab theek rahe. Cost, rate aur Active status badal sakte hain.
                  </p>
                </div>
              )}

              <FormSection title="Basic info">
                <ImageUploadField
                  value={formData.image_url}
                  name={trimmedName}
                  onChange={dataUrl => patch({ image_url: dataUrl })}
                  onError={message => showToast(message, 'error')}
                  onBusyChange={setImageBusy}
                />
                <Field label="Product ka naam" required error={shown('name')} hint="Inventory, POS aur bills mein yahi naam aayega.">
                  {control => (
                    <Input
                      {...control}
                      value={formData.name || ''}
                      disabled={isSystem}
                      placeholder="e.g. Fresh Cream"
                      maxLength={80}
                      autoFocus={!isEdit}
                      onChange={event => patch({ name: event.target.value })}
                    />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Category">
                    {control => (
                      <Select {...control} value={formData.category?.[0] || 'Uncategorized'} disabled={isSystem} onChange={event => patch({ category: [event.target.value] })}>
                        {categoryChoices.map(c => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Source">
                    {() => (
                      <SegmentedControl
                        aria-label="Source"
                        fullWidth
                        value={(formData.source || 'Both') as 'Supplier' | 'Production' | 'Both'}
                        onChange={value => !isSystem && patch({ source: value })}
                        options={SOURCES.map(s => ({ ...s, disabled: isSystem && formData.source !== s.value }))}
                      />
                    )}
                  </Field>
                </div>
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-fg-muted">Kis kaam aata hai<span className="ml-0.5 text-danger" aria-hidden="true">*</span></legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {ITEM_TYPES.slice().reverse().map(type => {
                      const on = types.includes(type);
                      return (
                        <button
                          key={type}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={isSystem}
                          onClick={() => toggleType(type)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                            on ? 'border-brand-accent bg-brand-soft' : 'border-line bg-surface hover:border-line-strong',
                          )}
                        >
                          <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md border', on ? 'border-brand bg-brand text-brand-on' : 'border-line-strong bg-surface')}>
                            {on && <Check className="size-3.5" strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-fg">{TYPE_LABEL[type].label}</span>
                            <span className="block text-[11px] text-fg-subtle">{TYPE_LABEL[type].hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {shown('item_type') && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{errors.item_type}</p>}
                </fieldset>
              </FormSection>

              <FormSection
                title="Unit"
                description="Stock, cost aur har pack size isi unit mein napa jata hai."
                aside={!isSystem && <Button size="sm" variant="ghost" leftIcon={<Ruler />} onClick={() => setUnitManagerOpen(true)}>Units manage</Button>}
              >
                <div>
                  <UnitSelector
                    value={formData.unit || ''}
                    disabled={isSystem || unitLocked}
                    onChange={(symbol, groupId) => patch({ unit: symbol, unit_group_id: groupId })}
                  />
                  {unitLocked && <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-subtle"><Lock className="size-3" />Stock maujood hai, is liye unit lock hai.</p>}
                  {shown('unit') && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{errors.unit}</p>}
                </div>
              </FormSection>

              <FormSection title="Price aur stock alert" description={unit ? `Har rate 1 ${unit} ka hai.` : 'Pehle unit chunein.'}>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Cost (landed)" error={shown('cost')}>
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix="Rs" placeholder="0"
                        className="font-semibold tabular-nums" value={nums.cost} onWheel={blurOnWheel} onChange={event => setNum('cost', event.target.value)} />
                    )}
                  </Field>
                  <Field label="Selling rate" error={shown('sell')}>
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix="Rs" placeholder="0"
                        className="font-semibold tabular-nums" value={nums.sell} onWheel={blurOnWheel} onChange={event => setNum('sell', event.target.value)} />
                    )}
                  </Field>
                  <Field label="Low stock alert at" error={shown('reorder')}>
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix={unit || undefined} placeholder="10"
                        className="tabular-nums" value={nums.reorder} onWheel={blurOnWheel} onChange={event => setNum('reorder', event.target.value)} />
                    )}
                  </Field>
                </div>
                {isSale && (
                  basis ? (
                    <div className={cn(
                      'flex flex-wrap items-center justify-between gap-2 rounded-control px-3.5 py-2.5 text-sm',
                      pricing.profit < 0 ? 'bg-danger-soft text-danger-fg' : 'bg-surface-2 text-fg-muted',
                    )}>
                      <span>
                        {pricing.profit < 0 ? 'Nuqsan' : 'Profit'} <Money amount={Math.abs(pricing.profit)} className="font-bold" /> per {basis.per}
                        {basis.per !== unit && <span className="text-xs"> (loose sale band hai, pehla pack)</span>}
                      </span>
                      <span className="flex items-center gap-2 text-xs font-semibold">
                        {pricing.marginPct !== null && <Badge tone={pricing.profit < 0 ? 'danger' : 'success'}>{pricing.marginPct.toFixed(1)}% margin</Badge>}
                        {pricing.markupPct !== null && <Badge tone="neutral">{pricing.markupPct.toFixed(0)}% markup</Badge>}
                      </span>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-control bg-warning-soft px-3.5 py-2.5 text-xs font-medium text-warning-fg">
                      <AlertTriangle className="size-4 shrink-0" />Selling rate 0 hai aur koi priced pack nahi. POS mein yeh product nahi bikega.
                    </p>
                  )
                )}
              </FormSection>

              {isSale && (
                <FormSection title="POS setup" description="Cashier ke POS screen par yeh product kahan aur kaise khulega.">
                  <Field label="POS grid position" error={shown('sortOrder')} hint="1 = sab se pehle, 2 = us ke baad...">
                    {control => (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input {...control} type="number" inputMode="numeric" min="1" max="999" step="1" className="w-24 text-center font-mono font-bold"
                          value={nums.sortOrder} onWheel={blurOnWheel} onChange={event => setNum('sortOrder', event.target.value)} />
                        <div className="flex flex-wrap gap-1" role="group" aria-label="Position jaldi chunein">
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setNum('sortOrder', String(n))}
                              aria-pressed={Number(nums.sortOrder) === n}
                              className={cn(
                                'size-8 cursor-pointer rounded-lg text-xs font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                Number(nums.sortOrder) === n ? 'bg-brand text-brand-on' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-line hover:bg-surface-3',
                              )}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </Field>

                  <Field label="POS dialog pehle kya dikhaye">
                    {() => (
                      <div className="space-y-1.5">
                        <SegmentedControl
                          aria-label="POS dialog pehle kya dikhaye"
                          fullWidth
                          value={formData.pos_primary_mode === 'qty' ? 'qty' : 'amount'}
                          onChange={value => patch({ pos_primary_mode: value })}
                          options={[{ value: 'amount', label: 'Rupay (cash) pehle' }, { value: 'qty', label: 'Quantity pehle' }]}
                        />
                        <p className="text-xs text-fg-subtle">
                          {formData.pos_primary_mode === 'qty' ? 'Quantity stepper aur volume chips upar aayenge.' : 'Cash buttons upar aayenge. Loose doodh aur dahi ke liye behtar.'}
                        </p>
                      </div>
                    )}
                  </Field>

                  <Field label="Quick cash buttons (Rs)" error={shown('quick')} hint={!quickAmountsRaw.trim() ? 'Khali chhoren to rate ke hisaab se khud bante hain.' : undefined}>
                    {control => (
                      <div className="space-y-2">
                        <Input {...control} inputMode="decimal" className="font-mono" placeholder="e.g. 50, 100, 150, 200" value={quickAmountsRaw} onChange={event => setQuickAmountsRaw(event.target.value)} />
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CASH_PRESETS.map(p => (
                            <Button key={p.value} size="sm" variant="secondary" onClick={() => setQuickAmountsRaw(p.value)}>{p.label}</Button>
                          ))}
                          {quickAmountsRaw && <Button size="sm" variant="ghost" onClick={() => setQuickAmountsRaw('')}>Clear</Button>}
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Raqam add karein">
                          {QUICK_ADD.map(amount => {
                            const added = quick.values.includes(amount);
                            return (
                              <button
                                key={amount}
                                type="button"
                                disabled={added}
                                onClick={() => setQuickAmountsRaw(quickAmountsRaw.trim() ? `${quickAmountsRaw.replace(/[,\s]+$/, '')}, ${amount}` : String(amount))}
                                className="h-7 cursor-pointer rounded-lg bg-surface-2 px-2 font-mono text-xs font-bold text-fg-muted ring-1 ring-inset ring-line transition-colors hover:bg-brand-soft hover:text-brand-fg disabled:cursor-default disabled:bg-brand-soft disabled:text-brand-fg disabled:ring-brand/20"
                              >
                                {added ? <Check className="inline size-3" /> : '+'}{amount}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </Field>
                </FormSection>
              )}

              <FormSection title="Status">
                <div className="divide-y divide-line/70 rounded-card border border-line px-3">
                  <Switch
                    className="py-3"
                    checked={formData.isActive !== false}
                    onChange={next => patch({ isActive: next })}
                    label="Active"
                    description={formData.isActive !== false ? 'POS, purchases aur production mein dikhta hai.' : 'Inactive: kahin bikta ya khareeda nahi jata. Purana record wese hi rehta hai.'}
                  />
                  {isSale && (
                    <Switch
                      className="py-3"
                      checked={formData.allow_loose_sale !== false}
                      onChange={next => patch({ allow_loose_sale: next })}
                      label="Loose sale"
                      description={formData.allow_loose_sale !== false ? `Customer kitna bhi ${unit || 'quantity'} le sakta hai.` : 'Sirf packs mein bikta hai (Sell units tab).'}
                    />
                  )}
                </div>
              </FormSection>
            </>
          )}

          {tab === 'recipe' && (
            <>
              <FormSection title="Standard batch" description="Ek batch mein kitna maal lagta hai aur kitna banta hai.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Input quantity" error={shown('recipe')}>
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix={recipeBaseUnit} placeholder="e.g. 40"
                        value={nums.recipeBase} onWheel={blurOnWheel} onChange={event => setNum('recipeBase', event.target.value)} />
                    )}
                  </Field>
                  <Field label="Expected output (yield)">
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix={unit || undefined} placeholder="e.g. 8.5"
                        value={nums.recipeOutput} onWheel={blurOnWheel} onChange={event => setNum('recipeOutput', event.target.value)} />
                    )}
                  </Field>
                </div>
              </FormSection>

              <FormSection title="Ingredients" description="Raw materials jo is batch mein lagte hain.">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    aria-label="Raw material"
                    className="sm:flex-1"
                    value={newIngredient.itemId}
                    onChange={event => setNewIngredient({ ...newIngredient, itemId: event.target.value })}
                  >
                    <option value="">Raw material chunein...</option>
                    {rawMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                  </Select>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Miqdar"
                      type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                      className="w-28 tabular-nums"
                      suffix={items.find(i => i.id === newIngredient.itemId)?.unit}
                      value={newIngredient.qty}
                      onWheel={blurOnWheel}
                      onChange={event => setNewIngredient({ ...newIngredient, qty: event.target.value })}
                      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addIngredient(); } }}
                    />
                    <Button variant="secondary" leftIcon={<Plus />} onClick={addIngredient}>Add</Button>
                  </div>
                </div>
                {rawMaterials.length === 0 && (
                  <p className="text-xs text-fg-subtle">Koi raw material nahi. Pehle kisi product ko "Raw material" type dein.</p>
                )}
                {(formData.recipe || []).length > 0 && (
                  <ol className="divide-y divide-line/70 overflow-hidden rounded-card border border-line">
                    {(formData.recipe || []).map((ing, index) => (
                      <li key={`${ing.item_id}-${index}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[11px] font-bold text-fg-muted">{index + 1}</span>
                          <span className="truncate text-sm font-semibold text-fg">{items.find(i => i.id === ing.item_id)?.name || ing.item_name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-sm font-semibold tabular-nums text-fg-muted">{formatQty(ing.quantity, 3)} {ing.unit}</span>
                          <IconButton size="sm" aria-label={`${ing.item_name} hatayen`} icon={<X />} onClick={() => removeIngredient(index)} />
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </FormSection>
            </>
          )}

          {tab === 'variants' && (
            <SellUnitsTab
              baseUnit={unit || 'unit'}
              looseRate={sell ?? 0}
              costRate={cost ?? 0}
              allowLoose={formData.allow_loose_sale !== false}
              onToggleLoose={() => patch({ allow_loose_sale: formData.allow_loose_sale === false })}
              variants={formData.variants || []}
              liveLoose={liveLoose}
              liveVariantStocks={liveVariantStocks}
              packagingMaterials={packagingMaterials}
              draft={variantDraft}
              setDraft={setVariantDraft}
              kind={variantKind}
              onKindChange={next => { setVariantKind(next); setVariantDraft({ ...variantDraft, fromBase: next === 'multi_unit' }); }}
              editingIndex={editingVariantIndex}
              onSubmit={submitVariant}
              onEdit={editVariant}
              onRemove={removeVariant}
              onToggleActive={toggleVariantActive}
              onCancelEdit={() => resetVariantForm()}
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-6">
          <p className="hidden min-w-0 flex-1 truncate text-xs sm:block">
            {errorCount > 0
              ? <span className="font-semibold text-danger-fg">{errorCount} {errorCount === 1 ? 'cheez' : 'cheezein'} theek karni hain</span>
              : isDirty ? <span className="text-fg-subtle">Changes save nahi hue</span> : <span className="text-fg-faint">Koi change nahi</span>}
          </p>
          <Button variant="secondary" onClick={requestClose} disabled={isSubmitting} className="flex-1 sm:flex-none">Cancel</Button>
          <Button type="submit" leftIcon={<Save />} loading={isSubmitting} disabled={!canSave || imageBusy} className="flex-[2] sm:flex-none">
            {isEdit ? 'Save changes' : 'Product save karein'}
          </Button>
        </footer>
      </form>

      {unitManagerOpen && (
        <Suspense fallback={null}>
          <UnitManagerModal
            isOpen
            onClose={() => setUnitManagerOpen(false)}
            onSelectUnit={isSystem || unitLocked ? undefined : symbol => {
              patch({ unit: symbol, unit_group_id: detectUnitGroupId(symbol, settings.inventory?.customUnits || []) });
            }}
          />
        </Suspense>
      )}
    </SideSheet>
  );
}
