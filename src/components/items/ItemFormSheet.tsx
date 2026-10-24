import React, { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { sellUnitContains } from '../../lib/sellUnits';
import { formatBaseQty, pileBreakdown, readStock } from '../../lib/stockRules';
import { detectUnitGroupId } from '../../lib/unitConversion';
import { UnitSelector } from '../units/UnitSelector';
import { SellUnitsTab, sellUnitDraftIssues, type SellUnitDraft, type SellUnitKind } from './SellUnitsTab';
import { ImageUploadField } from './ImageUploadField';
import { OpeningStockFields } from './OpeningStockFields';
import { SideSheet } from './SideSheet';
import { Switch } from './Switch';
import {
  EMPTY_OPENING_STOCK, ITEM_TYPES, canTakeOpeningStock, categoryOptions, checkOpeningStock, countOnUnit, pilesHoldingStock,
  profitBasisFor, profitOf, type OpeningStockDraft,
} from './catalogModel';

const UnitManagerModal = lazy(() => import('../units/UnitManagerModal').then(m => ({ default: m.UnitManagerModal })));

type FormTab = 'details' | 'recipe' | 'variants';

const NO_STOCKS: Record<string, number> = {};
const OPENING_NOTE = 'Opening stock (product setup)';

/** Waits until a product just added shows up in the catalog list, and returns its id (null after `timeoutMs`). */
async function waitForNewItem(read: () => ItemDefinition[], name: string, knownIds: Set<string>, timeoutMs = 10000): Promise<string | null> {
  const key = name.trim().toLowerCase();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = read().find(i => !knownIds.has(i.id) && i.name.trim().toLowerCase() === key);
    if (found) return found.id;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return null;
}

interface Props {
  mode: 'create' | 'edit';
  item: ItemDefinition | null;
  /** Edit mode: scroll to the opening stock fields on open (from the detail view's "Opening stock" button). */
  focusOpeningStock?: boolean;
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
  'Sale product': { label: 'Sale product', hint: 'Sold in POS' },
  'Raw material': { label: 'Raw material', hint: 'Used in recipes' },
  'Packaging material': { label: 'Packaging', hint: 'Cup, box, bag' },
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
export default function ItemFormSheet({ mode, item, focusOpeningStock, canDelete, onClose, onSaved, onDelete }: Props) {
  const { items, inventory, inventoryLogs, categories, unitGroups, settings, addItem, updateItem, setOpeningStock, canPerform } = useDairy();
  const { showToast } = useToast();
  const titleId = useId();
  const isEdit = mode === 'edit' && Boolean(item);
  const canSave = isEdit ? canPerform('items', 'edit') : canPerform('items', 'create');
  // Opening stock moves stock, so it needs the Inventory "Adjust stock" right as well.
  const canAdjustStock = canPerform('inventory', 'edit');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const formRef = useRef<HTMLFormElement>(null);
  const openingRef = useRef<HTMLDivElement>(null);

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
        // 0 is a real setting (no alert), so only a missing level falls back.
        reorder: toDraft(clean.reorder_level ?? 10),
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
  const [openingDraft, setOpeningDraft] = useState<OpeningStockDraft>(EMPTY_OPENING_STOCK);

  const patch = (next: Partial<ItemDefinition>) => setFormData(prev => ({ ...prev, ...next }));
  const setNum = (key: keyof NumberDrafts, value: string) => setNums(prev => ({ ...prev, [key]: value }));

  const isSystem = Boolean(formData.isSystem);
  const types = formData.item_type || [];
  const isSale = types.includes('Sale product');
  const unit = (formData.unit || '').trim();
  const showRecipe = formData.source === 'Production' || formData.source === 'Both';
  const tab: FormTab = activeTab === 'recipe' && !showRecipe ? 'details' : activeTab;

  const liveInv = item ? inventory?.find(i => i.item_id === item.id) : undefined;
  const liveLoose = item ? Number(liveInv?.quantity ?? (item as { stock?: number }).stock ?? 0) || 0 : null;
  const liveVariantStocks = useMemo(
    () => (liveInv?.variant_stocks || item?.variant_stocks || NO_STOCKS) as Record<string, number>,
    [liveInv?.variant_stocks, item?.variant_stocks],
  );
  // The saved product's stock, read with the shared rules (docs/stock-model.md). It drives every lock below.
  const savedReading = useMemo(
    () => (isEdit && item ? readStock(item, liveLoose ?? 0, liveVariantStocks) : null),
    [isEdit, item, liveLoose, liveVariantStocks],
  );

  // The base unit measures stock, cost and every pack size, so it cannot be relabelled while any pile holds stock.
  const unitLocked = Boolean(savedReading && pilesHoldingStock(savedReading));

  // Opening stock: always offered while creating; on a saved product only before its first stock move.
  const hasStockLogs = useMemo(
    () => Boolean(item && (inventoryLogs || []).some(log => log.item_id === item.id)),
    [inventoryLogs, item],
  );
  const openingOpen = !isSystem && (!isEdit || Boolean(savedReading && canTakeOpeningStock(savedReading, hasStockLogs)));
  // Read again after the product saves, when this render's value may be out of date.
  const openingOpenRef = useRef(openingOpen);
  openingOpenRef.current = openingOpen;
  const opening = useMemo(() => checkOpeningStock(openingDraft, formData.variants), [openingDraft, formData.variants]);
  const openingTyped = Boolean(openingDraft.loose.trim() || Object.values(openingDraft.packs).some(v => v.trim()));
  // Loose stock with loose sale off and no multi-unit can't be sold anywhere (describeItemStock warns the same).
  const looseStuck = (liveLoose ?? 0) > 0 && formData.allow_loose_sale === false
    && !(formData.variants || []).some(v => v.deduct_from_base === true && v.isActive !== false);

  useEffect(() => {
    if (!focusOpeningStock) return;
    const timer = window.setTimeout(() => {
      openingRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      openingRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusOpeningStock]);

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
    name: !trimmedName ? 'Enter the product name.' : duplicateOf ? `A product named "${duplicateOf.name}" already exists.` : '',
    item_type: types.length === 0 ? 'Choose at least one type.' : '',
    unit: !unit ? 'Choose a base unit.' : '',
    cost: cost !== null && !(cost >= 0) ? 'Cost must be 0 or more.' : '',
    sell: sell !== null && !(sell >= 0) ? 'Rate must be 0 or more.' : '',
    reorder: reorder !== null && !(reorder >= 0) ? 'Enter an alert of 0 or more (0 = no alert).' : '',
    sortOrder: isSale && (sortOrder === null || !Number.isInteger(sortOrder) || sortOrder < 1 || sortOrder > 999) ? 'Enter a whole number from 1 to 999.' : '',
    quick: isSale && quick.invalid ? 'Enter rupee amounts only, separated by commas (e.g. 50, 100).' : '',
    recipe: (recipeBase !== null && !(recipeBase >= 0)) || (recipeOutput !== null && !(recipeOutput >= 0)) ? 'Batch quantities must be 0 or more.' : '',
    opening: openingOpen && canAdjustStock ? opening.firstError : '',
  };
  const errorTab: Record<keyof typeof errors, FormTab> = {
    name: 'details', item_type: 'details', unit: 'details', cost: 'details', sell: 'details', reorder: 'details', sortOrder: 'details', quick: 'details', recipe: 'recipe', opening: 'details',
  };
  // Errors show after the first Save; a duplicate name shows while typing.
  const shown = (key: keyof typeof errors) => ((showErrors || (key === 'name' && Boolean(duplicateOf))) && errors[key]) || undefined;

  const basis = profitBasisFor({ selling_price: sell ?? 0, cost_price: cost ?? 0, unit: unit || 'unit', allow_loose_sale: formData.allow_loose_sale, variants: formData.variants });
  const pricing = profitOf(basis);

  const variantPending = editingVariantIndex >= 0 || Boolean(variantDraft.name.trim() || variantDraft.productQty.trim());
  const isDirty = JSON.stringify([formData, nums, quickAmountsRaw]) !== snapshot || variantPending || openingTyped;

  const requestClose = async () => {
    if (submittingRef.current) return;
    if (isDirty && !(await confirmAction({
      title: 'Unsaved changes',
      message: 'Closing the form will discard these changes.',
      confirmLabel: 'Yes, close',
      cancelLabel: 'Back to form',
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
    if (!material) { showToast('Choose a raw material first', 'warning'); return; }
    if (!(qty > 0)) { showToast('Enter a quantity above 0', 'warning'); return; }
    if ((formData.recipe || []).some(r => r.item_id === material.id)) { showToast(`${material.name} is already in the recipe`, 'warning'); return; }
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
      showToast(`Enter a name and size (in ${unit || 'units'})`, 'warning');
      return;
    }
    const variants = formData.variants || [];
    const issues = sellUnitDraftIssues(variantDraft, variantKind, unit, variants, editingVariantIndex);
    if (issues.length > 0) { showToast(issues[0], 'warning'); return; }
    const isMulti = variantKind === 'multi_unit';
    const packItem = !isMulti && variantDraft.packId ? items.find(i => i.id === variantDraft.packId) : undefined;
    const existing = editingVariantIndex >= 0 ? variants[editingVariantIndex] : undefined;
    // A count on this unit fixes its kind, and a ready-made pack's count also fixes its size (docs/stock-model.md).
    const heldCount = countOnUnit(liveVariantStocks, existing?.id);
    if (existing && heldCount !== 0) {
      const wasMulti = existing.deduct_from_base === true;
      if (wasMulti !== isMulti) { showToast(`${existing.name} has a stock count, so its kind can't change.`, 'warning'); return; }
      if (!wasMulti && Math.abs(sellUnitContains(existing) - contains) > 0.0000001) {
        showToast(`${formatQty(heldCount, 3)} × ${existing.name} in stock, so the size can't change. Add a new pack.`, 'warning');
        return;
      }
    }
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
    showToast(existing ? `${variant.name} updated` : `${variant.name} added`, 'success');
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
    const onHand = countOnUnit(liveVariantStocks, target.id);
    if (target.deduct_from_base !== true && onHand !== 0) {
      showToast(`${formatQty(onHand, 3)} × ${target.name} still in stock, so it can't be removed. First count it to 0 in Inventory, or hide it (the stock stays visible in Inventory).`, 'warning');
      return;
    }
    patch({ variants: (formData.variants || []).filter((_, i) => i !== index) });
    setOpeningDraft(prev => {
      if (!(target.id in prev.packs)) return prev;
      const packs = { ...prev.packs };
      delete packs[target.id];
      return { ...prev, packs };
    });
    if (editingVariantIndex === index) resetVariantForm();
    else if (editingVariantIndex > index) setEditingVariantIndex(editingVariantIndex - 1);
  };

  // Hidden units stay on old bills and keep their stock; they just stop showing in POS.
  const toggleVariantActive = async (index: number) => {
    const target = (formData.variants || [])[index];
    if (!target) return;
    const hiding = target.isActive !== false;
    const onHand = countOnUnit(liveVariantStocks, target.id);
    if (hiding && target.deduct_from_base !== true && onHand !== 0 && !(await confirmAction({
      title: `Hide ${target.name} in POS?`,
      message: `${formatQty(onHand, 3)} × ${target.name} still in stock.`,
      consequences: [
        "This pack won't sell in POS or orders.",
        'The stock stays: it shows in Inventory marked "(hidden)" and still counts in total stock and value.',
        'To clear the stock, count it in Inventory, or show the pack again and sell it.',
      ],
      confirmLabel: 'Yes, hide',
      cancelLabel: 'Back',
      tone: 'warning',
    }))) return;
    setFormData(prev => ({
      ...prev,
      variants: (prev.variants || []).map(v => (v.id === target.id ? { ...v, isActive: !hiding } : v)),
    }));
  };

  // A pack's size is fixed by the stock it holds, so a different size is a new pack next to it.
  const startNewPack = (from: ItemVariant) => {
    setVariantKind('packaging');
    setVariantDraft({ ...EMPTY_DRAFT, packId: from.packaging_item_id || '', packQty: String(from.packaging_qty || 1), fromBase: false });
    setEditingVariantIndex(-1);
  };

  /* ---------- Save ---------- */

  /**
   * `addItem` resolves to the new product's id; where it only says `true` (older context), the id is
   * read from the catalog list once the product arrives. On a saved product the offer is re-checked
   * first: stock that arrived while the form was open (a purchase on another counter) must never be
   * overwritten by an "opening" count.
   */
  const saveOpeningStock = async (knownId: string | null, knownIds: Set<string>) => {
    if (isEdit && !openingOpenRef.current) {
      showToast("Stock arrived in the meantime, so the opening stock wasn't saved. Do a stock count in Inventory.", 'warning');
      return;
    }
    const id = knownId || await waitForNewItem(() => itemsRef.current, trimmedName, knownIds);
    if (!id) {
      showToast("Product saved, but the opening stock couldn't be saved. Open the product and enter it again.", 'warning');
      return;
    }
    // On failure setOpeningStock shows its own message; the product itself is saved either way.
    if (await setOpeningStock(id, opening.piles, OPENING_NOTE)) {
      showToast(`Opening stock saved: ${formatBaseQty(opening.totalBase, unit)}`, 'success');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!canSave) { showToast("You don't have permission to save products", 'warning'); return; }
    setShowErrors(true);
    const firstError = (Object.keys(errors) as (keyof typeof errors)[]).find(key => errors[key]);
    if (firstError) {
      setActiveTab(errorTab[firstError]);
      showToast(errors[firstError], 'warning');
      // Put the cursor on the first field to fix, once the right tab has rendered.
      window.requestAnimationFrame(() => {
        const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.focus();
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    if (imageBusy) { showToast('The photo is still processing. Wait a moment, then save', 'warning'); return; }
    if (variantPending) {
      setActiveTab('variants');
      showToast(editingVariantIndex >= 0 ? 'Unit edit not finished: press "Update unit" or "Cancel"' : 'New unit not added yet: press "Add unit" or clear the fields', 'warning');
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
      reorder_level: reorder ?? 0,
      sort_order: isSale ? (sortOrder as number) : (formData.sort_order ?? 999),
      recipe_base_quantity: recipeBase ?? 0,
      recipe_expected_output: recipeOutput ?? 0,
      pos_primary_mode: formData.pos_primary_mode || 'amount',
      quick_amounts: quick.values,
    };

    // Opening stock is saved right after the product, as one "Opening Stock" move per product.
    const wantsOpening = openingOpen && canAdjustStock && !opening.isEmpty;
    const knownIds = new Set(itemsRef.current.map(i => i.id));

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const saved: unknown = isEdit && item
        ? await updateItem(item.id, finalData)
        : await addItem(finalData as Omit<ItemDefinition, 'id'>);
      if (saved) {
        const savedId = isEdit && item ? item.id : typeof saved === 'string' ? saved : null;
        if (wantsOpening) await saveOpeningStock(savedId, knownIds);
        submittingRef.current = false;
        onSaved();
        return;
      }
    } catch (err: any) {
      showToast("Product couldn't be saved: " + (err?.message || 'Failed'), 'error');
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
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-subtle">{isEdit ? 'Edit product' : 'New product'}</p>
            <h2 id={titleId} className="truncate text-xl font-bold tracking-tight text-fg">{trimmedName || (isEdit ? item?.name : 'Product name')}</h2>
          </div>
          {isEdit && item && canDelete && !isSystem && (
            <IconButton aria-label="Delete product" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onDelete(item.id)} />
          )}
          <IconButton aria-label="Close" icon={<X />} onClick={requestClose} />
        </div>
        <SegmentedControl aria-label="Form sections" variant="underline" value={tab} onChange={setActiveTab} options={tabOptions} className="mt-3" />
      </header>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={event => {
          // Ctrl+S / Cmd+S saves from any field, like the rest of the app's forms.
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
      >
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {tab === 'details' && (
            <>
              {isSystem && (
                <div className="flex items-start gap-3 rounded-card border border-info/20 bg-info-soft px-4 py-3 text-info-fg">
                  <Lock className="mt-0.5 size-4 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    <strong className="font-bold">System milk variety.</strong> Name, type and unit can't change, so the accounts stay correct. You can change cost, rate and Active status.
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
                <Field label="Product name" required error={shown('name')} hint="This name shows in Inventory, POS and bills.">
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
                  <legend className="mb-1.5 text-xs font-semibold text-fg-muted">Used for<span className="ml-0.5 text-danger" aria-hidden="true">*</span></legend>
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
                description="Stock, cost and every pack size are measured in this unit."
                aside={!isSystem && <Button size="sm" variant="ghost" leftIcon={<Ruler />} onClick={() => setUnitManagerOpen(true)}>Manage units</Button>}
              >
                <div>
                  <UnitSelector
                    value={formData.unit || ''}
                    disabled={isSystem || unitLocked}
                    onChange={(symbol, groupId) => patch({ unit: symbol, unit_group_id: groupId })}
                  />
                  {unitLocked && savedReading && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-fg-subtle">
                      <Lock className="mt-0.5 size-3 shrink-0" />
                      <span>
                        Unit is locked: there is stock ({pileBreakdown(savedReading).join(' · ')}). Changing the unit would read this stock wrongly in the new unit.
                        To change it, first count every pile to 0 in Inventory.
                      </span>
                    </p>
                  )}
                  {shown('unit') && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{errors.unit}</p>}
                </div>
              </FormSection>

              <FormSection title="Price and stock alert" description={unit ? `Every rate is per 1 ${unit}.` : 'Choose a unit first.'}>
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
                  <Field
                    label={`Low stock alert${unit ? ` (${unit})` : ''}`}
                    error={shown('reorder')}
                    hint={Number(nums.reorder) > 0 ? `Alert when total stock (loose + packs) is ${nums.reorder}${unit ? ` ${unit}` : ''} or less.` : '0 or empty = no alert.'}
                  >
                    {control => (
                      <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix={unit || undefined} placeholder="0 = off"
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
                        {pricing.profit < 0 ? 'Loss' : 'Profit'} <Money amount={Math.abs(pricing.profit)} className="font-bold" /> per {basis.per}
                        {basis.per !== unit && <span className="text-xs"> (loose sale is off, first pack)</span>}
                      </span>
                      <span className="flex items-center gap-2 text-xs font-semibold">
                        {pricing.marginPct !== null && <Badge tone={pricing.profit < 0 ? 'danger' : 'success'}>{pricing.marginPct.toFixed(1)}% margin</Badge>}
                        {pricing.markupPct !== null && <Badge tone="neutral">{pricing.markupPct.toFixed(0)}% markup</Badge>}
                      </span>
                    </div>
                  ) : (
                    <p className="flex items-center gap-2 rounded-control bg-warning-soft px-3.5 py-2.5 text-xs font-medium text-warning-fg">
                      <AlertTriangle className="size-4 shrink-0" />Selling rate is 0 and no pack has a price. This product won't sell in POS.
                    </p>
                  )
                )}
              </FormSection>

              {openingOpen && (
                <div ref={openingRef}>
                  <FormSection
                    title="Opening stock"
                    description={isEdit
                      ? 'This product has no stock or stock record yet. If the shop already has stock, enter it here.'
                      : 'How much stock does the shop have now? On save it is recorded in Inventory as "Opening Stock".'}
                    aside={<Badge tone="neutral">Optional</Badge>}
                  >
                    <OpeningStockFields
                      baseUnit={unit}
                      costRate={cost ?? 0}
                      variants={formData.variants || []}
                      draft={openingDraft}
                      onChange={setOpeningDraft}
                      check={opening}
                      showErrors={showErrors}
                      disabledReason={canAdjustStock ? undefined : 'Entering stock needs the Inventory "Adjust stock" permission.'}
                      onOpenSellUnits={() => setActiveTab('variants')}
                    />
                  </FormSection>
                </div>
              )}

              {isSale && (
                <FormSection title="POS setup" description="Where and how this product opens on the cashier's POS screen.">
                  <Field label="POS grid position" error={shown('sortOrder')} hint="1 = first, 2 = next...">
                    {control => (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input {...control} type="number" inputMode="numeric" min="1" max="999" step="1" className="w-24 text-center font-mono font-bold"
                          value={nums.sortOrder} onWheel={blurOnWheel} onChange={event => setNum('sortOrder', event.target.value)} />
                        <div className="flex flex-wrap gap-1" role="group" aria-label="Quick pick position">
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

                  <Field label="What the POS dialog shows first">
                    {() => (
                      <div className="space-y-1.5">
                        <SegmentedControl
                          aria-label="What the POS dialog shows first"
                          fullWidth
                          value={formData.pos_primary_mode === 'qty' ? 'qty' : 'amount'}
                          onChange={value => patch({ pos_primary_mode: value })}
                          options={[{ value: 'amount', label: 'Rupees (cash) first' }, { value: 'qty', label: 'Quantity first' }]}
                        />
                        <p className="text-xs text-fg-subtle">
                          {formData.pos_primary_mode === 'qty' ? 'Quantity stepper and volume chips come first.' : 'Cash buttons come first. Best for loose milk and yogurt.'}
                        </p>
                      </div>
                    )}
                  </Field>

                  <Field label="Quick cash buttons (Rs)" error={shown('quick')} hint={!quickAmountsRaw.trim() ? 'Leave empty to build them from the rate.' : undefined}>
                    {control => (
                      <div className="space-y-2">
                        <Input {...control} inputMode="decimal" className="font-mono" placeholder="e.g. 50, 100, 150, 200" value={quickAmountsRaw} onChange={event => setQuickAmountsRaw(event.target.value)} />
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CASH_PRESETS.map(p => (
                            <Button key={p.value} size="sm" variant="secondary" onClick={() => setQuickAmountsRaw(p.value)}>{p.label}</Button>
                          ))}
                          {quickAmountsRaw && <Button size="sm" variant="ghost" onClick={() => setQuickAmountsRaw('')}>Clear</Button>}
                        </div>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add amount">
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
                    description={formData.isActive !== false ? 'Shows in POS, purchases and production.' : 'Inactive: not sold or bought anywhere. Old records stay as they are.'}
                  />
                  {isSale && (
                    <Switch
                      className="py-3"
                      checked={formData.allow_loose_sale !== false}
                      onChange={next => patch({ allow_loose_sale: next })}
                      label="Loose sale"
                      description={formData.allow_loose_sale !== false
                        ? `Customers can buy any amount${unit ? ` in ${unit}` : ''}.`
                        : <>
                          Sold in packs only (Sell units tab).
                          {looseStuck && <span className="mt-0.5 block font-semibold text-warning-fg">{formatBaseQty(liveLoose || 0, unit)} loose stock won't sell in POS while loose sale is off and there is no multi-unit.</span>}
                        </>}
                    />
                  )}
                </div>
              </FormSection>
            </>
          )}

          {tab === 'recipe' && (
            <>
              <FormSection title="Standard batch" description="How much goes into one batch and how much it makes.">
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

              <FormSection title="Ingredients" description="Raw materials used in this batch.">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Select
                    aria-label="Raw material"
                    className="sm:flex-1"
                    value={newIngredient.itemId}
                    onChange={event => setNewIngredient({ ...newIngredient, itemId: event.target.value })}
                  >
                    <option value="">Choose raw material...</option>
                    {rawMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                  </Select>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Quantity"
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
                  <p className="text-xs text-fg-subtle">No raw materials yet. First give a product the "Raw material" type.</p>
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
                          <IconButton size="sm" aria-label={`Remove ${ing.item_name}`} icon={<X />} onClick={() => removeIngredient(index)} />
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
              onToggleActive={index => { void toggleVariantActive(index); }}
              onCancelEdit={() => resetVariantForm()}
              onStartNewPack={startNewPack}
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-6">
          <p className="hidden min-w-0 flex-1 truncate text-xs sm:block">
            {errorCount > 0
              ? <span className="font-semibold text-danger-fg">{errorCount} {errorCount === 1 ? 'thing' : 'things'} to fix</span>
              : isDirty ? <span className="text-fg-subtle">Unsaved changes</span> : <span className="text-fg-faint">No changes</span>}
          </p>
          <Button variant="secondary" onClick={requestClose} disabled={isSubmitting} className="flex-1 sm:flex-none">Cancel</Button>
          <Button type="submit" leftIcon={<Save />} loading={isSubmitting} disabled={!canSave || imageBusy} className="flex-[2] sm:flex-none">
            {isEdit ? 'Save changes' : 'Save product'}
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
