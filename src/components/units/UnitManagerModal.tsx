import React, { useMemo, useRef, useState } from 'react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import type { UnitDefinition } from '../../types';
import {
  describeUnitRole,
  getAllAvailableUnits,
  getUnitFactorDescription
} from '../../lib/unitConversion';
import { Boxes, Droplet, Info, Layers, Lock, Pencil, Plus, Scale, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, SearchInput, SegmentedControl, Select } from '../ui';
import type { Tone } from '../ui';
import { confirmAction } from '../ui/ConfirmDialog';
import { cn } from '../../lib/cn';

type UnitTab = 'All' | 'Volume' | 'Mass' | 'Count' | 'Custom';

interface UnitManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUnit?: (unitSymbol: string) => void;
  initialCategory?: UnitTab;
}

interface UnitForm {
  name: string;
  symbol: string;
  type: 'Volume' | 'Mass' | 'Count';
  factor: string;
  urduName: string;
  description: string;
}

const EMPTY_FORM: UnitForm = { name: '', symbol: '', type: 'Count', factor: '1', urduName: '', description: '' };
const EMPTY_UNITS: UnitDefinition[] = [];
const ROLE_TONE: Record<string, Tone> = { base: 'success', convertible: 'info' };

export const UnitManagerModal: React.FC<UnitManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectUnit,
  initialCategory = 'All'
}) => {
  const { addUnit, updateUnit, deleteUnit, items, settings, canPerform } = useDairy();
  const { showToast } = useToast();
  const canManage = canPerform('items', 'edit') || canPerform('items', 'create');

  const [activeTab, setActiveTab] = useState<UnitTab>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [formData, setFormData] = useState<UnitForm>(EMPTY_FORM);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const customUnits = settings.inventory?.customUnits || EMPTY_UNITS;
  const allUnits = useMemo(() => getAllAvailableUnits(customUnits), [customUnits]);

  // Unit symbol -> number of products using it
  const usageMap = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(item => {
      const u = (item.unit || '').trim().toLowerCase();
      if (u) map[u] = (map[u] || 0) + 1;
    });
    return map;
  }, [items]);

  const counts = useMemo(() => ({
    All: allUnits.length,
    Volume: allUnits.filter(u => u.type === 'Volume').length,
    Mass: allUnits.filter(u => u.type === 'Mass').length,
    Count: allUnits.filter(u => u.type === 'Count').length,
    Custom: allUnits.filter(u => !u.isSystem).length,
  }), [allUnits]);

  const filteredUnits = useMemo(() => {
    let list = allUnits;
    if (activeTab === 'Custom') list = list.filter(u => !u.isSystem);
    else if (activeTab !== 'All') list = list.filter(u => u.type === activeTab);
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.symbol.toLowerCase().includes(q) ||
        (u.urduName && u.urduName.includes(searchQuery.trim())) ||
        (u.description && u.description.toLowerCase().includes(q))
      );
    }
    return list;
  }, [allUnits, activeTab, searchQuery]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingUnitId(null);
    setIsFormOpen(false);
    setShowErrors(false);
  };

  const handleStartEdit = (unit: UnitDefinition) => {
    setEditingUnitId(unit.id);
    setFormData({
      name: unit.name,
      symbol: unit.symbol,
      type: unit.type || 'Count',
      factor: String(unit.factor || 1),
      urduName: unit.urduName || '',
      description: unit.description || ''
    });
    setShowErrors(false);
    setIsFormOpen(true);
  };

  // Products store the unit by its symbol; renaming or resizing one in use would silently change their stock meaning.
  const editingUnit = editingUnitId ? allUnits.find(u => u.id === editingUnitId) : undefined;
  const editingInUse = Boolean(editingUnit && (usageMap[editingUnit.symbol.toLowerCase()] || 0) > 0);
  const baseSymbolForType = formData.type === 'Volume' ? 'L' : formData.type === 'Mass' ? 'kg' : 'pcs';

  const name = formData.name.trim();
  const symbol = formData.symbol.trim();
  const factorNum = Number(formData.factor);
  // Built-in units count too: a custom "kg" next to the real kg would make every conversion ambiguous.
  const clash = symbol ? allUnits.find(u => u.id !== editingUnitId && u.symbol.toLowerCase() === symbol.toLowerCase()) : undefined;
  const errors = {
    name: !name ? 'Unit ka naam likhein.' : '',
    symbol: !symbol ? 'Symbol likhein.' : /\s/.test(symbol) ? 'Symbol mein space na rakhein.' : clash ? `"${clash.symbol}" pehle se hai (${clash.name}).` : '',
    factor: !(factorNum > 0) ? '0 se bara number likhein.' : '',
  };
  const hasErrors = Boolean(errors.name || errors.symbol || errors.factor);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (savingRef.current || !canManage) return;
    setShowErrors(true);
    if (hasErrors) return;

    savingRef.current = true;
    setSaving(true);
    try {
      if (editingUnitId) {
        const original = editingUnit;
        if (original && editingInUse && (symbol !== original.symbol || formData.type !== (original.type || 'Count') || factorNum !== Number(original.factor))) return;
        const ok = await updateUnit(editingUnitId, {
          name, symbol, type: formData.type, factor: factorNum, urduName: formData.urduName.trim(), description: formData.description.trim()
        });
        if (ok) resetForm();
      } else {
        const ok = await addUnit({
          name, symbol, type: formData.type, factor: factorNum, urduName: formData.urduName.trim(), description: formData.description.trim(), isBase: false, isSystem: false
        });
        if (ok) {
          onSelectUnit?.(symbol);
          resetForm();
        }
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (unit: UnitDefinition) => {
    const usageCount = usageMap[unit.symbol.toLowerCase()] || 0;
    if (usageCount > 0) {
      showToast(`Delete nahi ho sakta: ${usageCount} product(s) "${unit.symbol}" istemal kar rahe hain. Pehle un products ka unit badlein.`, 'warning');
      return;
    }
    if (await confirmAction({
      title: `Unit "${unit.name} (${unit.symbol})" delete karein?`,
      message: 'Koi product yeh unit istemal nahi kar raha.',
      consequences: ['Yeh unit list se hat jayega.', 'Yeh kaam wapas nahi ho sakta.'],
    })) {
      await deleteUnit(unit.id);
      if (editingUnitId === unit.id) resetForm();
    }
  };

  if (!isOpen) return null;

  const err = (key: keyof typeof errors) => (showErrors || (key === 'symbol' && clash) ? errors[key] : '') || undefined;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      icon={<div className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-muted"><Scale className="size-5" /></div>}
      title={<span className="flex items-center gap-2">Measurement units <Badge tone="neutral">{allUnits.length}</Badge></span>}
      description="Weight, liquid aur count ke base aur conversion units."
      footer={<>
        <p className="mr-auto hidden self-center text-xs text-fg-subtle sm:block">Jo unit products mein lage hain, unka symbol, type aur size nahi badalta.</p>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Band karein</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Naam, symbol ya Urdu se dhoondein..." aria-label="Units dhoondein" className="flex-1" />
          {canManage && (
            <Button
              variant={isFormOpen && !editingUnitId ? 'secondary' : 'primary'}
              leftIcon={<Plus />}
              onClick={() => {
                if (isFormOpen && !editingUnitId) resetForm();
                else { resetForm(); setIsFormOpen(true); }
              }}
            >
              {isFormOpen && !editingUnitId ? 'Form band karein' : 'Naya unit'}
            </Button>
          )}
        </div>

        {/* Pack sizes live on the product, not here */}
        <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <Info className="size-3.5 shrink-0" />
          Product ke pack sizes (dozen, tray, cup) us product ke Sell units tab mein add karein.
        </p>

        <SegmentedControl
          aria-label="Unit type"
          size="sm"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'All', label: 'All', icon: <SlidersHorizontal />, count: counts.All },
            { value: 'Volume', label: 'Liquid', icon: <Droplet />, count: counts.Volume },
            { value: 'Mass', label: 'Weight', icon: <Scale />, count: counts.Mass },
            { value: 'Count', label: 'Count', icon: <Boxes />, count: counts.Count },
            { value: 'Custom', label: 'Custom', icon: <Layers />, count: counts.Custom },
          ]}
        />

        {isFormOpen && canManage && (
          <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-card border border-line bg-surface-2/60 p-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-[15px] font-bold text-fg">
                {editingUnitId ? <Pencil className="size-4" /> : <Plus className="size-4" />}
                {editingUnitId ? `Edit: ${editingUnit?.name || 'unit'}` : 'Naya unit'}
              </h4>
              <Button size="sm" variant="ghost" onClick={resetForm} disabled={saving}>Cancel</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Naam" required error={err('name')}>
                {control => <Input {...control} value={formData.name} maxLength={40} placeholder="e.g. Maund, Gallon, Carton" onChange={e => setFormData({ ...formData, name: e.target.value })} />}
              </Field>
              <Field label="Symbol" required error={err('symbol')}>
                {control => <Input {...control} value={formData.symbol} maxLength={12} disabled={editingInUse} className="font-mono font-bold" placeholder="e.g. maund, gal, ctn" onChange={e => setFormData({ ...formData, symbol: e.target.value })} />}
              </Field>
              <Field label="Qisam" required>
                {control => (
                  <Select {...control} value={formData.type} disabled={editingInUse} onChange={e => setFormData({ ...formData, type: e.target.value as UnitForm['type'] })}>
                    <option value="Count">Count (pieces, packs, dozen)</option>
                    <option value="Mass">Weight (kg, gram, pao)</option>
                    <option value="Volume">Liquid (litre, ml)</option>
                  </Select>
                )}
              </Field>
              <Field label={`1 unit = kitne ${baseSymbolForType}`} required error={err('factor')}>
                {control => (
                  <Input {...control} type="number" inputMode="decimal" step="any" min="0.0001" value={formData.factor} disabled={editingInUse} suffix={baseSymbolForType}
                    className="font-mono font-bold" placeholder="e.g. 40, 24, 0.25" onWheel={e => e.currentTarget.blur()} onChange={e => setFormData({ ...formData, factor: e.target.value })} />
                )}
              </Field>
              <Field label="Urdu naam (optional)">
                {control => <Input {...control} dir="auto" value={formData.urduName} maxLength={40} onChange={e => setFormData({ ...formData, urduName: e.target.value })} />}
              </Field>
              <Field label="Note">
                {control => <Input {...control} value={formData.description} maxLength={80} placeholder="e.g. Carton mein 24 packs" onChange={e => setFormData({ ...formData, description: e.target.value })} />}
              </Field>
            </div>

            {editingInUse && (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-warning-fg"><Lock className="size-3" />Products mein istemal ho raha hai: symbol, qisam aur size lock hain.</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 text-fg-subtle"><Info className="size-4" />Hisaab</span>
              <span className="font-mono font-bold text-fg">1 {symbol || 'unit'} = {formData.factor || '1'} {baseSymbolForType}</span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={resetForm} disabled={saving}>Cancel</Button>
              <Button type="submit" loading={saving}>{editingUnitId ? 'Update unit' : 'Unit save karein'}</Button>
            </div>
          </form>
        )}

        {filteredUnits.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<Scale />}
            title="Koi unit nahi mila"
            description={canManage ? 'Search badlein ya upar se naya unit banayein.' : 'Search badal kar dekhein.'}
          />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {filteredUnits.map(unit => {
              const usageCount = usageMap[unit.symbol.toLowerCase()] || 0;
              const isSystem = Boolean(unit.isSystem);
              const role = describeUnitRole(unit);
              const TypeIcon = unit.type === 'Volume' ? Droplet : unit.type === 'Mass' ? Scale : Boxes;
              return (
                <div
                  key={unit.id}
                  className={cn(
                    'flex flex-col justify-between gap-3 rounded-card border bg-surface p-3.5 shadow-e1 transition-colors',
                    editingUnitId === unit.id ? 'border-brand-accent' : 'border-line hover:border-line-strong',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-fg">{unit.name}</span>
                        {unit.urduName && <span className="text-xs text-fg-subtle" dir="auto">({unit.urduName})</span>}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{unit.description || (isSystem ? 'Built-in unit' : 'Aap ka banaya unit')}</p>
                      <Badge tone={ROLE_TONE[role.role] || 'neutral'} className="mt-1.5 cursor-help" title={role.hint}>{role.label}</Badge>
                    </div>
                    <span className="shrink-0 rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs font-bold text-fg ring-1 ring-inset ring-line">{unit.symbol}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-2.5 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-fg-subtle">
                      <TypeIcon className="size-3.5 shrink-0" />
                      <span className="truncate font-mono font-semibold text-fg-muted">{getUnitFactorDescription(unit)}</span>
                      {usageCount > 0 && <Badge tone="neutral">{usageCount} {usageCount === 1 ? 'item' : 'items'}</Badge>}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      {onSelectUnit && (
                        <Button size="sm" variant="soft" onClick={() => { onSelectUnit(unit.symbol); onClose(); }}>Chunein</Button>
                      )}
                      {isSystem ? (
                        <span title="Built-in unit (protected)" className="flex size-8 items-center justify-center text-fg-faint"><Lock className="size-3.5" /></span>
                      ) : canManage && (
                        <>
                          <IconButton size="sm" aria-label={`${unit.name} edit karein`} icon={<Pencil />} onClick={() => handleStartEdit(unit)} />
                          <IconButton
                            size="sm"
                            aria-label={usageCount > 0 ? `${unit.name}: ${usageCount} products mein istemal, delete nahi hoga` : `${unit.name} delete karein`}
                            icon={<Trash2 />}
                            className="hover:bg-danger-soft hover:text-danger-fg"
                            onClick={() => handleDelete(unit)}
                          />
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
