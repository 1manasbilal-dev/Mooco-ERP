import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderTree, Plus, Search, X, ChevronDown, ChevronRight, Edit, Check, Lock, Trash2, AlertCircle,
  Loader2, Users, Building, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, Bookmark, Receipt,
  CheckCircle2, CircleDashed, Clock3, History, StickyNote, Landmark, UserPlus,
} from 'lucide-react';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { CategoryStructure, SubcategoryStructure, SERVICE_TYPES } from './ExpenseTypes';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { SmartNumberInput } from '../SmartNumberInput';
import { useDairy } from '../../context/DairyContext';
import { formatCurrency } from '../../lib/formatters';
import { offsetDate } from '../../lib/dashboardAnalytics';
import { PillGroup, SettlementBar } from '../procurement/ProcurementUI';
import {
  CategoryBadge, ChoiceChip, FieldLabel, LinkButton, Sheet, SheetBody, SheetFooter, SheetIcon, StatusPill, Switch,
  categoryTone, dayKey, fieldClass, pkToday,
} from './ExpenseUI';

const MODE_OPTIONS = [
  { value: 'Cash', label: 'Cash', icon: <Wallet size={13} /> },
  { value: 'Online', label: 'Online', icon: <CreditCard size={13} /> },
  { value: 'Bank Transfer', label: 'Bank', icon: <Building size={13} /> },
];

/** Default account for a payment mode: the configured cash or digital account, else the first match. */
const defaultAccountFor = (mode: string, accounts: any[], settings: any) => (
  mode === 'Cash'
    ? settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || ''
    : settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || ''
);

const submitOnCtrlEnter = (event: React.KeyboardEvent<HTMLFormElement>) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    // requestSubmit() ignores a disabled Save button (locked date / already saving).
    const submitButton = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitButton?.disabled) return;
    event.currentTarget.requestSubmit();
  }
};

const LockedBanner: React.FC<{ date?: string; what: string }> = ({ date, what }) => (
  <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="alert">
    <Lock size={15} className="mt-0.5 shrink-0 text-amber-600" />
    <span><strong>{date} band ho chuka hai.</strong> Lock din par {what} record nahi ho sakta — date badlein.</span>
  </div>
);

const InlineCreate: React.FC<{
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}> = ({ placeholder, value, onChange, onSave, onCancel }) => (
  <div className="flex gap-1.5 animate-in fade-in">
    <input
      type="text"
      className={`${fieldClass} h-9 border-lime-400 text-xs`}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); onSave(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      autoFocus
    />
    <button type="button" onClick={onSave} disabled={!value.trim()} className="h-9 shrink-0 rounded-xl bg-lime-600 px-3 text-xs font-bold text-white hover:bg-lime-700 disabled:opacity-40">Save</button>
    <button type="button" aria-label="Cancel" onClick={onCancel} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
  </div>
);

