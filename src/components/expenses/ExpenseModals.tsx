import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderTree, Plus, ChevronDown, ChevronRight, Edit, Check, Lock, Trash2, AlertCircle,
  Users, Building, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, Bookmark, Receipt,
  CheckCircle2, CircleDashed, Clock3, History, StickyNote, Landmark, UserPlus, X,
} from 'lucide-react';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { CategoryStructure, SubcategoryStructure, SERVICE_TYPES } from './ExpenseTypes';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { SmartNumberInput } from '../SmartNumberInput';
import { useDairy } from '../../context/DairyContext';
import { formatCurrency } from '../../lib/formatters';
import { offsetDate } from '../../lib/dashboardAnalytics';
import { cn } from '../../lib/cn';
import { Button, EmptyState, IconButton, Input, Money, SearchInput, SegmentedControl, Textarea } from '../ui';
import type { SegmentOption } from '../ui';
import { CategoryBadge, Dot, SettlementBar, StatusPill, categoryTone, dayKey, pkToday } from './ExpenseUI';
import {
  ChoiceChip, FieldLabel, LinkButton, OptionCard, QuickPick, Sheet, SheetBody, SheetFooter, SheetIcon, Switch, fieldClass,
} from './ExpenseSheet';

const MODE_OPTIONS: SegmentOption<string>[] = [
  { value: 'Cash', label: 'Cash', icon: <Wallet /> },
  { value: 'Online', label: 'Online', icon: <CreditCard /> },
  { value: 'Bank Transfer', label: 'Bank', icon: <Building /> },
];

/** Default account for a payment mode: the configured cash or digital account, else the first match. */
const defaultAccountFor = (mode: string, accounts: any[], settings: any) => (
  mode === 'Cash'
    ? settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || ''
    : settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || ''
);

/**
 * The vendor pickers list active vendors only, so an inactive vendor that is already chosen (paying off
 * its dues, editing an old bill) showed "Select vendor…" while the save still went to that vendor.
 */
const withChosenVendor = (options: RichSelectOption[], vendors: ExpenseVendor[], vendorId?: string): RichSelectOption[] => {
  if (!vendorId || options.some(option => option.value === vendorId)) return options;
  const vendor = vendors.find(v => v.id === vendorId);
  if (!vendor) return options;
  return [...options, {
    value: vendor.id,
    label: vendor.name,
    subLabel: `${vendor.service_type || 'Vendor'} · Inactive`,
    avatarLetter: vendor.name.charAt(0).toUpperCase(),
  }];
};

const submitOnCtrlEnter = (event: React.KeyboardEvent<HTMLFormElement>) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    // requestSubmit() ignores a disabled Save button (locked date / already saving).
    const submitButton = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton?.disabled) return;
    event.currentTarget.requestSubmit();
  }
};

/** Big amount field: "Rs" prefix, large tabular figures, math like 1200+350 allowed. */
const amountClass = cn(fieldClass, 'h-14 rounded-card pl-12 pr-4 text-2xl font-bold tracking-tight tabular-nums placeholder:text-fg-faint');

const RsPrefix: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'lg' }) => (
  <span
    className={cn('pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 font-bold text-fg-faint', size === 'lg' ? 'left-4 text-lg' : 'left-3 text-sm')}
    aria-hidden="true"
  >
    Rs
  </span>
);

const LockedBanner: React.FC<{ date?: string; what: string }> = ({ date, what }) => (
  <div className="mb-4 flex items-start gap-2.5 rounded-control border border-warning/30 bg-warning-soft p-3 text-xs font-semibold text-warning-fg" role="alert">
    <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span><strong>{date} band ho chuka hai.</strong> Lock din par {what} record nahi ho sakta — date badlein.</span>
  </div>
);

const InlineCreate: React.FC<{
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}> = ({ placeholder, value, onChange, onSave, onCancel, saving }) => (
  <div className="flex gap-1.5 animate-in fade-in">
    <Input
      inputSize="md"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onSave(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      autoFocus
      className="border-brand-accent"
    />
    <Button onClick={onSave} disabled={!value.trim()} loading={saving} className="shrink-0">Save</Button>
    <IconButton aria-label="Cancel" icon={<X />} onClick={onCancel} className="shrink-0" />
  </div>
);

interface ExpenseCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  categoryTree: CategoryStructure[];
  categorySearch: string;
  setCategorySearch: (s: string) => void;
  modalCatFilter: 'all' | 'active' | 'inactive';
  setModalCatFilter: (f: 'all' | 'active' | 'inactive') => void;
  isModalCreatingMainCat: boolean;
  setIsModalCreatingMainCat: (b: boolean) => void;
  modalNewCategoryName: string;
  setModalNewCategoryName: (s: string) => void;
  handleModalAddCategory: (e: React.FormEvent) => Promise<boolean | void>;
  handleToggleCategoryActive: (cat: CategoryStructure) => Promise<void>;
  handleStartEditCategory: (cat: CategoryStructure) => void;
  handleSaveEditCategory: (cat: CategoryStructure) => Promise<void>;
  editingCatName: string | null;
  setEditingCatName: (s: string | null) => void;
  editCatInput: string;
  setEditCatInput: (s: string) => void;
  handleDeleteCategory: (cat: CategoryStructure) => Promise<void>;
  getCategoryUsageCount: (catName: string) => number;
  expandedCatsInModal: Record<string, boolean>;
  setExpandedCatsInModal: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  getSubcategoryUsageCount: (catName: string, subName: string) => number;
  editingSubcatKey: string | null;
  setEditingSubcatKey: (s: string | null) => void;
  editSubcatInput: string;
  setEditSubcatInput: (s: string) => void;
  handleStartEditSubcategory: (parentCatName: string, sub: SubcategoryStructure) => void;
  handleSaveEditSubcategory: (parentCatName: string, sub: SubcategoryStructure) => Promise<void>;
  handleToggleSubcategoryActive: (parentCatName: string, sub: SubcategoryStructure) => Promise<void>;
  handleDeleteSubcategory: (parentCatName: string, sub: SubcategoryStructure) => Promise<void>;
  newSubcatInputs: Record<string, string>;
  setNewSubcatInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleModalAddSubcat: (parentCatName: string) => Promise<void>;
}

