import React, { useEffect, useMemo, useState } from 'react';
import { 
  FolderTree, Plus, Search, X, ChevronDown, ChevronRight, Tag, 
  Edit, Check, Lock, Trash2, AlertCircle, Loader2, Users, 
  Building, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, Bookmark
} from 'lucide-react';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { SegmentedControl } from '../SegmentedControl';
import { CategoryStructure, SubcategoryStructure, SERVICE_TYPES } from './ExpenseTypes';
import { ExpenseEntry, ExpenseVendor, SavedExpense } from '../../types';
import { SmartNumberInput } from '../SmartNumberInput';
import { useDairy } from '../../context/DairyContext';
import { formatCurrency } from '../../lib/formatters';

const inputClass = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-lime-500 transition-colors shadow-2xs";
const labelClass = "text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1 block";

// ==========================================
// 1. CATEGORY & SUBCATEGORY MANAGER MODAL
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
  isOpen,
  onClose,
  categoryTree,
  categorySearch,
  setCategorySearch,
  modalCatFilter,
  setModalCatFilter,
  isModalCreatingMainCat,
  setIsModalCreatingMainCat,
  modalNewCategoryName,
  setModalNewCategoryName,
  handleModalAddCategory,
  handleToggleCategoryActive,
  handleStartEditCategory,
  handleSaveEditCategory,
  editingCatName,
  setEditingCatName,
  editCatInput,
  setEditCatInput,
  handleDeleteCategory,
  getCategoryUsageCount,
  expandedCatsInModal,
  setExpandedCatsInModal,
  getSubcategoryUsageCount,
  editingSubcatKey,
  setEditingSubcatKey,
  editSubcatInput,
  setEditSubcatInput,
  handleStartEditSubcategory,
  handleSaveEditSubcategory,
  handleToggleSubcategoryActive,
  handleDeleteSubcategory,
  newSubcatInputs,
  setNewSubcatInputs,
  handleModalAddSubcat
}) => {
  if (!isOpen) return null;

  const filteredCategories = categoryTree.filter(c => {
    const searchMatch = !categorySearch.trim() ||
      c.name.toLowerCase().includes(categorySearch.toLowerCase()) ||
      c.subcategories.some(s => s.name.toLowerCase().includes(categorySearch.toLowerCase()));
    if (!searchMatch) return false;
    if (modalCatFilter === 'active') return c.isActive;
    if (modalCatFilter === 'inactive') return !c.isActive;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
        
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 bg-slate-50/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-lime-100 dark:bg-lime-950/50 border border-lime-200 dark:border-lime-800 text-lime-700 dark:text-lime-300 flex items-center justify-center shadow-2xs">
              <FolderTree size={20} />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 leading-tight">Expense Categories & Subcategories</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Manage chart of accounts, disable unused heads, and create custom sub-categories</p>
            </div>
          </div>
          <button aria-label="Band karein" 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18}/>
          </button>
        </div>

        {/* Controls Bar: Search + Filter Tabs + New Category Trigger */}
        <div className="px-5 sm:px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input 
                type="text" 
                placeholder="Search categories or sub-items..." 
                className="w-full pl-8.5 pr-8 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-800 focus:outline-none focus:border-lime-500 transition-all shadow-2xs" 
                value={categorySearch} 
                onChange={e => setCategorySearch(e.target.value)} 
              />
              {categorySearch && (
                <button aria-label="Hatayen" 
                  onClick={() => setCategorySearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-0.5 cursor-pointer"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filter Status Pills */}
            <div className="flex items-center gap-1 bg-slate-100/90 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setModalCatFilter('all')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  modalCatFilter === 'all' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-bold shadow-2xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                All ({categoryTree.length})
              </button>
              <button
                type="button"
                onClick={() => setModalCatFilter('active')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  modalCatFilter === 'active' ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 font-bold shadow-2xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Active ({categoryTree.filter(c => c.isActive).length})
              </button>
              <button
                type="button"
                onClick={() => setModalCatFilter('inactive')}
                className={`px-3 py-1 rounded-lg transition-all ${
                  modalCatFilter === 'inactive' ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold shadow-2xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Disabled ({categoryTree.filter(c => !c.isActive).length})
              </button>
            </div>

            {/* Add Category Button */}
            <button
              type="button"
              onClick={() => setIsModalCreatingMainCat(!isModalCreatingMainCat)}
              className="px-3.5 py-1.5 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all shrink-0 cursor-pointer"
            >
              <Plus size={14} /> New Category
            </button>
          </div>

          {/* Inline Category Creation Banner */}
          {isModalCreatingMainCat && (
            <form onSubmit={async (e) => {
              await handleModalAddCategory(e);
              setIsModalCreatingMainCat(false);
            }} className="p-3 bg-lime-50/70 dark:bg-lime-950/30 border border-lime-200 dark:border-lime-800 rounded-xl flex flex-col sm:flex-row items-center gap-2 animate-in fade-in">
              <input 
                type="text" 
                className="w-full sm:flex-1 rounded-lg border border-lime-300 dark:border-lime-700 bg-white dark:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-500/20" 
                placeholder="Category Name (e.g. Animal Feed, Veterinary)..." 
                value={modalNewCategoryName} 
                onChange={e => setModalNewCategoryName(e.target.value)} 
                autoFocus
              />
              <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsModalCreatingMainCat(false);
                    setModalNewCategoryName('');
                  }} 
                  className="px-3 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={!modalNewCategoryName.trim()} 
                  className="bg-lime-600 hover:bg-lime-700 text-white px-4 py-1.5 rounded-lg font-bold text-xs shadow-2xs transition-all disabled:opacity-50"
                >
                  Save Category
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Body: Category Tree Table */}
        <div className="p-4 sm:p-6 space-y-2.5 overflow-y-auto flex-1 bg-slate-50/40 dark:bg-slate-950/30">
          {filteredCategories.map(cat => {
            const isExpanded = expandedCatsInModal[cat.name] !== false;
            const usageCount = getCategoryUsageCount(cat.name);
            const isLocked = usageCount > 0;
            const isEditing = editingCatName === cat.name;

            return (
              <div 
                key={cat.name} 
                className={`rounded-2xl border transition-all bg-white dark:bg-slate-800 overflow-hidden shadow-2xs ${
                  !cat.isActive 
                    ? 'border-slate-200 dark:border-slate-800 opacity-70 bg-slate-50/60 dark:bg-slate-900/60' 
                    : 'border-slate-200/90 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                {/* Category Header Bar */}
                <div className={`px-4 py-3 flex items-center justify-between gap-3 ${
                  cat.isActive ? 'bg-white dark:bg-slate-800' : 'bg-slate-100/50 dark:bg-slate-900/50'
                }`}>
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button aria-label="Khol / band karein" 
                      type="button" 
                      onClick={() => setExpandedCatsInModal(prev => ({ ...prev, [cat.name]: !isExpanded }))}
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      cat.isActive 
                        ? 'bg-lime-50 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300 border border-lime-200 dark:border-lime-800'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                    }`}>
                      <Tag size={13} />
                    </div>

                    {isEditing ? (
                      <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                        <input 
                          type="text"
                          className="px-2.5 py-1 bg-lime-50 dark:bg-slate-900 border border-lime-400 dark:border-lime-600 rounded-lg text-xs font-bold text-slate-900 dark:text-slate-100 outline-none w-full shadow-2xs"
                          value={editCatInput}
                          onChange={e => setEditCatInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveEditCategory(cat);
                            if (e.key === 'Escape') setEditingCatName(null);
                          }}
                          autoFocus
                        />
                        <button aria-label="Save Name" 
                          type="button" 
                          onClick={() => handleSaveEditCategory(cat)}
                          className="p-1.5 bg-lime-600 hover:bg-lime-700 text-white rounded-lg transition-colors cursor-pointer"
                          title="Save Name"
                        >
                          <Check size={13} />
                        </button>
                        <button aria-label="Cancel" 
                          type="button" 
                          onClick={() => setEditingCatName(null)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                          title="Cancel"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex items-center gap-2 flex-wrap">
                        <span className={`text-xs sm:text-sm font-bold truncate ${
                          !cat.isActive ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {cat.name}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">
                          • {cat.subcategories.length} sub-items
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right Controls */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    {isLocked && (
                      <span className="text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold px-2 py-0.5 rounded-md flex items-center gap-1" title={`${usageCount} expense transactions recorded`}>
                        <Lock size={10} /> {usageCount} txns
                      </span>
                    )}

                    {!isEditing && (
                      <button aria-label="Rename Category" 
                        type="button" 
                        onClick={() => handleStartEditCategory(cat)}
                        className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                        title="Rename Category"
                      >
                        <Edit size={13} />
                      </button>
                    )}

                    {/* Toggle Switch */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleToggleCategoryActive(cat)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          cat.isActive ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                        title={cat.isActive ? 'Click to Disable' : 'Click to Enable'}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ease-in-out ${
                          cat.isActive ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                      <span className={`text-[11px] font-bold hidden sm:inline ${cat.isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'}`}>
                        {cat.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>

                    {/* Delete Button */}
                    <button aria-label={isLocked ? 'Cannot delete category with recorded transactions' : 'Delete Category'} 
                      type="button" 
                      onClick={() => handleDeleteCategory(cat)} 
                      disabled={isLocked}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isLocked ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer'
                      }`}
                      title={isLocked ? 'Cannot delete category with recorded transactions' : 'Delete Category'}
                    >
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>

                {/* Expanded Subcategories Drawer */}
                {isExpanded && (
                  <div className="px-4 py-3 bg-slate-50/60 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-700 space-y-2">
                    <div className="border-l-2 border-slate-200 dark:border-slate-700 ml-4 pl-3.5 space-y-1.5">
                      {cat.subcategories.map(sub => {
                        const subUsage = getSubcategoryUsageCount(cat.name, sub.name);
                        const isSubLocked = subUsage > 0;
                        const isSubEditing = editingSubcatKey === `${cat.name}::${sub.name}`;

                        return (
                          <div 
                            key={sub.name} 
                            className={`flex items-center justify-between px-3 py-1.5 rounded-xl text-xs transition-colors border ${
                              !sub.isActive 
                                ? 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 opacity-60' 
                                : 'bg-white dark:bg-slate-800 border-slate-200/70 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300 min-w-0 flex-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                              
                              {isSubEditing ? (
                                <div className="flex items-center gap-1 flex-1 max-w-xs">
                                  <input 
                                    type="text"
                                    className="px-2 py-0.5 bg-lime-50 dark:bg-slate-900 border border-lime-400 dark:border-lime-600 rounded text-xs font-bold text-slate-900 dark:text-slate-100 outline-none w-full"
                                    value={editSubcatInput}
                                    onChange={e => setEditSubcatInput(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleSaveEditSubcategory(cat.name, sub);
                                      if (e.key === 'Escape') setEditingSubcatKey(null);
                                    }}
                                    autoFocus
                                  />
                                  <button aria-label="Save" 
                                    type="button" 
                                    onClick={() => handleSaveEditSubcategory(cat.name, sub)}
                                    className="p-1 bg-lime-600 hover:bg-lime-700 text-white rounded cursor-pointer"
                                    title="Save"
                                  >
                                    <Check size={11} />
                                  </button>
                                  <button aria-label="Cancel" 
                                    type="button" 
                                    onClick={() => setEditingSubcatKey(null)}
                                    className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
                                    title="Cancel"
                                  >
                                    <X size={11} />
                                  </button>
                                </div>
                              ) : (
                                <span className={`truncate ${!sub.isActive ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200 font-semibold'}`}>
                                  {sub.name}
                                </span>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0">
                              {isSubLocked && (
                                <span className="text-[9px] text-amber-700 dark:text-amber-300 font-bold flex items-center gap-0.5 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                                  <Lock size={8} /> {subUsage}
                                </span>
                              )}

                              {!isSubEditing && (
                                <button aria-label="Rename Sub-category" 
                                  type="button" 
                                  onClick={() => handleStartEditSubcategory(cat.name, sub)}
                                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors cursor-pointer"
                                  title="Rename Sub-category"
                                >
                                  <Edit size={11} />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleToggleSubcategoryActive(cat.name, sub)}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  sub.isActive ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                                }`}
                                title={sub.isActive ? 'Disable Subcategory' : 'Enable Subcategory'}
                              >
                                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                                  sub.isActive ? 'translate-x-3' : 'translate-x-0'
                                }`} />
                              </button>

                              <button aria-label={isSubLocked ? 'Cannot delete: transactions recorded under this sub-category' : 'Delete Sub-category'} 
                                type="button" 
                                onClick={() => handleDeleteSubcategory(cat.name, sub)}
                                disabled={isSubLocked}
                                className={`p-1 rounded transition-colors ${isSubLocked ? 'text-slate-200 dark:text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-red-600 cursor-pointer'}`}
                                title={isSubLocked ? 'Cannot delete: transactions recorded under this sub-category' : 'Delete Sub-category'}
                              >
                                <Trash2 size={12}/>
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Quick Add Subcategory Input */}
                      <div className="flex items-center gap-2 pt-1">
                        <input 
                          type="text" 
                          className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 outline-none focus:border-lime-500 shadow-2xs" 
                          placeholder={`+ Add subcategory under ${cat.name}...`} 
                          value={newSubcatInputs[cat.name] || ''} 
                          onChange={e => setNewSubcatInputs({ ...newSubcatInputs, [cat.name]: e.target.value })} 
                          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleModalAddSubcat(cat.name))}
                        />
                        <button 
                          type="button" 
                          disabled={!newSubcatInputs[cat.name]?.trim()} 
                          onClick={() => handleModalAddSubcat(cat.name)}
                          className="px-3.5 py-1.5 bg-lime-600 hover:bg-lime-700 active:scale-95 text-white rounded-xl text-xs font-bold disabled:opacity-40 shrink-0 transition-all shadow-2xs cursor-pointer"
                        >
                          Add Sub
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredCategories.length === 0 && (
            <div className="p-10 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
              <FolderTree size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="font-bold text-xs text-slate-600 dark:text-slate-300">No categories found</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Try searching with a different keyword or create a new category above</p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Showing <strong className="text-slate-800 dark:text-slate-200 font-bold">{categoryTree.length}</strong> categories (<span className="text-emerald-700 dark:text-emerald-400 font-bold">{categoryTree.filter(c => c.isActive).length} Active</span>)
          </span>
          <button 
            type="button" 
            onClick={onClose} 
            className="bg-lime-600 hover:bg-lime-700 active:scale-95 text-white px-6 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};


// ==========================================
// 2. RECORD / EDIT EXPENSE MODAL
// ==========================================
interface ExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: Partial<ExpenseEntry> & { 
    paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
    account_id?: string;
    dueDate?: string;
  };
  setFormData: React.Dispatch<React.SetStateAction<Partial<ExpenseEntry> & { 
    paymentStatus: 'Paid' | 'Partial' | 'Unpaid';
    account_id?: string;
    dueDate?: string;
  }>>;
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

export const ExpenseFormModal: React.FC<ExpenseFormModalProps> = ({
  isOpen,
  onClose,
  formData,
  setFormData,
  handleSubmitExpense,
  isSubmitting,
  categoryRichOptions,
  activeSubcategoryList,
  vendorRichOptions,
  accountRichOptions,
  selectedPaymentAccount,
  isModalCreatingCat,
  setIsModalCreatingCat,
  modalNewCatInput,
  setModalNewCatInput,
  handleCreateMainCategory,
  isModalCreatingSub,
  setIsModalCreatingSub,
  modalNewSubInput,
  setModalNewSubInput,
  handleCreateSubcategory,
  isModalCreatingVendor,
  setIsModalCreatingVendor,
  quickVendorName,
  setQuickVendorName,
  quickVendorPhone,
  setQuickVendorPhone,
  handleQuickCreateVendor,
  accounts,
  settings,
  rememberExpense,
  setRememberExpense,
  rememberName,
  setRememberName
}) => {
  const { isDayLocked } = useDairy();
  const isDateLocked = Boolean(isDayLocked && formData.date && isDayLocked(formData.date));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex justify-between items-center">
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Record New Expense</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Record cash/bank expenses or vendor bills on credit</p>
          </div>
          <button aria-label="Band karein" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg cursor-pointer">
            <X size={20}/>
          </button>
        </div>

        <form onSubmit={handleSubmitExpense} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Proactive Day-Lock Warning Banner */}
          {isDateLocked && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center gap-2.5 text-xs font-semibold text-amber-900 dark:text-amber-200 animate-in fade-in" role="alert">
              <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span><strong>Day Locked ({formData.date}):</strong> This date is closed and locked for accounting. New expenses cannot be recorded for locked dates.</span>
            </div>
          )}

          {/* Amount and Payment Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Total Bill Amount (Rs) *</label>
              <SmartNumberInput 
                className={`${inputClass} text-lg font-bold font-mono text-red-600 dark:text-red-400`} 
                placeholder="0.00" 
                autoFocus 
                required 
                value={formData.amount || ''} 
                onChange={val => {
                  const num = parseFloat(val) || 0;
                  setFormData(prev => ({
                    ...prev, 
                    amount: num,
                    paidAmount: prev.paymentStatus === 'Paid' ? num : (prev.paymentStatus === 'Unpaid' ? 0 : Math.min(num, prev.paidAmount || 0))
                  }));
                }} 
              />
            </div>

            <div>
              <label className={labelClass}>Payment Status *</label>
              <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                {(['Paid', 'Partial', 'Unpaid'] as const).map(status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        paymentStatus: status,
                        paidAmount: status === 'Paid' ? (prev.amount || 0) : (status === 'Unpaid' ? 0 : (prev.paidAmount || 0))
                      }));
                    }}
                    className={`py-2 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      formData.paymentStatus === status 
                        ? (status === 'Paid' ? 'bg-emerald-600 text-white shadow-xs' : status === 'Partial' ? 'bg-amber-600 text-white shadow-xs' : 'bg-rose-600 text-white shadow-xs')
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {status === 'Paid' ? 'Full Paid' : status === 'Partial' ? 'Partial' : 'Unpaid (Bill)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Partial Payment Amount Input & Summary */}
          {formData.paymentStatus === 'Partial' && (
            <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2 animate-in fade-in">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-amber-900 dark:text-amber-300">Paid Now (Rs) *</label>
                <span className="text-xs font-bold text-rose-700 dark:text-rose-400">
                  Remaining Dues: {formatCurrency(Math.max(0, (formData.amount || 0) - (formData.paidAmount || 0)))}
                </span>
              </div>
              <SmartNumberInput 
                max={formData.amount || 0}
                className={`${inputClass} font-bold font-mono text-emerald-700 dark:text-emerald-400`}
                placeholder="Amount paid today..." 
                value={formData.paidAmount || ''} 
                onChange={val => setFormData({ ...formData, paidAmount: parseFloat(val) || 0 })} 
              />
            </div>
          )}

          {/* Unpaid Notice */}
          {formData.paymentStatus === 'Unpaid' && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-xs text-rose-800 dark:text-rose-300 animate-in fade-in">
              <AlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
              <span>This bill of <strong>{formatCurrency((formData.amount || 0))}</strong> will be added to the vendor's pending dues ledger without deducting from cash/bank right now.</span>
            </div>
          )}

          <div>
            <label className={labelClass}>Description / Purpose *</label>
            <input 
              type="text" 
              className={inputClass} 
              placeholder="e.g. Generator Diesel, Ice Blocks, Tea for Workers" 
              required 
              value={formData.description} 
              onChange={e => setFormData({...formData, description: e.target.value})} 
            />
          </div>

          {/* Hierarchical Category & Subcategory Select */}
          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Category *</label>
                {!isModalCreatingCat && (
                  <button 
                    type="button" 
                    onClick={() => setIsModalCreatingCat(true)}
                    className="text-[11px] font-semibold text-lime-700 dark:text-lime-400 hover:text-lime-800 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus size={12}/> New Category
                  </button>
                )}
              </div>

              {isModalCreatingCat ? (
                <div className="flex gap-1.5 animate-in fade-in">
                  <input 
                    type="text" 
                    className="flex-1 rounded-lg border border-lime-500 bg-lime-50/30 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none" 
                    placeholder="Category name..." 
                    value={modalNewCatInput} 
                    onChange={e => setModalNewCatInput(e.target.value)} 
                    onKeyDown={async e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!modalNewCatInput.trim()) return;
                        const res = await handleCreateMainCategory(modalNewCatInput);
                        if (res) {
                          setFormData({ ...formData, category: res, subcategory: '' });
                          setModalNewCatInput('');
                          setIsModalCreatingCat(false);
                        }
                      }
                    }}
                    autoFocus 
                  />
                  <button 
                    type="button" 
                    onClick={async () => {
                      if (!modalNewCatInput.trim()) return;
                      const res = await handleCreateMainCategory(modalNewCatInput);
                      if (res) {
                        setFormData({ ...formData, category: res, subcategory: '' });
                        setModalNewCatInput('');
                        setIsModalCreatingCat(false);
                      }
                    }} 
                    className="bg-lime-600 hover:bg-lime-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    Save
                  </button>
                  <button aria-label="Hatayen" type="button" onClick={() => setIsModalCreatingCat(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 shrink-0 cursor-pointer"><X size={14}/></button>
                </div>
              ) : (
                <RichSelect
                  options={categoryRichOptions}
                  value={formData.category || ''}
                  onChange={cat => setFormData({ ...formData, category: cat, subcategory: '' })}
                  placeholder="Select Category..."
                  searchPlaceholder="Search category..."
                />
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sub-Category (Optional)</label>
                {!isModalCreatingSub && formData.category && (
                  <button 
                    type="button" 
                    onClick={() => setIsModalCreatingSub(true)}
                    className="text-[11px] font-semibold text-lime-700 dark:text-lime-400 hover:text-lime-800 flex items-center gap-0.5 cursor-pointer"
                  >
                    <Plus size={12}/> New Sub-Category
                  </button>
                )}
              </div>

              {isModalCreatingSub ? (
                <div className="flex gap-1.5 animate-in fade-in">
                  <input 
                    type="text" 
                    className="flex-1 rounded-lg border border-lime-500 bg-lime-50/30 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none" 
                    placeholder={`Subcategory under ${formData.category}...`} 
                    value={modalNewSubInput} 
                    onChange={e => setModalNewSubInput(e.target.value)} 
                    onKeyDown={async e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!modalNewSubInput.trim() || !formData.category) return;
                        const res = await handleCreateSubcategory(formData.category, modalNewSubInput);
                        if (res) {
                          setFormData({ ...formData, subcategory: res });
                          setModalNewSubInput('');
                          setIsModalCreatingSub(false);
                        }
                      }
                    }}
                    autoFocus 
                  />
                  <button 
                    type="button" 
                    onClick={async () => {
                      if (!modalNewSubInput.trim() || !formData.category) return;
                      const res = await handleCreateSubcategory(formData.category, modalNewSubInput);
                      if (res) {
                        setFormData({ ...formData, subcategory: res });
                        setModalNewSubInput('');
                        setIsModalCreatingSub(false);
                      }
                    }} 
                    className="bg-lime-600 hover:bg-lime-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                  >
                    Save
                  </button>
                  <button aria-label="Hatayen" type="button" onClick={() => setIsModalCreatingSub(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 shrink-0 cursor-pointer"><X size={14}/></button>
                </div>
              ) : (
                <RichSelect
                  options={activeSubcategoryList.map(sub => ({ value: sub.name, label: sub.name }))}
                  value={formData.subcategory || ''}
                  onChange={sub => setFormData({ ...formData, subcategory: sub })}
                  placeholder="None / General"
                  disabled={!formData.category}
                  enableSearch={activeSubcategoryList.length > 5}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Expense Date</label>
              <input type="date" className={inputClass} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
            </div>

            {formData.paymentStatus !== 'Paid' && (
              <div>
                <label className={labelClass}>Due Date (Optional)</label>
                <input type="date" className={inputClass} value={formData.dueDate || ''} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
              </div>
            )}
          </div>

          {/* Vendor Selection + Quick Add */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className={labelClass}>
                Vendor / Payee {formData.paymentStatus !== 'Paid' ? '*' : '(Optional)'}
              </label>
              {!isModalCreatingVendor && (
                <button 
                  type="button" 
                  onClick={() => setIsModalCreatingVendor(true)}
                  className="text-[11px] font-semibold text-lime-700 dark:text-lime-400 hover:text-lime-800 flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus size={12}/> New Vendor
                </button>
              )}
            </div>

            {isModalCreatingVendor ? (
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2 animate-in fade-in">
                <input 
                  type="text" 
                  placeholder="Vendor Name..." 
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-lime-500"
                  value={quickVendorName}
                  onChange={e => setQuickVendorName(e.target.value)}
                  autoFocus
                />
                <input 
                  type="text" 
                  placeholder="Phone # (optional)..." 
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-lime-500"
                  value={quickVendorPhone}
                  onChange={e => setQuickVendorPhone(e.target.value)}
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setIsModalCreatingVendor(false)} className="px-2 py-1 text-slate-500 text-xs cursor-pointer">Cancel</button>
                  <button type="button" onClick={handleQuickCreateVendor} className="px-3 py-1 bg-lime-600 text-white rounded-lg text-xs font-bold cursor-pointer">Save Vendor</button>
                </div>
              </div>
            ) : (
              <RichSelect
                options={[
                  { value: '', label: formData.paymentStatus === 'Paid' ? 'None / Spot Cash' : 'Select Vendor for Dues...' },
                  ...vendorRichOptions
                ]}
                value={formData.vendor_id}
                onChange={id => setFormData({...formData, vendor_id: id})}
                placeholder={formData.paymentStatus === 'Paid' ? 'None / Spot Cash' : 'Select Vendor for Khata Dues...'}
                searchPlaceholder="Search vendor by name, service..."
              />
            )}
          </div>

          {/* Payment Account options only if amount is being paid upfront */}
          {formData.paymentStatus !== 'Unpaid' && (
            <div className="space-y-3 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Payment Mode</label>
                  <SegmentedControl
                    options={[
                      { value: 'Cash', label: 'Cash', icon: <Wallet size={12} /> },
                      { value: 'Online', label: 'Online', icon: <CreditCard size={12} /> },
                      { value: 'Bank Transfer', label: 'Bank', icon: <Building size={12} /> }
                    ]}
                    value={formData.paymentMode}
                    onChange={mode => {
                      let defaultAccId = formData.account_id;
                      if (mode === 'Cash') {
                        defaultAccId = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
                      } else {
                        defaultAccId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || '';
                      }
                      setFormData({
                        ...formData, 
                        paymentMode: mode,
                        account_id: defaultAccId
                      });
                    }}
                    size="sm"
                  />
                </div>

                <div>
                  <label className={labelClass}>Paid From Account</label>
                  <RichSelect
                    options={accountRichOptions}
                    value={formData.account_id || ''}
                    onChange={accId => setFormData({...formData, account_id: accId})}
                    placeholder="Select Account..."
                    searchPlaceholder="Search account..."
                  />
                </div>
              </div>

              {selectedPaymentAccount && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 rounded-xl text-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                    <CreditCard size={14} className="text-slate-400" /> Account Balance:
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                    {formatCurrency(selectedPaymentAccount.balance)}
                    {formData.paidAmount && formData.paidAmount > 0 ? (
                      <span className={`ml-2 text-xs font-bold ${selectedPaymentAccount.balance - formData.paidAmount < 0 ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
                        ➔ Left: {formatCurrency((selectedPaymentAccount.balance - formData.paidAmount))}
                      </span>
                    ) : null}
                  </span>
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-lime-600"
              checked={rememberExpense}
              onChange={e => setRememberExpense(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">Save for next time</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Category, vendor, account, and amount stay saved. Open Saved later to fill this form again. The date will be today.</span>
            </span>
          </label>
          {rememberExpense && (
            <input
              type="text"
              className={inputClass}
              placeholder={formData.description || 'Name, for example Generator Diesel'}
              value={rememberName}
              onChange={e => setRememberName(e.target.value)}
            />
          )}

          <button 
            type="submit" 
            disabled={isSubmitting || isDateLocked}
            title={isDateLocked ? `Selected date (${formData.date}) is closed & locked` : undefined}
            className={`w-full text-white py-3 rounded-xl font-bold text-xs shadow-md transition-all mt-2 flex items-center justify-center gap-2 ${
              isSubmitting || isDateLocked ? 'bg-slate-400 cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 shadow-lime-500/20 cursor-pointer'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Saving Expense...
              </>
            ) : (
              'Save & Record Expense'
            )}
          </button>
        </form>
      </div>
    </div>
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

export const SavedExpensesModal: React.FC<SavedExpensesModalProps> = ({
  isOpen,
  onClose,
  savedExpenses,
  accounts,
  onUse,
  onDelete
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return savedExpenses;
    return savedExpenses.filter(preset => {
      const haystack = [preset.name, preset.description, preset.category, preset.subcategory, preset.vendor_name, preset.paymentMode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, savedExpenses]);

  if (!isOpen) return null;

  const statusClass = (status: SavedExpense['paymentStatus']) => {
    if (status === 'Unpaid') return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    if (status === 'Partial') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-lime-200 bg-lime-100 text-lime-700 dark:border-lime-800 dark:bg-lime-950/50 dark:text-lime-300">
              <Bookmark size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold leading-tight text-slate-900 dark:text-slate-100">Saved expenses</h3>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Tap one to fill Record Expense. Date stays today.</p>
            </div>
          </div>
          <button aria-label="Band karein" type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search name, category, or vendor"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-8 pr-8 text-xs font-semibold text-slate-800 outline-none focus:border-lime-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              autoFocus
            />
            {query && (
              <button aria-label="Hatayen" type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/50 p-4 dark:bg-slate-950/30">
          {savedExpenses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <Bookmark size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">No saved expenses yet</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Turn on Save for next time while recording, or bookmark an entry from the list.
              </p>
            </div>
          ) : matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">No saved expense matches that search.</p>
          ) : (
            matches.map(preset => {
              const accountName = accounts.find(account => account.id === preset.account_id)?.name;
              const status = preset.paymentStatus || 'Paid';
              return (
                <div key={preset.id} className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => onUse(preset)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-lime-50/70 dark:hover:bg-lime-950/20"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-extrabold text-slate-900 dark:text-white">{preset.name}</p>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${statusClass(status)}`}>
                          {status}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">
                        {preset.category}{preset.subcategory ? ` · ${preset.subcategory}` : ''}
                        {preset.vendor_name ? ` · ${preset.vendor_name}` : ''}
                        {` · ${preset.paymentMode || 'Cash'}`}
                        {accountName ? ` · ${accountName}` : ''}
                      </p>
                      {preset.description && preset.description !== preset.name && (
                        <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{preset.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                        {formatCurrency(Number(preset.amount || 0))}
                      </span>
                      <ChevronRight size={14} className="text-slate-300" />
                    </div>
                  </button>
                  <button aria-label="Remove saved expense"
                    type="button"
                    onClick={() => onDelete(preset.id)}
                    className="shrink-0 border-l border-slate-100 px-3 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:hover:bg-rose-950/30"
                    title="Remove saved expense"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/80">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {savedExpenses.length} saved
          </span>
          <button type="button" onClick={onClose} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white dark:bg-slate-700">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


// ==========================================
// 3. ADD / EDIT VENDOR MODAL
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
  isOpen,
  onClose,
  vendorFormData,
  setVendorFormData,
  handleVendorSubmit,
  isSubmittingVendor,
  editingVendor
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-lime-100 dark:bg-lime-950/60 text-lime-800 dark:text-lime-300 flex items-center justify-center font-bold">
              <Users size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{editingVendor ? 'Edit Vendor Profile' : 'Add New Vendor'}</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Landlord, utility provider, packaging supplier, or staff</p>
            </div>
          </div>
          <button aria-label="Band karein" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg cursor-pointer"><X size={20}/></button>
        </div>
        
        <form onSubmit={handleVendorSubmit} className="p-6 space-y-3.5 max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Vendor / Business Name *</label>
              <input 
                type="text" 
                className={inputClass} 
                required 
                placeholder="e.g. Shell Petrol Pump, Malik Sb" 
                value={vendorFormData.name || ''} 
                onChange={e => setVendorFormData({...vendorFormData, name: e.target.value})} 
                autoFocus
              />
            </div>

            <div>
              <label className={labelClass}>Service / Type</label>
              <select 
                className={inputClass} 
                value={vendorFormData.service_type || 'Other'} 
                onChange={e => setVendorFormData({...vendorFormData, service_type: e.target.value})}
              >
                {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Contact Person (Optional)</label>
              <input 
                type="text" 
                className={inputClass} 
                placeholder="Manager / Owner name..." 
                value={vendorFormData.contact_person || ''} 
                onChange={e => setVendorFormData({...vendorFormData, contact_person: e.target.value})} 
              />
            </div>

            <div>
              <label className={labelClass}>Phone Number</label>
              <input 
                type="text" 
                className={inputClass} 
                placeholder="0300-1234567" 
                value={vendorFormData.phone || ''} 
                onChange={e => setVendorFormData({...vendorFormData, phone: e.target.value})} 
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Address / Location</label>
            <input 
              type="text" 
              className={inputClass} 
              placeholder="Shop / Unit / Station address..." 
              value={vendorFormData.address || ''} 
              onChange={e => setVendorFormData({...vendorFormData, address: e.target.value})} 
            />
          </div>

          {/* Financial & Bank Details */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Building size={14} className="text-slate-600 dark:text-slate-400"/> Bank & Opening Balance
            </h4>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Opening Balance (Rs)
                </label>
                {/* Debit (Payable) vs Credit (Advance) Toggle */}
                <div className="flex rounded-lg bg-slate-200 dark:bg-slate-700 p-0.5 text-[10px] font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      const currentAbs = Math.abs(vendorFormData.opening_balance || 0);
                      setVendorFormData({ ...vendorFormData, opening_balance: currentAbs });
                    }}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      (vendorFormData.opening_balance || 0) >= 0
                        ? 'bg-rose-600 text-white shadow-2xs font-black'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Payable (Debit)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const currentAbs = Math.abs(vendorFormData.opening_balance || 0);
                      setVendorFormData({ ...vendorFormData, opening_balance: -currentAbs });
                    }}
                    className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                      (vendorFormData.opening_balance || 0) < 0
                        ? 'bg-blue-600 text-white shadow-2xs font-black'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                    }`}
                  >
                    Advance (Credit)
                  </button>
                </div>
              </div>
              <SmartNumberInput 
                className={inputClass} 
                placeholder="0.00" 
                value={Math.abs(vendorFormData.opening_balance || 0) || ''} 
                onChange={val => {
                  const num = parseFloat(val) || 0;
                  const isCredit = (vendorFormData.opening_balance || 0) < 0;
                  setVendorFormData({
                    ...vendorFormData,
                    opening_balance: isCredit ? -Math.abs(num) : Math.abs(num)
                  });
                }} 
              />
              <p className="text-[10px] text-slate-400 mt-1">
                {(vendorFormData.opening_balance || 0) < 0
                  ? 'Credit (Advance): Vendor ko advance ada kiya hua hai / vendor se lena hai.'
                  : 'Debit (Payable): Vendor ko raqam ada karni hai (Outstanding dues).'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">Bank Name</label>
                <input 
                  type="text" 
                  className={inputClass} 
                  placeholder="e.g. Meezan Bank, HBL" 
                  value={vendorFormData.bank_name || ''} 
                  onChange={e => setVendorFormData({...vendorFormData, bank_name: e.target.value})} 
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1 block">Account Number / IBAN</label>
                <input 
                  type="text" 
                  className={inputClass} 
                  placeholder="PK00MEZN..." 
                  value={vendorFormData.account_number || ''} 
                  onChange={e => setVendorFormData({...vendorFormData, account_number: e.target.value})} 
                />
              </div>
            </div>
          </div>

          <div>
            <label className={labelClass}>Notes / Contract Terms (Optional)</label>
            <textarea 
              className={`${inputClass} resize-none h-16`} 
              placeholder="Payment terms, contract renewal date, meter #..." 
              value={vendorFormData.notes || ''} 
              onChange={e => setVendorFormData({...vendorFormData, notes: e.target.value})} 
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input 
              type="checkbox" 
              id="vendor_is_active_modal" 
              checked={vendorFormData.isActive !== false} 
              onChange={e => setVendorFormData({...vendorFormData, isActive: e.target.checked})}
              className="rounded border-slate-300 text-lime-600 focus:ring-lime-500 w-4 h-4 cursor-pointer"
            />
            <label htmlFor="vendor_is_active_modal" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              Active Vendor Profile
            </label>
          </div>

          <div className="pt-2 flex gap-2">
            <button 
              type="button" 
              onClick={onClose} 
              className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmittingVendor}
              className={`flex-1 py-2.5 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                isSubmittingVendor ? 'bg-slate-400 cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 shadow-lime-500/20'
              }`}
            >
              {isSubmittingVendor ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving...
                </>
              ) : (
                editingVendor ? 'Save Changes' : 'Create Vendor'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// ==========================================
// 4. PAY VENDOR / REFUND MODAL
// ==========================================
interface VendorPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  paymentFormData: {
    type: 'payment' | 'refund';
    vendor_id: string;
    amount: string | number;
    date: string;
    mode: string;
    account_id: string;
    reference_no: string;
    note: string;
  };
  setPaymentFormData: React.Dispatch<React.SetStateAction<{
    type: 'payment' | 'refund';
    vendor_id: string;
    amount: string | number;
    date: string;
    mode: string;
    account_id: string;
    reference_no: string;
    note: string;
  }>>;
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
  isOpen,
  onClose,
  paymentFormData,
  setPaymentFormData,
  handlePaymentSubmit,
  isSubmittingPayment,
  expenseVendors,
  vendorRichOptions,
  accountRichOptions,
  selectedDirectPaymentAccount,
  setSelectedPaymentVendor,
  accounts,
  settings
}) => {
  const { isDayLocked } = useDairy();
  const isPaymentDateLocked = Boolean(isDayLocked && paymentFormData.date && isDayLocked(paymentFormData.date));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 overflow-hidden border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className={`px-6 py-4 border-b flex justify-between items-center transition-colors ${
          paymentFormData.type === 'refund' 
            ? 'bg-lime-50/80 dark:bg-lime-950/40 text-lime-950 dark:text-lime-200 border-lime-100 dark:border-lime-800' 
            : 'bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 border-emerald-100 dark:border-emerald-800'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shadow-xs ${
              paymentFormData.type === 'refund' ? 'bg-lime-600 text-white' : 'bg-emerald-600 text-white'
            }`}>
              {paymentFormData.type === 'refund' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                {paymentFormData.type === 'refund' ? 'Receive from Vendor / Staff' : 'Pay Vendor / Staff'}
              </h3>
              <p className={`text-[11px] font-medium ${paymentFormData.type === 'refund' ? 'text-lime-700 dark:text-lime-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {paymentFormData.type === 'refund' 
                  ? 'Receive advance return, refund, or overpayment back'
                  : 'Clear dues, pay salary, or give advance'}
              </p>
            </div>
          </div>
          <button aria-label="Band karein" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg cursor-pointer">
            <X size={20}/>
          </button>
        </div>

        <form onSubmit={handlePaymentSubmit} className="p-5 sm:p-6 space-y-4">
          {/* Proactive Day-Lock Warning Banner */}
          {isPaymentDateLocked && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-center gap-2.5 text-xs font-semibold text-amber-900 dark:text-amber-200 animate-in fade-in" role="alert">
              <AlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
              <span><strong>Day Locked ({paymentFormData.date}):</strong> This date is closed and locked for accounting. Vendor transactions cannot be recorded for locked dates.</span>
            </div>
          )}

          {/* Transaction Direction Switcher */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
              Transaction Flow
            </label>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setPaymentFormData(prev => ({ ...prev, type: 'payment' }))}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentFormData.type === 'payment'
                    ? 'bg-white dark:bg-slate-700 text-emerald-800 dark:text-emerald-300 shadow-xs border border-emerald-200 dark:border-emerald-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ArrowUpRight size={14} className={paymentFormData.type === 'payment' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
                <span>Pay</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentFormData(prev => ({ ...prev, type: 'refund' }))}
                className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  paymentFormData.type === 'refund'
                    ? 'bg-white dark:bg-slate-700 text-lime-800 dark:text-lime-300 shadow-xs border border-lime-300 dark:border-lime-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ArrowDownLeft size={14} className={paymentFormData.type === 'refund' ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'} />
                <span>Receive</span>
              </button>
            </div>
          </div>

          {/* Select Vendor / Staff */}
          <div>
            <label className={labelClass}>Vendor / Staff Member *</label>
            <RichSelect
              options={vendorRichOptions}
              value={paymentFormData.vendor_id}
              onChange={vId => {
                const found = expenseVendors.find(v => v.id === vId) || null;
                setSelectedPaymentVendor(found);
                const bal = found?.pending_balance || 0;
                setPaymentFormData(prev => ({
                  ...prev,
                  vendor_id: vId,
                  amount: bal !== 0 ? Math.abs(bal) : prev.amount,
                  type: bal < 0 ? 'refund' : (bal > 0 ? 'payment' : prev.type)
                }));
              }}
              placeholder="Select Vendor / Staff..."
              searchPlaceholder="Search vendor by name, service..."
            />
          </div>

          {/* Payment Amount */}
          <div>
            <label className={labelClass}>
              {paymentFormData.type === 'refund' ? 'Amount Received Back (Rs) *' : 'Payment Amount (Rs) *'}
            </label>
            <SmartNumberInput 
              className={`${inputClass} text-lg font-bold font-mono ${
                paymentFormData.type === 'refund' ? 'text-lime-700 dark:text-lime-400' : 'text-emerald-700 dark:text-emerald-400'
              }`} 
              placeholder="0.00" 
              required 
              value={paymentFormData.amount} 
              onChange={val => setPaymentFormData({...paymentFormData, amount: val})} 
              autoFocus
            />
          </div>

          {/* Date & Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Date *</label>
              <input 
                type="date" 
                className={inputClass} 
                value={paymentFormData.date} 
                onChange={e => setPaymentFormData({...paymentFormData, date: e.target.value})} 
                required
              />
            </div>

            <div>
              <label className={labelClass}>Payment Mode</label>
              <SegmentedControl
                options={[
                  { value: 'Cash', label: 'Cash', icon: <Wallet size={12} /> },
                  { value: 'Online', label: 'Online', icon: <CreditCard size={12} /> },
                  { value: 'Bank Transfer', label: 'Bank', icon: <Building size={12} /> }
                ]}
                value={paymentFormData.mode}
                onChange={mode => {
                  let defaultAccId = paymentFormData.account_id;
                  if (mode === 'Cash') {
                    defaultAccId = settings.financial?.defaultCashAccountId || accounts.find(a => a.type === 'Cash')?.id || accounts[0]?.id || '';
                  } else {
                    defaultAccId = settings.financial?.defaultDigitalAccountId || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || accounts[0]?.id || '';
                  }
                  setPaymentFormData({
                    ...paymentFormData, 
                    mode,
                    account_id: defaultAccId
                  });
                }}
                size="sm"
              />
            </div>
          </div>

          {/* Financial Account Selector */}
          <div>
            <label className={labelClass}>
              {paymentFormData.type === 'refund' ? 'Deposit Into Account *' : 'Paid From Account *'}
            </label>
            <RichSelect
              options={accountRichOptions}
              value={paymentFormData.account_id}
              onChange={accId => setPaymentFormData({...paymentFormData, account_id: accId})}
              placeholder="Select Account..."
              searchPlaceholder="Search account..."
            />
          </div>

          {/* Live Account Balance Preview */}
          {selectedDirectPaymentAccount && (
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
                <CreditCard size={13} className="text-slate-400" /> Current Account Balance:
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono">
                {formatCurrency(selectedDirectPaymentAccount.balance)}
                {paymentFormData.amount && parseFloat(paymentFormData.amount as string) > 0 ? (
                  <span className={`ml-2 text-[11px] font-bold ${
                    paymentFormData.type === 'refund' ? 'text-lime-700 dark:text-lime-400' : (selectedDirectPaymentAccount.balance - parseFloat(paymentFormData.amount as string) < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400')
                  }`}>
                    ➔ {paymentFormData.type === 'refund' ? 'New:' : 'Left:'} {formatCurrency((
                      paymentFormData.type === 'refund'
                        ? selectedDirectPaymentAccount.balance + parseFloat(paymentFormData.amount as string)
                        : selectedDirectPaymentAccount.balance - parseFloat(paymentFormData.amount as string)
                    ))}
                  </span>
                ) : null}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Ref / Cheque # (Optional)</label>
              <input 
                type="text" 
                className={inputClass} 
                placeholder="Tx ID / Receipt #" 
                value={paymentFormData.reference_no} 
                onChange={e => setPaymentFormData({...paymentFormData, reference_no: e.target.value})} 
              />
            </div>

            <div>
              <label className={labelClass}>Notes / Narration</label>
              <input 
                type="text" 
                className={inputClass} 
                placeholder={paymentFormData.type === 'refund' ? 'Advance returned, refund...' : 'Salary, advance, rent...'} 
                value={paymentFormData.note} 
                onChange={e => setPaymentFormData({...paymentFormData, note: e.target.value})} 
              />
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <button 
              type="button" 
              onClick={onClose} 
              className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmittingPayment || isPaymentDateLocked}
              title={isPaymentDateLocked ? `Selected date (${paymentFormData.date}) is closed & locked` : undefined}
              className={`flex-1 py-2.5 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 ${
                isSubmittingPayment || isPaymentDateLocked
                  ? 'bg-slate-400 cursor-not-allowed shadow-none'
                  : (paymentFormData.type === 'refund' 
                    ? 'bg-lime-600 hover:bg-lime-700 shadow-lime-500/20 cursor-pointer' 
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20 cursor-pointer')
              }`}
            >
              {isSubmittingPayment ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Saving...
                </>
              ) : (
                <>
                  {paymentFormData.type === 'refund' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                  {paymentFormData.type === 'refund' ? 'Receive' : 'Pay'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