// ==========================================
// 1. CATEGORY & SUBCATEGORY MANAGER
// ==========================================
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
  handleModalAddCategory: (e: React.FormEvent) => Promise<void>;
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
      <div className="shrink-0 space-y-2 border-b border-slate-100 px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="search"
              placeholder="Search categories or sub-categories…"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500 focus:bg-white"
              value={categorySearch}
              onChange={e => setCategorySearch(e.target.value)}
            />
          </div>
          <PillGroup
            label="Category status"
            size="sm"
            value={modalCatFilter}
            onChange={setModalCatFilter}
            options={[
              { value: 'all', label: `All ${categoryTree.length}` },
              { value: 'active', label: `Active ${activeCount}`, dot: 'bg-emerald-500' },
              { value: 'inactive', label: `Off ${categoryTree.length - activeCount}`, dot: 'bg-slate-400' },
            ]}
          />
          <button type="button" onClick={() => setIsModalCreatingMainCat(!isModalCreatingMainCat)} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-lime-600 px-3 text-xs font-bold text-white hover:bg-lime-700">
            <Plus size={14} /> New category
          </button>
        </div>
        {isModalCreatingMainCat && (
          <form
            onSubmit={async e => { await handleModalAddCategory(e); setIsModalCreatingMainCat(false); }}
            className="flex flex-col gap-2 rounded-xl border border-lime-200 bg-lime-50/70 p-2.5 sm:flex-row animate-in fade-in"
          >
            <input
              type="text"
              className={`${fieldClass} h-9 text-xs`}
              placeholder="Category name, e.g. Animal Feed, Veterinary"
              value={modalNewCategoryName}
              onChange={e => setModalNewCategoryName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => { setIsModalCreatingMainCat(false); setModalNewCategoryName(''); }} className="h-9 px-3 text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
              <button type="submit" disabled={!modalNewCategoryName.trim()} className="h-9 rounded-xl bg-lime-600 px-4 text-xs font-bold text-white hover:bg-lime-700 disabled:opacity-50">Save</button>
            </div>
          </form>
        )}
      </div>

      <SheetBody className="space-y-2 bg-slate-50/50">
        {filteredCategories.map(cat => {
          const isExpanded = expandedCatsInModal[cat.name] ?? Boolean(needle);
          const usageCount = getCategoryUsageCount(cat.name);
          const isLocked = usageCount > 0;
          const isEditing = editingCatName === cat.name;

          return (
            <div key={cat.name} className={`overflow-hidden rounded-2xl border bg-white transition-all ${cat.isActive ? 'border-slate-200' : 'border-slate-200 opacity-70'}`}>
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <button
                  type="button"
                  aria-label={isExpanded ? 'Band karein' : 'Kholein'}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedCatsInModal(prev => ({ ...prev, [cat.name]: !isExpanded }))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <CategoryBadge name={cat.name} size="sm" />

                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <input
                      type="text"
                      className={`${fieldClass} h-8 text-xs`}
                      value={editCatInput}
                      onChange={e => setEditCatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveEditCategory(cat);
                        if (e.key === 'Escape') { e.preventDefault(); setEditingCatName(null); }
                      }}
                      autoFocus
                    />
                    <button type="button" aria-label="Naam save karein" onClick={() => handleSaveEditCategory(cat)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-lime-600 text-white hover:bg-lime-700"><Check size={14} /></button>
                    <button type="button" aria-label="Cancel" onClick={() => setEditingCatName(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={14} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setExpandedCatsInModal(prev => ({ ...prev, [cat.name]: !isExpanded }))} className="min-w-0 flex-1 text-left">
                    <span className={`block truncate text-sm font-bold ${cat.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{cat.name}</span>
                    <span className="block text-[11px] text-slate-400">{cat.subcategories.length} sub-categories{isLocked ? ` · ${usageCount} entries` : ''}</span>
                  </button>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {isLocked && <span title={`${usageCount} entries — delete locked`} className="hidden items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 sm:flex"><Lock size={10} />{usageCount}</span>}
                  {!isEditing && (
                    <button type="button" aria-label="Naam badlein" title="Rename" onClick={() => handleStartEditCategory(cat)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit size={13} /></button>
                  )}
                  <Switch checked={cat.isActive} onChange={() => handleToggleCategoryActive(cat)} label={cat.isActive ? 'Category band karein' : 'Category chalu karein'} />
                  <button
                    type="button"
                    aria-label={isLocked ? 'Entries wali category delete nahi ho sakti' : 'Category delete karein'}
                    title={isLocked ? 'Has entries — cannot delete' : 'Delete'}
                    onClick={() => handleDeleteCategory(cat)}
                    disabled={isLocked}
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-slate-200 disabled:hover:bg-transparent"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-1 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 pl-12">
                  {cat.subcategories.map(sub => {
                    const subUsage = getSubcategoryUsageCount(cat.name, sub.name);
                    const isSubLocked = subUsage > 0;
                    const isSubEditing = editingSubcatKey === `${cat.name}::${sub.name}`;
                    return (
                      <div key={sub.name} className={`flex items-center gap-2 rounded-xl border bg-white px-2.5 py-1.5 text-xs ${sub.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${categoryTone(cat.name).bar}`} />
                        {isSubEditing ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <input
                              type="text"
                              className={`${fieldClass} h-7 text-xs`}
                              value={editSubcatInput}
                              onChange={e => setEditSubcatInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveEditSubcategory(cat.name, sub);
                                if (e.key === 'Escape') { e.preventDefault(); setEditingSubcatKey(null); }
                              }}
                              autoFocus
                            />
                            <button type="button" aria-label="Save" onClick={() => handleSaveEditSubcategory(cat.name, sub)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-lime-600 text-white"><Check size={12} /></button>
                            <button type="button" aria-label="Cancel" onClick={() => setEditingSubcatKey(null)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={12} /></button>
                          </div>
                        ) : (
                          <span className={`min-w-0 flex-1 truncate font-semibold ${sub.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{sub.name}</span>
                        )}
                        {isSubLocked && <span className="flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700"><Lock size={8} />{subUsage}</span>}
                        {!isSubEditing && (
                          <button type="button" aria-label="Naam badlein" title="Rename" onClick={() => handleStartEditSubcategory(cat.name, sub)} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit size={11} /></button>
                        )}
                        <Switch size="sm" checked={sub.isActive} onChange={() => handleToggleSubcategoryActive(cat.name, sub)} label={sub.isActive ? 'Band karein' : 'Chalu karein'} />
                        <button
                          type="button"
                          aria-label={isSubLocked ? 'Entries wali sub-category delete nahi ho sakti' : 'Sub-category delete karein'}
                          onClick={() => handleDeleteSubcategory(cat.name, sub)}
                          disabled={isSubLocked}
                          className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-slate-200"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      className={`${fieldClass} h-8 text-xs`}
                      placeholder={`Add sub-category under ${cat.name}…`}
                      value={newSubcatInputs[cat.name] || ''}
                      onChange={e => setNewSubcatInputs({ ...newSubcatInputs, [cat.name]: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleModalAddSubcat(cat.name); } }}
                    />
                    <button type="button" disabled={!newSubcatInputs[cat.name]?.trim()} onClick={() => handleModalAddSubcat(cat.name)} className="h-8 shrink-0 rounded-xl bg-lime-600 px-3 text-xs font-bold text-white hover:bg-lime-700 disabled:opacity-40">
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filteredCategories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
            <FolderTree size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-bold text-slate-600">No categories found</p>
            <p className="mt-0.5 text-[11px] text-slate-400">Try another word or create a new category.</p>
          </div>
        )}
      </SheetBody>

      <SheetFooter className="justify-between">
        <span className="text-xs text-slate-500"><strong className="text-slate-800">{categoryTree.length}</strong> categories · <span className="font-bold text-emerald-700">{activeCount} active</span></span>
        <button type="button" onClick={onClose} className="h-9 rounded-xl bg-slate-900 px-5 text-xs font-bold text-white hover:bg-slate-800">Done</button>
      </SheetFooter>
    </Sheet>
  );
};

// ==========================================
// 2. RECORD / EDIT EXPENSE
// ==========================================
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
  accounts: any[];
  settings: any;
  rememberExpense: boolean;
  setRememberExpense: (value: boolean) => void;
  rememberName: string;
  setRememberName: (value: string) => void;
}

const STATUS_CARDS: { value: 'Paid' | 'Partial' | 'Unpaid'; label: string; hint: string; icon: React.ElementType; on: string }[] = [
  { value: 'Paid', label: 'Paid now', hint: 'Full amount paid', icon: CheckCircle2, on: 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-emerald-500/15' },
  { value: 'Partial', label: 'Partial', hint: 'Some now, rest khata', icon: CircleDashed, on: 'border-amber-500 bg-amber-50 text-amber-800 ring-amber-500/15' },
  { value: 'Unpaid', label: 'On credit', hint: 'Add to vendor khata', icon: Clock3, on: 'border-rose-500 bg-rose-50 text-rose-800 ring-rose-500/15' },
];

export const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({
  isOpen, onClose, isEditing = false, formData, setFormData, handleSubmitExpense, isSubmitting,
  categoryRichOptions, activeSubcategoryList, vendorRichOptions, accountRichOptions, selectedPaymentAccount,
  isModalCreatingCat, setIsModalCreatingCat, modalNewCatInput, setModalNewCatInput, handleCreateMainCategory,
  isModalCreatingSub, setIsModalCreatingSub, modalNewSubInput, setModalNewSubInput, handleCreateSubcategory,
  isModalCreatingVendor, setIsModalCreatingVendor, quickVendorName, setQuickVendorName, quickVendorPhone,
  setQuickVendorPhone, handleQuickCreateVendor, accounts, settings, rememberExpense, setRememberExpense,
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
    setFormData(prev => ({
      ...prev,
      paymentStatus: next,
      paidAmount: next === 'Paid' ? (prev.amount || 0) : next === 'Unpaid' ? 0 : (prev.paidAmount || 0),
    }));
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
      accent="from-rose-50/70"
      icon={<SheetIcon icon={Receipt} tone="bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-rose-600/25" />}
      title={isEditing ? 'Edit expense' : 'Record expense'}
      subtitle={isEditing ? 'Changes adjust the account and vendor khata automatically.' : 'Cash, bank or on-credit vendor bill · Ctrl+Enter to save'}
    >
      <form onSubmit={handleSubmitExpense} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          {isDateLocked && <LockedBanner date={formData.date} what="kharcha" />}

          {/* Amount + status */}
          <section className="space-y-3">
            <div>
              <FieldLabel htmlFor="expense-amount">Amount</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-lg font-black text-slate-300">Rs</span>
                <SmartNumberInput
                  id="expense-amount"
                  data-autofocus
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 font-mono text-2xl font-black tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-lime-500 focus:ring-4 focus:ring-lime-500/10"
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
              <p className="mt-1 text-[11px] text-slate-400">Math works too: 1200+350 or 45*20</p>
            </div>

            <div role="radiogroup" aria-label="Payment status" className="grid grid-cols-3 gap-2">
              {STATUS_CARDS.map(card => {
                const selected = status === card.value;
                const Icon = card.icon;
                return (
                  <button
                    key={card.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setStatus(card.value)}
                    className={`rounded-xl border px-2.5 py-2 text-left transition-all ${selected ? `${card.on} ring-4` : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-bold"><Icon size={14} />{card.label}</span>
                    <span className="mt-0.5 hidden text-[10px] font-medium opacity-75 sm:block">{card.hint}</span>
                  </button>
                );
              })}
            </div>

            {status === 'Partial' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 animate-in fade-in">
                <FieldLabel htmlFor="expense-paid-now" aside={<span className="text-[11px] font-bold text-rose-600">Khata: {formatCurrency(due)}</span>}>Paid now</FieldLabel>
                <SmartNumberInput
                  id="expense-paid-now"
                  max={amount}
                  className={`${fieldClass} font-mono text-emerald-700`}
                  placeholder="Amount paid today"
                  value={formData.paidAmount || ''}
                  onChange={val => setFormData(prev => ({ ...prev, paidAmount: parseFloat(val) || 0 }))}
                />
                {amount > 0 && <div className="mt-2.5"><SettlementBar total={amount} paid={paidNow} formatMoney={formatCurrency} /></div>}
              </div>
            )}
            {status === 'Unpaid' && amount > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-[11px] text-rose-800 animate-in fade-in">
                <AlertCircle size={14} className="mt-px shrink-0" />
                No cash leaves today. {formatCurrency(amount)} goes on the vendor&apos;s khata.
              </p>
            )}
          </section>

          {/* Description */}
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
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 animate-in fade-in">
                <History size={12} className="text-slate-400" />
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

          {/* Category */}
          <section className="space-y-3">
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
                          <span className={`h-2 w-2 rounded-full ${categoryTone(name).bar}`} />
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
                  Sub-category <span className="font-medium text-slate-400">(optional)</span>
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

          {/* Date */}
          <section className={`grid gap-3 ${needsVendor ? 'sm:grid-cols-2' : ''}`}>
            <div>
              <FieldLabel htmlFor="expense-date" aside={
                <span className="flex gap-1">
                  {[{ label: 'Today', value: today }, { label: 'Yesterday', value: yesterday }].map(opt => (
                    <button key={opt.label} type="button" onClick={() => setFormData(prev => ({ ...prev, date: opt.value }))} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${formData.date === opt.value ? 'bg-lime-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-800'}`}>
                      {opt.label}
                    </button>
                  ))}
                </span>
              }>Date</FieldLabel>
              <input id="expense-date" type="date" className={fieldClass} value={formData.date || ''} onChange={e => setFormData(prev => ({ ...prev, date: e.target.value }))} />
            </div>
            {needsVendor && (
              <div>
                <FieldLabel htmlFor="expense-due-date">Pay by <span className="font-medium text-slate-400">(optional)</span></FieldLabel>
                <input id="expense-due-date" type="date" className={fieldClass} value={formData.dueDate || ''} min={formData.date} onChange={e => setFormData(prev => ({ ...prev, dueDate: e.target.value }))} />
              </div>
            )}
          </section>

          {/* Vendor */}
          <section>
            <FieldLabel aside={!isModalCreatingVendor && <LinkButton onClick={() => setIsModalCreatingVendor(true)}><UserPlus size={12} /> New vendor</LinkButton>}>
              Vendor {needsVendor ? <span className="text-rose-500">*</span> : <span className="font-medium text-slate-400">(optional)</span>}
            </FieldLabel>
            {isModalCreatingVendor ? (
              <div className="space-y-2 rounded-xl border border-lime-200 bg-lime-50/50 p-2.5 animate-in fade-in">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input type="text" placeholder="Vendor name" className={`${fieldClass} h-9 text-xs`} value={quickVendorName} onChange={e => setQuickVendorName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateVendor(); } }} autoFocus />
                  <input type="tel" placeholder="Phone (optional)" className={`${fieldClass} h-9 text-xs`} value={quickVendorPhone} onChange={e => setQuickVendorPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQuickCreateVendor(); } }} />
                </div>
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setIsModalCreatingVendor(false)} className="h-8 px-3 text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
                  <button type="button" onClick={handleQuickCreateVendor} disabled={!quickVendorName.trim()} className="h-8 rounded-xl bg-lime-600 px-3 text-xs font-bold text-white hover:bg-lime-700 disabled:opacity-40">Add vendor</button>
                </div>
              </div>
            ) : (
              <RichSelect
                options={[{ value: '', label: needsVendor ? 'Select vendor…' : 'No vendor (spot cash)' }, ...vendorRichOptions]}
                value={formData.vendor_id || ''}
                onChange={id => setFormData(prev => ({ ...prev, vendor_id: id }))}
                placeholder={needsVendor ? 'Select vendor for khata…' : 'No vendor (spot cash)'}
                searchPlaceholder="Search vendor…"
              />
            )}
            {vendor && !isEditing && (
              <p className="mt-1.5 text-[11px] text-slate-500 animate-in fade-in">
                Khata now <span className={`font-bold ${vendorBalance > 0 ? 'text-rose-600' : 'text-slate-700'}`}>{formatCurrency(Math.abs(vendorBalance))} {vendorBalance > 0 ? 'to pay' : vendorBalance < 0 ? 'advance' : ''}</span>
                {due > 0 && <> → after this <span className="font-bold text-rose-600">{formatCurrency(Math.abs(vendorBalance + due))} {vendorBalance + due > 0 ? 'to pay' : 'advance'}</span></>}
              </p>
            )}
            {needsVendor && !formData.vendor_id && !isModalCreatingVendor && (
              <p className="mt-1.5 text-[11px] font-semibold text-rose-600">Baqi raqam ke liye vendor zaroori hai.</p>
            )}
          </section>

          {/* Payment */}
          {status !== 'Unpaid' && (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="grid gap-3">
                <div>
                  <FieldLabel>Paid by</FieldLabel>
                  <PillGroup
                    label="Payment mode"
                    options={MODE_OPTIONS}
                    value={formData.paymentMode || 'Cash'}
                    onChange={mode => setFormData(prev => ({ ...prev, paymentMode: mode, account_id: defaultAccountFor(mode, accounts, settings) }))}
                    className="bg-white"
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
                  <span className="text-slate-500">{selectedPaymentAccount.name} balance</span>
                  <span className="font-mono font-semibold text-slate-700">
                    {formatCurrency(selectedPaymentAccount.balance)}
                    {!isEditing && paidNow > 0 && (
                      <span className={`ml-1.5 font-bold ${accountAfter < 0 ? 'text-rose-600' : 'text-slate-500'}`}>→ {formatCurrency(accountAfter)}</span>
                    )}
                  </span>
                </div>
              )}
              {!isEditing && paidNow > 0 && accountAfter < 0 && (
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-600"><AlertCircle size={12} /> Account minus mein chala jayega.</p>
              )}
            </section>
          )}

          {/* Notes + save for later */}
          <section className="space-y-2">
            {showNotes ? (
              <div className="animate-in fade-in">
                <FieldLabel htmlFor="expense-notes">Note</FieldLabel>
                <textarea id="expense-notes" rows={2} className={`${fieldClass} h-auto resize-none py-2`} placeholder="Meter #, bill #, who received…" value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} />
              </div>
            ) : (
              <LinkButton onClick={() => setShowNotes(true)} className="text-slate-500 hover:text-slate-800"><StickyNote size={12} /> Add a note</LinkButton>
            )}

            {!isEditing && (
              <div className={`rounded-xl border px-3 py-2.5 transition-colors ${rememberExpense ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200'}`}>
                <label className="flex cursor-pointer items-center gap-2.5">
                  <Switch checked={rememberExpense} onChange={setRememberExpense} label="Save for next time" size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-xs font-bold text-slate-800"><Bookmark size={12} className="text-amber-500" /> Save for quick record</span>
                    <span className="block text-[10px] text-slate-500">Re-record this in one tap next time. Date will be the day you use it.</span>
                  </span>
                </label>
                {rememberExpense && (
                  <input
                    type="text"
                    className={`${fieldClass} mt-2 h-9 text-xs`}
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
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-semibold">
                <span className="flex items-center gap-1 text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Paid {formatCurrency(paidNow)}</span>
                {due > 0 && <span className="flex items-center gap-1 text-rose-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />Khata {formatCurrency(due)}</span>}
              </span>
            ) : <span className="text-slate-400">Enter an amount to continue</span>}
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="h-10 rounded-xl px-4 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button
            type="submit"
            disabled={isSubmitting || isDateLocked}
            title={isDateLocked ? `${formData.date} lock hai` : 'Ctrl+Enter'}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-lime-600 px-5 text-xs font-bold text-white shadow-md shadow-lime-600/25 transition-all hover:bg-lime-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none sm:flex-initial"
          >
            {isSubmitting ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> {submitLabel}</>}
          </button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};

// ==========================================
// 2b. SAVED EXPENSES PICKER
// ==========================================
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
      accent="from-amber-50/70"
      icon={<SheetIcon icon={Bookmark} tone="bg-amber-500 text-white shadow-amber-500/25" />}
      title="Quick record"
      subtitle="Tap one to open it filled in. Date stays today."
    >
      <div className="shrink-0 border-b border-slate-100 px-5 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search name, category or vendor"
            data-autofocus
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500 focus:bg-white"
          />
        </div>
      </div>
      <SheetBody className="space-y-1.5 bg-slate-50/50">
        {savedExpenses.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
            <Bookmark size={26} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-bold text-slate-700">No saved expenses yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Turn on “Save for quick record” while recording, or bookmark an entry from the list.</p>
          </div>
        ) : matches.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">No saved expense matches that search.</p>
        ) : (
          matches.map(preset => {
            const accountName = accounts.find(account => account.id === preset.account_id)?.name;
            return (
              <div key={preset.id} className="group flex items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow hover:shadow-sm">
                <button type="button" onClick={() => onUse(preset)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-lime-50/50">
                  <CategoryBadge name={preset.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[13px] font-bold text-slate-900">{preset.name}</p>
                      <StatusPill status={preset.paymentStatus || 'Paid'} className="shrink-0" />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {preset.category}{preset.subcategory ? ` › ${preset.subcategory}` : ''}
                      {preset.vendor_name ? ` · ${preset.vendor_name}` : ''}
                      {` · ${accountName || preset.paymentMode || 'Cash'}`}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[13px] font-black text-slate-900">{formatCurrency(Number(preset.amount || 0))}</span>
                  <ChevronRight size={14} className="shrink-0 text-slate-300 group-hover:text-lime-600" />
                </button>
                <button type="button" aria-label="Saved shortcut hatayen" title="Remove" onClick={() => onDelete(preset.id)} className="shrink-0 border-l border-slate-100 px-3 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })
        )}
      </SheetBody>
      <SheetFooter className="justify-between">
        <span className="text-[11px] font-semibold text-slate-500">{savedExpenses.length} saved</span>
        <button type="button" onClick={onClose} className="h-9 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800">Close</button>
      </SheetFooter>
    </Sheet>
  );
};

// ==========================================
// 3. ADD / EDIT VENDOR
// ==========================================
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
      accent="from-lime-50/70"
      icon={<SheetIcon icon={editingVendor ? Users : UserPlus} />}
      title={editingVendor ? `Edit ${editingVendor.name}` : 'New vendor'}
      subtitle="Landlord, utility, diesel pump, packaging supplier or staff member"
    >
      <form onSubmit={handleVendorSubmit} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-5">
          <section className="space-y-3">
            <div>
              <FieldLabel htmlFor="vendor-name">Name <span className="text-rose-500">*</span></FieldLabel>
              <input id="vendor-name" data-autofocus type="text" className={`${fieldClass} h-11 text-base`} required placeholder="e.g. Shell Petrol Pump, Malik Sb" value={vendorFormData.name || ''} onChange={e => set({ name: e.target.value })} />
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
              <input id="vendor-phone" type="tel" className={fieldClass} placeholder="0300-1234567" value={vendorFormData.phone || ''} onChange={e => set({ phone: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="vendor-contact">Contact person</FieldLabel>
              <input id="vendor-contact" type="text" className={fieldClass} placeholder="Manager / owner" value={vendorFormData.contact_person || ''} onChange={e => set({ contact_person: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="vendor-address">Address</FieldLabel>
              <input id="vendor-address" type="text" className={fieldClass} placeholder="Shop, unit or area" value={vendorFormData.address || ''} onChange={e => set({ address: e.target.value })} />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            <FieldLabel aside={
              <PillGroup
                label="Opening balance type"
                size="sm"
                value={isAdvance ? 'advance' : 'payable'}
                onChange={value => set({ opening_balance: value === 'advance' ? -Math.abs(opening) : Math.abs(opening) })}
                options={[{ value: 'payable', label: 'We owe', dot: 'bg-rose-500' }, { value: 'advance', label: 'Advance', dot: 'bg-sky-500' }]}
                className="bg-white"
              />
            }>Opening balance</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-black text-slate-300">Rs</span>
              <SmartNumberInput
                className={`${fieldClass} pl-10 font-mono ${isAdvance ? 'text-sky-700' : opening > 0 ? 'text-rose-600' : ''}`}
                placeholder="0"
                value={Math.abs(opening) || ''}
                onChange={val => {
                  const num = Math.abs(parseFloat(val) || 0);
                  set({ opening_balance: isAdvance ? -num : num });
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {isAdvance ? 'Vendor ke paas aap ka advance hai (aap ne lena hai).' : 'Purana baqi jo aap ne vendor ko dena hai.'}
            </p>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="vendor-bank"><span className="flex items-center gap-1"><Landmark size={12} className="text-slate-400" /> Bank</span></FieldLabel>
              <input id="vendor-bank" type="text" className={fieldClass} placeholder="Meezan, HBL, JazzCash…" value={vendorFormData.bank_name || ''} onChange={e => set({ bank_name: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="vendor-account">Account # / IBAN</FieldLabel>
              <input id="vendor-account" type="text" className={`${fieldClass} font-mono`} placeholder="PK00MEZN…" value={vendorFormData.account_number || ''} onChange={e => set({ account_number: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="vendor-notes">Notes</FieldLabel>
              <textarea id="vendor-notes" rows={2} className={`${fieldClass} h-auto resize-none py-2`} placeholder="Payment terms, meter #, contract date…" value={vendorFormData.notes || ''} onChange={e => set({ notes: e.target.value })} />
            </div>
          </section>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
            <span>
              <span className="block text-xs font-bold text-slate-800">Active</span>
              <span className="block text-[11px] text-slate-500">Inactive vendors are hidden from new expenses but keep their khata.</span>
            </span>
            <Switch checked={vendorFormData.isActive !== false} onChange={value => set({ isActive: value })} label="Active vendor" />
          </label>
        </SheetBody>

        <SheetFooter className="justify-end">
          <button type="button" onClick={onClose} disabled={isSubmittingVendor} className="h-10 rounded-xl px-4 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={isSubmittingVendor} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-lime-600 px-5 text-xs font-bold text-white shadow-md shadow-lime-600/25 hover:bg-lime-700 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none sm:flex-initial">
            {isSubmittingVendor ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> {editingVendor ? 'Save changes' : 'Add vendor'}</>}
          </button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};

// ==========================================
// 4. PAY VENDOR / RECEIVE BACK
// ==========================================
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

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      size="md"
      dismissible={!isSubmittingPayment}
      accent={isRefund ? 'from-sky-50' : 'from-emerald-50'}
      icon={<SheetIcon icon={isRefund ? ArrowDownLeft : ArrowUpRight} tone={isRefund ? 'bg-sky-600 text-white shadow-sky-600/25' : 'bg-emerald-600 text-white shadow-emerald-600/25'} />}
      title={isRefund ? 'Receive from vendor' : 'Pay vendor'}
      subtitle={isRefund ? 'Advance returned, refund or overpayment back' : 'Clear dues, pay salary or give an advance'}
    >
      <form onSubmit={handlePaymentSubmit} onKeyDown={submitOnCtrlEnter} className="flex min-h-0 flex-1 flex-col">
        <SheetBody className="space-y-4">
          {isLocked && <LockedBanner date={paymentFormData.date} what="payment" />}

          <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
            {([
              { value: 'payment', label: 'Pay', hint: 'Money goes out', icon: ArrowUpRight, on: 'border-emerald-500 bg-emerald-50 text-emerald-800 ring-emerald-500/15' },
              { value: 'refund', label: 'Receive', hint: 'Money comes back', icon: ArrowDownLeft, on: 'border-sky-500 bg-sky-50 text-sky-800 ring-sky-500/15' },
            ] as const).map(opt => {
              const selected = paymentFormData.type === opt.value;
              const Icon = opt.icon;
              return (
                <button key={opt.value} type="button" role="radio" aria-checked={selected} onClick={() => set({ type: opt.value })} className={`rounded-xl border px-3 py-2 text-left transition-all ${selected ? `${opt.on} ring-4` : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  <span className="flex items-center gap-1.5 text-xs font-bold"><Icon size={14} />{opt.label}</span>
                  <span className="text-[10px] font-medium opacity-75">{opt.hint}</span>
                </button>
              );
            })}
          </div>

          <div>
            <FieldLabel>Vendor <span className="text-rose-500">*</span></FieldLabel>
            <RichSelect
              options={vendorRichOptions}
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
              <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-[11px] animate-in fade-in">
                <div className="bg-white px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-slate-400">Khata now</p>
                  <p className={`font-mono text-xs font-black ${bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-sky-700' : 'text-slate-500'}`}>{describe(bal)}</p>
                </div>
                <div className="bg-white px-3 py-2">
                  <p className="font-bold uppercase tracking-wider text-slate-400">After this</p>
                  <p className={`font-mono text-xs font-black ${balAfter > 0 ? 'text-rose-600' : balAfter < 0 ? 'text-sky-700' : 'text-emerald-700'}`}>{amount > 0 ? describe(balAfter) : '—'}</p>
                </div>
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="payment-amount" aside={quickAmounts.length > 0 && (
              <span className="flex gap-1">
                {quickAmounts.map(q => (
                  <button key={q.label} type="button" onClick={() => set({ amount: q.value })} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${amount === q.value ? 'bg-lime-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'}`}>
                    {q.label}
                  </button>
                ))}
              </span>
            )}>{isRefund ? 'Amount received' : 'Amount'}</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-lg font-black text-slate-300">Rs</span>
              <SmartNumberInput
                id="payment-amount"
                data-autofocus
                className={`h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 font-mono text-2xl font-black tracking-tight outline-none placeholder:text-slate-300 focus:border-lime-500 focus:ring-4 focus:ring-lime-500/10 ${isRefund ? 'text-sky-700' : 'text-emerald-700'}`}
                placeholder="0"
                required
                value={paymentFormData.amount}
                onChange={val => set({ amount: val })}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <FieldLabel htmlFor="payment-date" aside={
                  <button type="button" onClick={() => set({ date: today })} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${paymentFormData.date === today ? 'bg-lime-600 text-white' : 'bg-slate-100 text-slate-500'}`}>Today</button>
                }>Date</FieldLabel>
                <input id="payment-date" type="date" className={fieldClass} value={paymentFormData.date} onChange={e => set({ date: e.target.value })} required />
              </div>
              <div>
                <FieldLabel>Mode</FieldLabel>
                <PillGroup label="Payment mode" options={MODE_OPTIONS} value={paymentFormData.mode} onChange={mode => set({ mode, account_id: defaultAccountFor(mode, accounts, settings) })} className="bg-white" />
              </div>
            </div>
            <div>
              <FieldLabel>{isRefund ? 'Into account' : 'From account'} <span className="text-rose-500">*</span></FieldLabel>
              <RichSelect options={accountRichOptions} value={paymentFormData.account_id} onChange={accId => set({ account_id: accId })} placeholder="Select account…" searchPlaceholder="Search account…" />
            </div>
            {selectedDirectPaymentAccount && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">{selectedDirectPaymentAccount.name} balance</span>
                <span className="font-mono font-semibold text-slate-700">
                  {formatCurrency(selectedDirectPaymentAccount.balance)}
                  {amount > 0 && <span className={`ml-1.5 font-bold ${accountAfter < 0 ? 'text-rose-600' : 'text-slate-500'}`}>→ {formatCurrency(accountAfter)}</span>}
                </span>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="payment-ref">Ref / cheque # <span className="font-medium text-slate-400">(optional)</span></FieldLabel>
              <input id="payment-ref" type="text" className={fieldClass} placeholder="Tx ID / receipt #" value={paymentFormData.reference_no} onChange={e => set({ reference_no: e.target.value })} />
            </div>
            <div>
              <FieldLabel htmlFor="payment-note">Note</FieldLabel>
              <input id="payment-note" type="text" className={fieldClass} placeholder={isRefund ? 'Advance returned…' : 'Salary, rent, advance…'} value={paymentFormData.note} onChange={e => set({ note: e.target.value })} />
            </div>
          </div>
        </SheetBody>

        <SheetFooter className="justify-end">
          <button type="button" onClick={onClose} disabled={isSubmittingPayment} className="h-10 rounded-xl px-4 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button
            type="submit"
            disabled={isSubmittingPayment || isLocked}
            title={isLocked ? `${paymentFormData.date} lock hai` : 'Ctrl+Enter'}
            className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-xs font-bold text-white shadow-md transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none ${isRefund ? 'bg-sky-600 shadow-sky-600/25 hover:bg-sky-700' : 'bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-700'}`}
          >
            {isSubmittingPayment
              ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : <>{isRefund ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />} {isRefund ? 'Receive' : 'Pay'} {amount > 0 ? formatCurrency(amount) : ''}</>}
          </button>
        </SheetFooter>
      </form>
    </Sheet>
  );
};