export const ExpenseCategoryModal: React.FC<ExpenseCategoryModalProps> = ({
  isOpen, onClose, categoryTree, categorySearch, setCategorySearch, modalCatFilter, setModalCatFilter,
  isModalCreatingMainCat, setIsModalCreatingMainCat, modalNewCategoryName, setModalNewCategoryName,
  handleModalAddCategory, handleToggleCategoryActive, handleStartEditCategory, handleSaveEditCategory,
  editingCatName, setEditingCatName, editCatInput, setEditCatInput, handleDeleteCategory, getCategoryUsageCount,
  expandedCatsInModal, setExpandedCatsInModal, getSubcategoryUsageCount, editingSubcatKey, setEditingSubcatKey,
  editSubcatInput, setEditSubcatInput, handleStartEditSubcategory, handleSaveEditSubcategory,
  handleToggleSubcategoryActive, handleDeleteSubcategory, newSubcatInputs, setNewSubcatInputs, handleModalAddSubcat,
}) => {
  if (!isOpen) return null;

  const needle = categorySearch.trim().toLowerCase();
  const filteredCategories = categoryTree.filter(c => {
    const searchMatch = !needle || c.name.toLowerCase().includes(needle) || c.subcategories.some(s => s.name.toLowerCase().includes(needle));
    if (!searchMatch) return false;
    if (modalCatFilter === 'active') return c.isActive;
    if (modalCatFilter === 'inactive') return !c.isActive;
    return true;
  });
  const activeCount = categoryTree.filter(c => c.isActive).length;

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      size="xl"
      icon={<SheetIcon icon={FolderTree} />}
      title="Expense categories"
      subtitle="Rename, switch off unused heads, or add sub-categories. Categories with entries are locked from delete."
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput
            value={categorySearch}
            onChange={setCategorySearch}
            placeholder="Search categories or sub-categories…"
            aria-label="Category search karein"
            className="flex-1"
          />
          <SegmentedControl
            aria-label="Category status"
            size="sm"
            value={modalCatFilter}
            onChange={setModalCatFilter}
            options={[
              { value: 'all', label: 'All', count: categoryTree.length },
              { value: 'active', label: 'Active', count: activeCount, icon: <Dot className="bg-success" /> },
              { value: 'inactive', label: 'Off', count: categoryTree.length - activeCount, icon: <Dot className="bg-fg-faint" /> },
            ]}
          />
          <Button leftIcon={<Plus />} onClick={() => setIsModalCreatingMainCat(!isModalCreatingMainCat)} aria-expanded={isModalCreatingMainCat} className="shrink-0">
            New category
          </Button>
        </div>
        {isModalCreatingMainCat && (
          <form
            onSubmit={async e => {
              const ok = await handleModalAddCategory(e);
              if (ok !== false) setIsModalCreatingMainCat(false);
            }}
            className="flex flex-col gap-2 rounded-control border border-brand/25 bg-brand-soft/60 p-2.5 animate-in fade-in sm:flex-row"
          >
            <Input
              placeholder="Category name, e.g. Animal Feed, Veterinary"
              aria-label="Nayi category ka naam"
              value={modalNewCategoryName}
              onChange={e => setModalNewCategoryName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <Button variant="ghost" onClick={() => { setIsModalCreatingMainCat(false); setModalNewCategoryName(''); }}>Cancel</Button>
              <Button type="submit" disabled={!modalNewCategoryName.trim()}>Save</Button>
            </div>
          </form>
        )}
      </div>

      <SheetBody className="flex flex-col gap-2 bg-surface-2/50">
        {filteredCategories.map(cat => {
          const isExpanded = expandedCatsInModal[cat.name] ?? Boolean(needle);
          const usageCount = getCategoryUsageCount(cat.name);
          const isLocked = usageCount > 0;
          const isEditing = editingCatName === cat.name;
          const toggleExpanded = () => setExpandedCatsInModal(prev => ({ ...prev, [cat.name]: !isExpanded }));

          return (
            <div key={cat.name} className={cn('overflow-hidden rounded-card border border-line bg-surface shadow-e1 transition-opacity', !cat.isActive && 'opacity-70')}>
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <IconButton
                  size="sm"
                  aria-label={isExpanded ? 'Band karein' : 'Kholein'}
                  aria-expanded={isExpanded}
                  icon={isExpanded ? <ChevronDown /> : <ChevronRight />}
                  onClick={toggleExpanded}
                  className="shrink-0"
                />
                <CategoryBadge name={cat.name} size="sm" />

                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Input
                      inputSize="sm"
                      aria-label="Category ka naya naam"
                      value={editCatInput}
                      onChange={e => setEditCatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveEditCategory(cat);
                        if (e.key === 'Escape') { e.preventDefault(); setEditingCatName(null); }
                      }}
                      autoFocus
                    />
                    <IconButton size="sm" variant="primary" aria-label="Naam save karein" icon={<Check />} onClick={() => handleSaveEditCategory(cat)} className="shrink-0" />
                    <IconButton size="sm" aria-label="Cancel" icon={<X />} onClick={() => setEditingCatName(null)} className="shrink-0" />
                  </div>
                ) : (
                  <button type="button" onClick={toggleExpanded} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className={cn('block truncate text-sm font-bold', cat.isActive ? 'text-fg' : 'text-fg-subtle line-through')}>{cat.name}</span>
                    <span className="block text-[11px] text-fg-subtle">{cat.subcategories.length} sub-categories{isLocked ? ` · ${usageCount} entries` : ''}</span>
                  </button>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {isLocked && (
                    <span title={`${usageCount} entries — delete locked`} className="hidden items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning-fg sm:flex">
                      <Lock size={10} aria-hidden="true" />{usageCount}
                    </span>
                  )}
                  {!isEditing && (
                    <IconButton size="sm" aria-label="Naam badlein" title="Rename" icon={<Edit />} onClick={() => handleStartEditCategory(cat)} />
                  )}
                  <Switch checked={cat.isActive} onChange={() => handleToggleCategoryActive(cat)} label={cat.isActive ? 'Category band karein' : 'Category chalu karein'} />
                  <IconButton
                    size="sm"
                    aria-label={isLocked ? 'Entries wali category delete nahi ho sakti' : 'Category delete karein'}
                    title={isLocked ? 'Has entries — cannot delete' : 'Delete'}
                    icon={<Trash2 />}
                    onClick={() => handleDeleteCategory(cat)}
                    disabled={isLocked}
                    className="hover:bg-danger-soft hover:text-danger-fg"
                  />
                </div>
              </div>

              {isExpanded && (
                <div className="flex flex-col gap-1 border-t border-line bg-surface-2/60 px-3 py-2.5 pl-12">
                  {cat.subcategories.map(sub => {
                    const subUsage = getSubcategoryUsageCount(cat.name, sub.name);
                    const isSubLocked = subUsage > 0;
                    const isSubEditing = editingSubcatKey === `${cat.name}::${sub.name}`;
                    return (
                      <div key={sub.name} className={cn('flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs', !sub.isActive && 'opacity-60')}>
                        <span className={cn('size-1.5 shrink-0 rounded-full', categoryTone(cat.name).bar)} aria-hidden="true" />
                        {isSubEditing ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <Input
                              inputSize="sm"
                              aria-label="Sub-category ka naya naam"
                              value={editSubcatInput}
                              onChange={e => setEditSubcatInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveEditSubcategory(cat.name, sub);
                                if (e.key === 'Escape') { e.preventDefault(); setEditingSubcatKey(null); }
                              }}
                              autoFocus
                            />
                            <IconButton size="sm" variant="primary" aria-label="Save" icon={<Check />} onClick={() => handleSaveEditSubcategory(cat.name, sub)} className="shrink-0" />
                            <IconButton size="sm" aria-label="Cancel" icon={<X />} onClick={() => setEditingSubcatKey(null)} className="shrink-0" />
                          </div>
                        ) : (
                          <span className={cn('min-w-0 flex-1 truncate font-semibold', sub.isActive ? 'text-fg' : 'text-fg-subtle line-through')}>{sub.name}</span>
                        )}
                        {isSubLocked && (
                          <span className="flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-[9px] font-bold text-warning-fg"><Lock size={8} aria-hidden="true" />{subUsage}</span>
                        )}
                        {!isSubEditing && (
                          <IconButton size="sm" aria-label="Naam badlein" title="Rename" icon={<Edit />} onClick={() => handleStartEditSubcategory(cat.name, sub)} className="size-7" />
                        )}
                        <Switch size="sm" checked={sub.isActive} onChange={() => handleToggleSubcategoryActive(cat.name, sub)} label={sub.isActive ? 'Band karein' : 'Chalu karein'} />
                        <IconButton
                          size="sm"
                          aria-label={isSubLocked ? 'Entries wali sub-category delete nahi ho sakti' : 'Sub-category delete karein'}
                          icon={<Trash2 />}
                          onClick={() => handleDeleteSubcategory(cat.name, sub)}
                          disabled={isSubLocked}
                          className="size-7 hover:bg-danger-soft hover:text-danger-fg"
                        />
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-1.5 pt-1">
                    <Input
                      inputSize="sm"
                      placeholder={`Add sub-category under ${cat.name}…`}
                      aria-label={`${cat.name} mein sub-category add karein`}
                      value={newSubcatInputs[cat.name] || ''}
                      onChange={e => setNewSubcatInputs({ ...newSubcatInputs, [cat.name]: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleModalAddSubcat(cat.name); } }}
                    />
                    <Button size="sm" disabled={!newSubcatInputs[cat.name]?.trim()} onClick={() => handleModalAddSubcat(cat.name)} className="shrink-0">
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filteredCategories.length === 0 && (
          <div className="rounded-card border border-dashed border-line-strong bg-surface">
            <EmptyState size="compact" icon={<FolderTree />} title="No categories found" description="Try another word or create a new category." />
          </div>
        )}
      </SheetBody>

      <SheetFooter className="justify-between">
        <span className="text-xs text-fg-subtle"><strong className="text-fg">{categoryTree.length}</strong> categories · <span className="font-bold text-success-fg">{activeCount} active</span></span>
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </SheetFooter>
    </Sheet>
  );
};

type ExpenseForm = Partial<ExpenseEntry> & {
  paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
  account_id?: string;
  dueDate?: string;
};

interface ExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEditing?: boolean;
  formData: ExpenseForm;
  setFormData: React.Dispatch<React.SetStateAction<ExpenseForm>>;
  handleSubmitExpense: (e: React.FormEvent) => Promise<void>;
  isSubmitting: boolean;
  categoryRichOptions: RichSelectOption[];
  activeSubcategoryList: SubcategoryStructure[];
  vendorRichOptions: RichSelectOption[];
  accountRichOptions: RichSelectOption[];
  selectedPaymentAccount: any;
  isModalCreatingCat: boolean;
  setIsModalCreatingCat: (b: boolean) => void;
  modalNewCatInput: string;
  setModalNewCatInput: (s: string) => void;
  handleCreateMainCategory: (name: string) => Promise<string | null>;
  isModalCreatingSub: boolean;
  setIsModalCreatingSub: (b: boolean) => void;
  modalNewSubInput: string;
  setModalNewSubInput: (s: string) => void;
  handleCreateSubcategory: (cat: string, sub: string) => Promise<string | null>;
  isModalCreatingVendor: boolean;
  setIsModalCreatingVendor: (b: boolean) => void;
  quickVendorName: string;
  setQuickVendorName: (s: string) => void;
  quickVendorPhone: string;
  setQuickVendorPhone: (s: string) => void;
  handleQuickCreateVendor: () => Promise<void>;
  isCreatingQuickVendor?: boolean;
  accounts: any[];
  settings: any;
  rememberExpense: boolean;
  setRememberExpense: (value: boolean) => void;
  rememberName: string;
  setRememberName: (value: string) => void;
}

const STATUS_CARDS: { value: 'Paid' | 'Partial' | 'Unpaid'; label: string; hint: string; icon: React.ElementType; tone: 'success' | 'warning' | 'danger' }[] = [
  { value: 'Paid', label: 'Paid now', hint: 'Full amount paid', icon: CheckCircle2, tone: 'success' },
  { value: 'Partial', label: 'Partial', hint: 'Some now, rest khata', icon: CircleDashed, tone: 'warning' },
  { value: 'Unpaid', label: 'On credit', hint: 'Add to vendor khata', icon: Clock3, tone: 'danger' },
];

export const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({
  isOpen, onClose, isEditing = false, formData, setFormData, handleSubmitExpense, isSubmitting,
  categoryRichOptions, activeSubcategoryList, vendorRichOptions, accountRichOptions, selectedPaymentAccount,
  isModalCreatingCat, setIsModalCreatingCat, modalNewCatInput, setModalNewCatInput, handleCreateMainCategory,
  isModalCreatingSub, setIsModalCreatingSub, modalNewSubInput, setModalNewSubInput, handleCreateSubcategory,
  isModalCreatingVendor, setIsModalCreatingVendor, quickVendorName, setQuickVendorName, quickVendorPhone,
  setQuickVendorPhone, handleQuickCreateVendor, isCreatingQuickVendor = false, accounts, settings, rememberExpense, setRememberExpense,
  rememberName, setRememberName,
}) => {
  const { isDayLocked, expenses, expenseVendors } = useDairy();
  const [showNotes, setShowNotes] = useState(false);
  const descriptionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) setShowNotes(Boolean(formData.notes));
    // Only when the sheet opens; typing a note must not collapse it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const today = pkToday();
  const yesterday = offsetDate(today, -1);

  // Most used categories first, so the usual heads are one tap away.
  const quickCategories = useMemo(() => {
    const active = new Set(categoryRichOptions.map(o => o.value));
    const counts = new Map<string, number>();
    expenses.forEach(exp => { if (exp.category && active.has(exp.category)) counts.set(exp.category, (counts.get(exp.category) || 0) + 1); });
    const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
    categoryRichOptions.forEach(o => { if (!ranked.includes(o.value)) ranked.push(o.value); });
    return ranked.slice(0, 6);
  }, [expenses, categoryRichOptions]);

  // Last entry per description, newest wins: powers suggestions and the "last time" hint.
  const lastByDescription = useMemo(() => {
    const map = new Map<string, ExpenseEntry>();
    [...expenses]
      .sort((a, b) => dayKey(b.date).localeCompare(dayKey(a.date)))
      .forEach(exp => {
        const key = (exp.description || '').trim().toLowerCase();
        if (key && !map.has(key)) map.set(key, exp);
      });
    return map;
  }, [expenses]);
  const suggestions = useMemo(() => Array.from(lastByDescription.values()).slice(0, 60), [lastByDescription]);

  if (!isOpen) return null;

  const isDateLocked = Boolean(isDayLocked && formData.date && isDayLocked(formData.date));
  const status = formData.paymentStatus;
  const amount = formData.amount || 0;
  const paidNow = status === 'Paid' ? amount : status === 'Unpaid' ? 0 : Math.min(amount, Math.max(0, formData.paidAmount || 0));
  const due = Math.max(0, amount - paidNow);
  const needsVendor = status !== 'Paid';
  const vendor = expenseVendors.find(v => v.id === formData.vendor_id);
  const vendorBalance = vendor?.pending_balance || 0;
  const lastTime = lastByDescription.get((formData.description || '').trim().toLowerCase());
  const accountAfter = selectedPaymentAccount ? selectedPaymentAccount.balance - (isEditing ? 0 : paidNow) : 0;
  const datalistId = 'expense-description-suggestions';

  const setStatus = (next: 'Paid' | 'Partial' | 'Unpaid') => {
    setFormData(prev => {
      const total = prev.amount || 0;
      const paid = prev.paidAmount || 0;
      return {
        ...prev,
        paymentStatus: next,
        // Partial starts empty: coming from "Paid now" it used to carry the full amount over, so an
        // untouched Partial bill was really fully paid.
        paidAmount: next === 'Paid' ? total : next === 'Unpaid' ? 0 : (paid > 0 && paid < total ? paid : 0),
      };
    });
  };

  const setDescription = (value: string) => {
    const match = lastByDescription.get(value.trim().toLowerCase());
    setFormData(prev => {
      const next = { ...prev, description: value };
      // Picking a known description fills its usual category when none is chosen yet.
      if (match && !prev.category && categoryRichOptions.some(o => o.value === match.category)) {
        next.category = match.category;
        next.subcategory = match.subcategory || '';
      }
      return next;
    });
  };

  const createCategory = async () => {
    if (!modalNewCatInput.trim()) return;
    const res = await handleCreateMainCategory(modalNewCatInput);
    if (res) {
      setFormData(prev => ({ ...prev, category: res, subcategory: '' }));
      setModalNewCatInput('');
      setIsModalCreatingCat(false);
    }
  };

  const createSubcategory = async () => {
    if (!modalNewSubInput.trim() || !formData.category) return;
    const res = await handleCreateSubcategory(formData.category, modalNewSubInput);
    if (res) {
      setFormData(prev => ({ ...prev, subcategory: res }));
      setModalNewSubInput('');
      setIsModalCreatingSub(false);
    }
  };

  const submitLabel = isEditing ? 'Save changes' : status === 'Unpaid' ? 'Save bill to khata' : `Record ${amount > 0 ? formatCurrency(amount) : 'expense'}`;

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      dismissible={!isSubmitting}
      icon={<SheetIcon icon={Receipt} tone="expense" />}
      title={isEditing ? 'Edit expense' : 'Record expense'}
      subtitle={isEditing ? 'Changes adjust the account and vendor khata automatically.' : 'Cash, bank or on-credit vendor bill · Ctrl+Enter to save'}
    >
      <form onSubmit={handleSubmitExpense} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="flex flex-col gap-5">
          {isDateLocked && <LockedBanner date={formData.date} what="kharcha" />}

          <section className="flex flex-col gap-3">
            <div>
              <FieldLabel htmlFor="expense-amount">Amount</FieldLabel>
              <div className="relative">
                <RsPrefix />
                <SmartNumberInput
                  id="expense-amount"
                  data-autofocus
                  className={amountClass}
                  placeholder="0"
                  required
                  value={formData.amount || ''}
                  onChange={val => {
                    const num = parseFloat(val) || 0;
                    setFormData(prev => ({
                      ...prev,
                      amount: num,
                      paidAmount: prev.paymentStatus === 'Paid' ? num : prev.paymentStatus === 'Unpaid' ? 0 : Math.min(num, prev.paidAmount || 0),
                    }));
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-fg-subtle">Math works too: 1200+350 or 45*20</p>
            </div>

            <div role="radiogroup" aria-label="Payment status" className="grid grid-cols-3 gap-2">
              {STATUS_CARDS.map(card => (
                <OptionCard
                  key={card.value}
                  selected={status === card.value}
                  onClick={() => setStatus(card.value)}
                  tone={card.tone}
                  icon={card.icon}
                  label={card.label}
                  hint={card.hint}
                  hintClassName="hidden sm:block"
                />
              ))}
            </div>

            {status === 'Partial' && (
              <div className="rounded-control border border-warning/30 bg-warning-soft/60 p-3 animate-in fade-in">
                <FieldLabel htmlFor="expense-paid-now" aside={<span className="text-[11px] font-bold tabular-nums text-danger-fg">Khata: {formatCurrency(due)}</span>}>Paid now</FieldLabel>
                <SmartNumberInput
                  id="expense-paid-now"
                  max={amount}
                  className={cn(fieldClass, 'tabular-nums text-success-fg')}
                  placeholder="Amount paid today"
                  value={formData.paidAmount || ''}
                  onChange={val => setFormData(prev => ({ ...prev, paidAmount: parseFloat(val) || 0 }))}
                />
                {amount > 0 && <div className="mt-2.5"><SettlementBar total={amount} paid={paidNow} formatMoney={formatCurrency} /></div>}
              </div>
            )}
            {status === 'Unpaid' && amount > 0 && (
              <p className="flex items-start gap-2 rounded-control border border-danger/20 bg-danger-soft px-3 py-2 text-[11px] text-danger-fg animate-in fade-in">
                <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
                No cash leaves today. {formatCurrency(amount)} goes on the vendor&apos;s khata.
              </p>
            )}
          </section>

          <section>
            <FieldLabel htmlFor="expense-description">What was it for?</FieldLabel>
            <input
              id="expense-description"
              ref={descriptionRef}
              type="text"
              list={datalistId}
              autoComplete="off"
              className={fieldClass}
              placeholder="e.g. Generator diesel, ice blocks, staff tea"
              required
              value={formData.description || ''}
              onChange={e => setDescription(e.target.value)}
            />
            <datalist id={datalistId}>
              {suggestions.map(exp => <option key={exp.id} value={exp.description} />)}
            </datalist>
            {lastTime && !isEditing && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle animate-in fade-in">
                <History size={12} className="text-fg-faint" aria-hidden="true" />
                <span>Last time {formatCurrency(lastTime.amount)} · {lastTime.category}{lastTime.vendor_name ? ` · ${lastTime.vendor_name}` : ''}</span>
                {amount !== lastTime.amount && (
                  <LinkButton onClick={() => setFormData(prev => ({
                    ...prev,
                    amount: lastTime.amount,
                    paidAmount: prev.paymentStatus === 'Paid' ? lastTime.amount : prev.paymentStatus === 'Unpaid' ? 0 : Math.min(lastTime.amount, prev.paidAmount || 0),
                    vendor_id: prev.vendor_id || (expenseVendors.some(v => v.id === lastTime.vendor_id && v.isActive !== false) ? lastTime.vendor_id : prev.vendor_id),
                  }))}>
                    Use same amount
                  </LinkButton>
                )}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <FieldLabel aside={!isModalCreatingCat && <LinkButton onClick={() => setIsModalCreatingCat(true)}><Plus size={12} /> New</LinkButton>}>Category</FieldLabel>
              {isModalCreatingCat ? (
                <InlineCreate placeholder="New category name…" value={modalNewCatInput} onChange={setModalNewCatInput} onSave={createCategory} onCancel={() => setIsModalCreatingCat(false)} />
              ) : (
                <>
                  {quickCategories.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {quickCategories.map(name => (
                        <ChoiceChip key={name} selected={formData.category === name} onClick={() => setFormData(prev => ({ ...prev, category: name, subcategory: prev.category === name ? prev.subcategory : '' }))}>
                          <span className={cn('size-2 rounded-full', categoryTone(name).bar)} aria-hidden="true" />
                          {name}
                        </ChoiceChip>
                      ))}
                    </div>
                  )}
                  <RichSelect
                    options={categoryRichOptions}
                    value={formData.category || ''}
                    onChange={cat => setFormData(prev => ({ ...prev, category: cat, subcategory: '' }))}
                    placeholder="All categories…"
                    searchPlaceholder="Search category…"
                  />
                </>
              )}
            </div>

            {formData.category && (
              <div className="animate-in fade-in">
                <FieldLabel aside={!isModalCreatingSub && <LinkButton onClick={() => setIsModalCreatingSub(true)}><Plus size={12} /> New</LinkButton>}>
                  Sub-category <span className="font-medium text-fg-subtle">(optional)</span>
                </FieldLabel>
                {isModalCreatingSub ? (
                  <InlineCreate placeholder={`Sub-category under ${formData.category}…`} value={modalNewSubInput} onChange={setModalNewSubInput} onSave={createSubcategory} onCancel={() => setIsModalCreatingSub(false)} />
                ) : activeSubcategoryList.length <= 10 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <ChoiceChip selected={!formData.subcategory} onClick={() => setFormData(prev => ({ ...prev, subcategory: '' }))}>General</ChoiceChip>
                    {activeSubcategoryList.map(sub => (
                      <ChoiceChip key={sub.name} selected={formData.subcategory === sub.name} onClick={() => setFormData(prev => ({ ...prev, subcategory: sub.name }))}>
                        {sub.name}
                      </ChoiceChip>
                    ))}
                  </div>
                ) : (
                  <RichSelect
                    options={activeSubcategoryList.map(sub => ({ value: sub.name, label: sub.name }))}
                    value={formData.subcategory || ''}
                    onChange={sub => setFormData(prev => ({ ...prev, subcategory: sub }))}
                    placeholder="General"
                  />
                )}
              </div>
            )}
          </section>

          <section className={cn('grid gap-3', needsVendor && 'sm:grid-cols-2')}>
            <div>
              <FieldLabel htmlFor="expense-date" aside={
                <span className="flex gap-1">
                  {[{ label: 'Today', value: today }, { label: 'Yesterday', value: yesterday }].map(opt => (
                    <QuickPick key={opt.label} selected={formData.date === opt.value} onClick={() => setFormData(prev => ({ ...prev, date: opt.value }))}>
                      {opt.label}
                    </QuickPick>
                  ))}
                </span>
              }>Date</FieldLabel>
              <Input id="expense-date" type="date" required value={formData.date || ''} onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))} />
            </div>
            {needsVendor && (
              <div>
                <FieldLabel htmlFor="expense-due-date">Pay by <span className="font-medium text-fg-subtle">(optional)</span></FieldLabel>
                <Input id="expense-due-date" type="date" value={formData.dueDate || ''} min={formData.date} onChange={e => setFormData(prev => ({ ...prev, dueDate: e.target.value }))} />
              </div>
            )}
          </section>

          <section>
            <FieldLabel aside={!isModalCreatingVendor && <LinkButton onClick={() => setIsModalCreatingVendor(true)}><UserPlus size={12} /> New vendor</LinkButton>}>
              Vendor {needsVendor ? <span className="text-danger">*</span> : <span className="font-medium text-fg-subtle">(optional)</span>}
            </FieldLabel>
            {isModalCreatingVendor ? (
              <div className="flex flex-col gap-2 rounded-control border border-brand/25 bg-brand-soft/50 p-2.5 animate-in fade-in">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Vendor name" aria-label="Vendor ka naam" value={quickVendorName} onChange={e => setQuickVendorName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateVendor(); } }} autoFocus />
                  <Input type="tel" placeholder="Phone (optional)" aria-label="Vendor ka phone" value={quickVendorPhone} onChange={e => setQuickVendorPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateVendor(); } }} />
                </div>
                <div className="flex justify-end gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setIsModalCreatingVendor(false)} disabled={isCreatingQuickVendor}>Cancel</Button>
                  <Button size="sm" onClick={handleQuickCreateVendor} disabled={!quickVendorName.trim()} loading={isCreatingQuickVendor}>Add vendor</Button>
                </div>
              </div>
            ) : (
              <RichSelect
                options={[{ value: '', label: needsVendor ? 'Select vendor…' : 'No vendor (spot cash)' }, ...withChosenVendor(vendorRichOptions, expenseVendors, formData.vendor_id)]}
                value={formData.vendor_id || ''}
                onChange={id => setFormData(prev => ({ ...prev, vendor_id: id }))}
                placeholder={needsVendor ? 'Select vendor for khata…' : 'No vendor (spot cash)'}
                searchPlaceholder="Search vendor…"
              />
            )}
            {vendor && !isEditing && (
              <p className="mt-1.5 text-[11px] text-fg-subtle animate-in fade-in">
                Khata now <span className={cn('font-bold tabular-nums', vendorBalance > 0 ? 'text-danger-fg' : 'text-fg-muted')}>{formatCurrency(Math.abs(vendorBalance))} {vendorBalance > 0 ? 'to pay' : vendorBalance < 0 ? 'advance' : ''}</span>
                {due > 0 && <> → after this <span className="font-bold tabular-nums text-danger-fg">{formatCurrency(Math.abs(vendorBalance + due))} {vendorBalance + due > 0 ? 'to pay' : 'advance'}</span></>}
              </p>
            )}
            {needsVendor && !formData.vendor_id && !isModalCreatingVendor && (
              <p className="mt-1.5 text-[11px] font-semibold text-danger-fg">Baqi raqam ke liye vendor zaroori hai.</p>
            )}
          </section>

          {status !== 'Unpaid' && (
            <section className="flex flex-col gap-3 rounded-card border border-line bg-surface-2/60 p-3">
              <div className="grid gap-3">
                <div>
                  <FieldLabel>Paid by</FieldLabel>
                  <SegmentedControl
                    aria-label="Payment mode"
                    options={MODE_OPTIONS}
                    value={formData.paymentMode || 'Cash'}
                    onChange={mode => setFormData(prev => ({ ...prev, paymentMode: mode, account_id: defaultAccountFor(mode, accounts, settings) }))}
                    fullWidth
                  />
                </div>
                <div>
                  <FieldLabel>From account</FieldLabel>
                  <RichSelect
                    options={accountRichOptions}
                    value={formData.account_id || ''}
                    onChange={accId => setFormData(prev => ({ ...prev, account_id: accId }))}
                    placeholder="Select account…"
                    searchPlaceholder="Search account…"
                  />
                </div>
              </div>
              {selectedPaymentAccount && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-fg-subtle">{selectedPaymentAccount.name} balance</span>
                  <span className="font-semibold tabular-nums text-fg-muted">
                    {formatCurrency(selectedPaymentAccount.balance)}
                    {!isEditing && paidNow > 0 && (
                      <span className={cn('ml-1.5 font-bold', accountAfter < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>→ {formatCurrency(accountAfter)}</span>
                    )}
                  </span>
                </div>
              )}
              {!isEditing && paidNow > 0 && accountAfter < 0 && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-danger-fg"><AlertCircle size={12} aria-hidden="true" /> Account minus mein chala jayega.</p>
              )}
            </section>
          )}

          <section className="flex flex-col gap-2">
            {showNotes ? (
              <div className="animate-in fade-in">
                <FieldLabel htmlFor="expense-notes">Note</FieldLabel>
                <Textarea id="expense-notes" rows={2} className="min-h-0 resize-none" placeholder="Meter #, bill #, who received…" value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            ) : (
              <LinkButton onClick={() => setShowNotes(true)} className="self-start text-fg-subtle hover:text-fg"><StickyNote size={12} /> Add a note</LinkButton>
            )}

            {!isEditing && (
              <div className={cn('rounded-control border px-3 py-2.5 transition-colors', rememberExpense ? 'border-warning/40 bg-warning-soft/60' : 'border-line')}>
                <div className="flex items-center gap-2.5">
                  <Switch checked={rememberExpense} onChange={setRememberExpense} label="Save for next time" size="sm" />
                  <button type="button" onClick={() => setRememberExpense(!rememberExpense)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <span className="flex items-center gap-1 text-xs font-bold text-fg"><Bookmark size={12} className="text-warning" aria-hidden="true" /> Save for quick record</span>
                    <span className="block text-[10px] text-fg-subtle">Re-record this in one tap next time. Date will be the day you use it.</span>
                  </button>
                </div>
                {rememberExpense && (
                  <Input
                    inputSize="sm"
                    className="mt-2"
                    aria-label="Shortcut ka naam"
                    placeholder={formData.description || 'Shortcut name, e.g. Generator diesel'}
                    value={rememberName}
                    onChange={e => setRememberName(e.target.value)}
                  />
                )}
              </div>
            )}
          </section>
        </SheetBody>

        <SheetFooter>
          <div className="hidden min-w-0 flex-1 text-[11px] sm:block">
            {amount > 0 ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-semibold tabular-nums">
                <span className="flex items-center gap-1 text-success-fg"><span className="size-1.5 rounded-full bg-success" />Paid {formatCurrency(paidNow)}</span>
                {due > 0 && <span className="flex items-center gap-1 text-danger-fg"><span className="size-1.5 rounded-full bg-danger" />Khata {formatCurrency(due)}</span>}
              </span>
            ) : <span className="text-fg-subtle">Enter an amount to continue</span>}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            type="submit"
            disabled={isDateLocked}
            loading={isSubmitting}
            leftIcon={<Check />}
            title={isDateLocked ? `${formData.date} lock hai` : 'Ctrl+Enter'}
            className="flex-1 sm:flex-initial"
          >
            {isSubmitting ? 'Saving…' : submitLabel}
          </Button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};

interface SavedExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedExpenses: SavedExpense[];
  accounts: { id: string; name: string }[];
  onUse: (preset: SavedExpense) => void;
  onDelete: (id: string) => void;
}

export const SavedExpensesModal: React.FC<SavedExpensesModalProps> = ({ isOpen, onClose, savedExpenses, accounts, onUse, onDelete }) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return savedExpenses;
    return savedExpenses.filter(preset => [preset.name, preset.description, preset.category, preset.subcategory, preset.vendor_name, preset.paymentMode]
      .filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [query, savedExpenses]);

  if (!isOpen) return null;

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      size="md"
      icon={<SheetIcon icon={Bookmark} tone="warning" />}
      title="Quick record"
      subtitle="Tap one to open it filled in. Date stays today."
    >
      <div className="shrink-0 border-b border-line px-5 py-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search name, category or vendor"
          aria-label="Saved kharche search karein"
          data-autofocus
        />
      </div>
      <SheetBody className="flex flex-col gap-1.5 bg-surface-2/50">
        {savedExpenses.length === 0 ? (
          <div className="rounded-card border border-dashed border-line-strong bg-surface">
            <EmptyState
              size="compact"
              icon={<Bookmark />}
              title="No saved expenses yet"
              description="Turn on “Save for quick record” while recording, or bookmark an entry from the list."
            />
          </div>
        ) : matches.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-fg-subtle">No saved expense matches that search.</p>
        ) : (
          matches.map(preset => {
            const accountName = accounts.find(account => account.id === preset.account_id)?.name;
            return (
              <div key={preset.id} className="group flex items-stretch overflow-hidden rounded-control border border-line bg-surface shadow-e1 transition-shadow hover:shadow-e2">
                <button
                  type="button"
                  onClick={() => onUse(preset)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-brand-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <CategoryBadge name={preset.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-bold text-fg">{preset.name}</p>
                      <StatusPill status={preset.paymentStatus || 'Paid'} className="shrink-0" />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg-subtle">
                      {preset.category}{preset.subcategory ? ` › ${preset.subcategory}` : ''}
                      {preset.vendor_name ? ` · ${preset.vendor_name}` : ''}
                      {` · ${accountName || preset.paymentMode || 'Cash'}`}
                    </p>
                  </div>
                  <Money amount={Number(preset.amount || 0)} className="shrink-0 text-[13px] font-bold text-fg" />
                  <ChevronRight size={14} className="shrink-0 text-fg-faint group-hover:text-brand-fg" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Saved shortcut hatayen"
                  title="Remove"
                  onClick={() => onDelete(preset.id)}
                  className="shrink-0 cursor-pointer border-l border-line px-3 text-fg-faint transition-colors hover:bg-danger-soft hover:text-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </SheetBody>
      <SheetFooter className="justify-between">
        <span className="text-[11px] font-semibold text-fg-subtle">{savedExpenses.length} saved</span>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </SheetFooter>
    </Sheet>
  );
};

interface ExpenseVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  vendorFormData: Partial<ExpenseVendor>;
  setVendorFormData: React.Dispatch<React.SetStateAction<Partial<ExpenseVendor>>>;
  handleVendorSubmit: (e: React.FormEvent) => Promise<void>;
  isSubmittingVendor: boolean;
  editingVendor: ExpenseVendor | null;
}

export const ExpenseVendorModal: React.FC<ExpenseVendorModalProps> = ({
  isOpen, onClose, vendorFormData, setVendorFormData, handleVendorSubmit, isSubmittingVendor, editingVendor,
}) => {
  if (!isOpen) return null;

  const opening = vendorFormData.opening_balance || 0;
  const isAdvance = opening < 0;
  const set = (patch: Partial<ExpenseVendor>) => setVendorFormData(prev => ({ ...prev, ...patch }));

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      dismissible={!isSubmittingVendor}
      icon={<SheetIcon icon={editingVendor ? Users : UserPlus} />}
      title={editingVendor ? `Edit ${editingVendor.name}` : 'New vendor'}
      subtitle="Landlord, utility, diesel pump, packaging supplier or staff member"
    >
      <form onSubmit={handleVendorSubmit} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="flex flex-col gap-5">
          <section className="flex flex-col gap-3">
            <div>
              <FieldLabel htmlFor="vendor-name">Name <span className="text-danger">*</span></FieldLabel>
              <Input id="vendor-name" data-autofocus inputSize="lg" required placeholder="e.g. Shell Petrol Pump, Malik Sb" value={vendorFormData.name || ''} onChange={e => set({ name: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {SERVICE_TYPES.map(type => (
                  <ChoiceChip key={type} selected={(vendorFormData.service_type || 'Other') === type} onClick={() => set({ service_type: type })}>
                    {type}
                  </ChoiceChip>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="vendor-phone">Phone</FieldLabel>
              <Input id="vendor-phone" type="tel" placeholder="0300-1234567" value={vendorFormData.phone || ''} onChange={e => set({ phone: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="vendor-contact">Contact person</FieldLabel>
              <Input id="vendor-contact" placeholder="Manager / owner" value={vendorFormData.contact_person || ''} onChange={e => set({ contact_person: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="vendor-address">Address</FieldLabel>
              <Input id="vendor-address" placeholder="Shop, unit or area" value={vendorFormData.address || ''} onChange={e => set({ address: e.target.value })} />
            </div>
          </section>

          <section className="rounded-card border border-line bg-surface-2/60 p-3">
            <FieldLabel htmlFor="vendor-opening" aside={
              <SegmentedControl
                aria-label="Opening balance type"
                size="sm"
                value={isAdvance ? 'advance' : 'payable'}
                onChange={value => set({ opening_balance: value === 'advance' ? -Math.abs(opening) : Math.abs(opening) })}
                options={[
                  { value: 'payable', label: 'We owe', icon: <Dot className="bg-danger" /> },
                  { value: 'advance', label: 'Advance', icon: <Dot className="bg-success" /> },
                ]}
              />
            }>Opening balance</FieldLabel>
            <div className="relative">
              <RsPrefix size="sm" />
              <SmartNumberInput
                id="vendor-opening"
                className={cn(fieldClass, 'pl-10 tabular-nums', isAdvance ? 'text-success-fg' : opening > 0 ? 'text-danger-fg' : '')}
                placeholder="0"
                value={Math.abs(opening) || ''}
                onChange={val => {
                  const num = Math.abs(parseFloat(val) || 0);
                  set({ opening_balance: isAdvance ? -num : num });
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-fg-subtle">
              {isAdvance ? 'Vendor ke paas aap ka advance hai (aap ne lena hai).' : 'Purana baqi jo aap ne vendor ko dena hai.'}
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="vendor-bank"><span className="flex items-center gap-1"><Landmark size={12} className="text-fg-faint" aria-hidden="true" /> Bank</span></FieldLabel>
              <Input id="vendor-bank" placeholder="Meezan, HBL, JazzCash…" value={vendorFormData.bank_name || ''} onChange={e => set({ bank_name: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="vendor-account">Account # / IBAN</FieldLabel>
              <Input id="vendor-account" className="font-mono" placeholder="PK00MEZN…" value={vendorFormData.account_number || ''} onChange={e => set({ account_number: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="vendor-notes">Notes</FieldLabel>
              <Textarea id="vendor-notes" rows={2} className="min-h-0 resize-none" placeholder="Payment terms, meter #, contract date…" value={vendorFormData.notes || ''} onChange={e => set({ notes: e.target.value })} />
            </div>
          </section>

          <div className="flex items-center justify-between gap-3 rounded-control border border-line px-3 py-2.5">
            <button type="button" onClick={() => set({ isActive: vendorFormData.isActive === false })} className="min-w-0 flex-1 cursor-pointer text-left">
              <span className="block text-xs font-bold text-fg">Active</span>
              <span className="block text-[11px] text-fg-subtle">Inactive vendors are hidden from new expenses but keep their khata.</span>
            </button>
            <Switch checked={vendorFormData.isActive !== false} onChange={value => set({ isActive: value })} label="Active vendor" />
          </div>
        </SheetBody>

        <SheetFooter className="justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isSubmittingVendor}>Cancel</Button>
          <Button type="submit" loading={isSubmittingVendor} leftIcon={<Check />} className="flex-1 sm:flex-initial">
            {isSubmittingVendor ? 'Saving…' : editingVendor ? 'Save changes' : 'Add vendor'}
          </Button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};

interface PaymentForm {
  type: 'payment' | 'refund';
  vendor_id: string;
  amount: string | number;
  date: string;
  mode: string;
  account_id: string;
  reference_no: string;
  note: string;
}

interface VendorPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentFormData: PaymentForm;
  setPaymentFormData: React.Dispatch<React.SetStateAction<PaymentForm>>;
  handlePaymentSubmit: (e: React.FormEvent) => Promise<void>;
  isSubmittingPayment: boolean;
  expenseVendors: ExpenseVendor[];
  vendorRichOptions: RichSelectOption[];
  accountRichOptions: RichSelectOption[];
  selectedDirectPaymentAccount: any;
  setSelectedPaymentVendor: (v: ExpenseVendor | null) => void;
  accounts: any[];
  settings: any;
}

export const VendorPaymentModal: React.FC<VendorPaymentModalProps> = ({
  isOpen, onClose, paymentFormData, setPaymentFormData, handlePaymentSubmit, isSubmittingPayment, expenseVendors,
  vendorRichOptions, accountRichOptions, selectedDirectPaymentAccount, setSelectedPaymentVendor, accounts, settings,
}) => {
  const { isDayLocked } = useDairy();
  if (!isOpen) return null;

  const isLocked = Boolean(isDayLocked && paymentFormData.date && isDayLocked(paymentFormData.date));
  const isRefund = paymentFormData.type === 'refund';
  const amount = parseFloat(String(paymentFormData.amount)) || 0;
  const vendor = expenseVendors.find(v => v.id === paymentFormData.vendor_id);
  const bal = vendor?.pending_balance || 0;
  const balAfter = isRefund ? bal + amount : bal - amount;
  const accountAfter = selectedDirectPaymentAccount ? selectedDirectPaymentAccount.balance + (isRefund ? amount : -amount) : 0;
  const today = pkToday();
  const set = (patch: Partial<PaymentForm>) => setPaymentFormData(prev => ({ ...prev, ...patch }));

  const quickAmounts: { label: string; value: number }[] = [];
  if (!isRefund && bal > 0) quickAmounts.push({ label: `Full ${formatCurrency(bal)}`, value: bal }, { label: 'Half', value: Math.round(bal / 2) });
  if (isRefund && bal < 0) quickAmounts.push({ label: `Full ${formatCurrency(Math.abs(bal))}`, value: Math.abs(bal) });

  const describe = (value: number) => (value > 0 ? `${formatCurrency(value)} to pay` : value < 0 ? `${formatCurrency(Math.abs(value))} advance` : 'Settled');
  const balanceTone = (value: number, settledTone = 'text-fg-subtle') => (value > 0 ? 'text-danger-fg' : value < 0 ? 'text-success-fg' : settledTone);

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      size="md"
      dismissible={!isSubmittingPayment}
      icon={<SheetIcon icon={isRefund ? ArrowDownLeft : ArrowUpRight} tone={isRefund ? 'info' : 'success'} />}
      title={isRefund ? 'Receive from vendor' : 'Pay vendor'}
      subtitle={isRefund ? 'Advance returned, refund or overpayment back' : 'Clear dues, pay salary or give an advance'}
    >
      <form onSubmit={handlePaymentSubmit} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="flex flex-col gap-4">
          {isLocked && <LockedBanner date={paymentFormData.date} what="payment" />}

          <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
            <OptionCard selected={!isRefund} onClick={() => set({ type: 'payment' })} tone="success" icon={ArrowUpRight} label="Pay" hint="Money goes out" />
            <OptionCard selected={isRefund} onClick={() => set({ type: 'refund' })} tone="info" icon={ArrowDownLeft} label="Receive" hint="Money comes back" />
          </div>

          <div>
            <FieldLabel>Vendor <span className="text-danger">*</span></FieldLabel>
            <RichSelect
              options={withChosenVendor(vendorRichOptions, expenseVendors, paymentFormData.vendor_id)}
              value={paymentFormData.vendor_id}
              onChange={vId => {
                const found = expenseVendors.find(v => v.id === vId) || null;
                setSelectedPaymentVendor(found);
                const nextBal = found?.pending_balance || 0;
                setPaymentFormData(prev => ({
                  ...prev,
                  vendor_id: vId,
                  amount: nextBal !== 0 ? Math.abs(nextBal) : prev.amount,
                  type: nextBal < 0 ? 'refund' : nextBal > 0 ? 'payment' : prev.type,
                }));
              }}
              placeholder="Select vendor…"
              searchPlaceholder="Search vendor…"
            />
            {vendor && (
              <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-control border border-line bg-line text-[11px] animate-in fade-in">
                <div className="bg-surface px-3 py-2">
                  <p className="font-semibold text-fg-subtle">Khata now</p>
                  <p className={cn('text-xs font-bold tabular-nums', balanceTone(bal))}>{describe(bal)}</p>
                </div>
                <div className="bg-surface px-3 py-2">
                  <p className="font-semibold text-fg-subtle">After this</p>
                  <p className={cn('text-xs font-bold tabular-nums', balanceTone(balAfter, 'text-success-fg'))}>{amount > 0 ? describe(balAfter) : '—'}</p>
                </div>
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="payment-amount" aside={quickAmounts.length > 0 && (
              <span className="flex gap-1">
                {quickAmounts.map(q => (
                  <QuickPick key={q.label} selected={amount === q.value} onClick={() => set({ amount: q.value })}>{q.label}</QuickPick>
                ))}
              </span>
            )}>{isRefund ? 'Amount received' : 'Amount'}</FieldLabel>
            <div className="relative">
              <RsPrefix />
              <SmartNumberInput
                id="payment-amount"
                data-autofocus
                className={cn(amountClass, isRefund ? 'text-info-fg' : 'text-success-fg')}
                placeholder="0"
                required
                value={paymentFormData.amount}
                onChange={val => set({ amount: val })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface-2/60 p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <FieldLabel htmlFor="payment-date" aside={
                  <QuickPick selected={paymentFormData.date === today} onClick={() => set({ date: today })}>Today</QuickPick>
                }>Date</FieldLabel>
                <Input id="payment-date" type="date" value={paymentFormData.date} onChange={e => set({ date: e.target.value })} required />
              </div>
              <div>
                <FieldLabel>Mode</FieldLabel>
                <SegmentedControl
                  aria-label="Payment mode"
                  options={MODE_OPTIONS}
                  value={paymentFormData.mode}
                  onChange={mode => set({ mode, account_id: defaultAccountFor(mode, accounts, settings) })}
                  className="w-full sm:w-fit"
                />
              </div>
            </div>
            <div>
              <FieldLabel>{isRefund ? 'Into account' : 'From account'} <span className="text-danger">*</span></FieldLabel>
              <RichSelect options={accountRichOptions} value={paymentFormData.account_id} onChange={accId => set({ account_id: accId })} placeholder="Select account…" searchPlaceholder="Search account…" />
            </div>
            {selectedDirectPaymentAccount && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-subtle">{selectedDirectPaymentAccount.name} balance</span>
                <span className="font-semibold tabular-nums text-fg-muted">
                  {formatCurrency(selectedDirectPaymentAccount.balance)}
                  {amount > 0 && <span className={cn('ml-1.5 font-bold', accountAfter < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>→ {formatCurrency(accountAfter)}</span>}
                </span>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="payment-ref">Ref / cheque # <span className="font-medium text-fg-subtle">(optional)</span></FieldLabel>
              <Input id="payment-ref" placeholder="Tx ID / receipt #" value={paymentFormData.reference_no} onChange={e => set({ reference_no: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="payment-note">Note</FieldLabel>
              <Input id="payment-note" placeholder={isRefund ? 'Advance returned…' : 'Salary, rent, advance…'} value={paymentFormData.note} onChange={e => set({ note: e.target.value })} />
            </div>
          </div>
        </SheetBody>

        <SheetFooter className="justify-end">
          <Button variant="ghost" onClick={onClose} disabled={isSubmittingPayment}>Cancel</Button>
          <Button
            type="submit"
            disabled={isLocked}
            loading={isSubmittingPayment}
            leftIcon={isRefund ? <ArrowDownLeft /> : <ArrowUpRight />}
            title={isLocked ? `${paymentFormData.date} lock hai` : 'Ctrl+Enter'}
            className="flex-1 sm:flex-initial"
          >
            {isSubmittingPayment ? 'Saving…' : `${isRefund ? 'Receive' : 'Pay'} ${amount > 0 ? formatCurrency(amount) : ''}`.trim()}
          </Button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};
