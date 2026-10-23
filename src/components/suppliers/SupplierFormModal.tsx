import React, { useMemo, useRef, useState } from 'react';
import { MessageCircle, Truck } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { RateType, Supplier } from '../../types';
import { cleanNumber } from '../../lib/formatters';
import { Button, Field, Input, Label, Modal, SegmentedControl, Select, Textarea } from '../ui';
import { cn } from '../../lib/cn';
import { SupplierBalance, balanceLabel } from './supplierUi';

const CATEGORIES = [
  { key: 'Milk', label: 'Milk' },
  { key: 'Raw Material', label: 'Raw Material' },
  { key: 'Finished Products', label: 'Finished Goods' },
];

type Errors = Partial<Record<'name' | 'phone' | 'whatsapp' | 'types' | 'rate' | 'opening', string>>;

const digits = (value: string) => value.replace(/\D/g, '');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Add or edit a supplier profile. The khata balance is only set once, as the opening balance of a new supplier. */
export function SupplierFormModal({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { addSupplier, updateSupplier, items = [], suppliers = [] } = useDairy();
  const { showToast } = useToast();
  const editing = Boolean(supplier);

  const [name, setName] = useState(supplier?.name || '');
  const [phone, setPhone] = useState(supplier?.phone || '');
  const [phoneIsWhatsapp, setPhoneIsWhatsapp] = useState(() => (supplier ? Boolean(supplier.whatsapp && supplier.whatsapp === supplier.phone) : true));
  const [whatsapp, setWhatsapp] = useState(supplier?.whatsapp && supplier.whatsapp !== supplier.phone ? supplier.whatsapp : '');
  const [village, setVillage] = useState(supplier?.village || '');
  const [city, setCity] = useState(supplier?.city || '');
  const [address, setAddress] = useState(supplier?.address || '');
  const [types, setTypes] = useState<string[]>(supplier?.supplier_types?.length ? supplier.supplier_types : ['Milk']);
  const [milkType, setMilkType] = useState(String(supplier?.default_milk_type || ''));
  // Kept as text so "180." or "180.5" can be typed; parsed on save.
  const [rate, setRate] = useState(supplier?.default_rate ? String(supplier.default_rate) : '');
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingSide, setOpeningSide] = useState<'payable' | 'advance'>('payable');
  const [notes, setNotes] = useState(supplier?.notes || '');
  const [isActive, setIsActive] = useState(supplier ? supplier.isActive !== false : true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const isMilkVarietyActive = (variety: string) => {
    const v = (variety || '').toLowerCase();
    const item = items.find(i => {
      const itemName = (i.name || '').toLowerCase();
      const id = (i.id || '').toLowerCase();
      if (v === 'buffalo') return id === 'item_buffalo_milk' || itemName.includes('buffalo');
      if (v === 'cow') return id === 'item_cow_milk' || itemName.includes('cow');
      if (v === 'mixed') return id === 'item_mixed_milk' || itemName.includes('mixed');
      return itemName.includes(v) || id.includes(v);
    });
    return item ? item.isActive !== false : true;
  };

  const duplicate = useMemo(() => {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    return (suppliers || []).find(s => s.id !== supplier?.id && (s.name || '').trim().toLowerCase() === key) || null;
  }, [name, suppliers, supplier?.id]);

  const clearError = (key: keyof Errors) => setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev));

  const toggleType = (key: string) => {
    setTypes(current => (current.includes(key) ? current.filter(t => t !== key) : [...current, key]));
    clearError('types');
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Supplier ka naam zaroori hai';
    if (phone.trim() && digits(phone).length < 7) next.phone = 'Sahi phone number likhein';
    if (!phoneIsWhatsapp && whatsapp.trim() && digits(whatsapp).length < 7) next.whatsapp = 'Sahi WhatsApp number likhein';
    if (types.length === 0) next.types = 'Kam az kam ek category chunein';
    const rateNum = Number(rate);
    if (rate.trim() && (!Number.isFinite(rateNum) || rateNum < 0)) next.rate = 'Rate 0 ya us se zyada ho';
    if (!editing && openingAmount.trim()) {
      const opening = Number(openingAmount);
      if (!Number.isFinite(opening) || opening < 0) next.opening = 'Sahi amount likhein (minus ki zaroorat nahi, upar Payable / Advance chunein)';
    }
    return next;
  };

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (savingRef.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.name) nameRef.current?.focus();
      return;
    }

    const trimmedPhone = phone.trim();
    const parsedRate = cleanNumber(rate);
    const opening = cleanNumber(openingAmount);
    // Only the fields this form owns are sent, so derived totals on the record are never rewritten.
    const profile = {
      name: name.trim(),
      phone: trimmedPhone,
      whatsapp: (phoneIsWhatsapp ? trimmedPhone : whatsapp.trim()) || undefined,
      village: village.trim() || undefined,
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      default_rate: parsedRate,
      rate_type: parsedRate > 0 ? RateType.FIXED : (supplier?.rate_type || RateType.FAT_SNF),
      supplier_types: types,
      default_milk_type: types.includes('Milk') ? milkType : (supplier?.default_milk_type || ''),
      notes: notes.trim() || undefined,
      isActive,
    };

    savingRef.current = true;
    setSaving(true);
    try {
      // DairyContext toasts failures and a new supplier; a profile update succeeds quietly there.
      if (editing && supplier) {
        const ok = await updateSupplier(supplier.id, profile);
        if (!ok) return;
        showToast('Supplier update ho gaya', 'success');
      } else {
        const ok = await addSupplier({ ...profile, pending_balance: openingSide === 'advance' ? -opening : opening } as Omit<Supplier, 'id'>);
        if (!ok) return;
      }
      onClose();
    } catch (err: any) {
      showToast('Supplier save nahi hua: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const currentBalance = Number(supplier?.pending_balance) || 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      initialFocusRef={nameRef}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><Truck className="size-5" /></span>}
      title={editing ? 'Supplier profile edit karein' : 'Naya supplier'}
      description="Contact, supply category, rate aur khata"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="supplier-profile-form" loading={saving}>
            {saving ? 'Saving...' : editing ? 'Update profile' : 'Save supplier'}
          </Button>
        </>
      }
    >
      <form id="supplier-profile-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
        <Section title="Contact">
          <Field
            label="Supplier / farm ka naam"
            required
            error={errors.name}
            hint={duplicate ? `"${duplicate.name}" naam ka supplier pehle se hai${duplicate.isActive === false ? ' (inactive)' : ''}.` : undefined}
          >
            {control => (
              <Input {...control} ref={nameRef} value={name} placeholder="e.g. Al-Madina Dairy Farm" maxLength={120} onChange={e => { setName(e.target.value); clearError('name'); }} />
            )}
          </Field>

          <Field label="Phone" error={errors.phone}>
            {control => (
              <div className="flex gap-2">
                <Input {...control} type="tel" inputMode="tel" value={phone} placeholder="0300-1234567" className="tabular-nums" onChange={e => { setPhone(e.target.value); clearError('phone'); }} />
                <Button
                  variant={phoneIsWhatsapp ? 'soft' : 'secondary'}
                  leftIcon={<MessageCircle />}
                  aria-pressed={phoneIsWhatsapp}
                  onClick={() => setPhoneIsWhatsapp(v => !v)}
                  className="shrink-0"
                  title={phoneIsWhatsapp ? 'Yehi number WhatsApp hai' : 'WhatsApp alag number par hai'}
                >
                  {phoneIsWhatsapp ? 'WhatsApp' : 'Alag WA'}
                </Button>
              </div>
            )}
          </Field>
          {!phoneIsWhatsapp && (
            <Field label="WhatsApp number" error={errors.whatsapp} hint="Statement aur milk slip isi number par bheji jayegi">
              {control => <Input {...control} type="tel" inputMode="tel" value={whatsapp} placeholder="0300-1234567" className="tabular-nums" onChange={e => { setWhatsapp(e.target.value); clearError('whatsapp'); }} />}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Town / village">
              {control => <Input {...control} value={village} placeholder="e.g. Chak 123" onChange={e => setVillage(e.target.value)} />}
            </Field>
            <Field label="City">
              {control => <Input {...control} value={city} placeholder="e.g. Shorkot" onChange={e => setCity(e.target.value)} />}
            </Field>
          </div>
          <Field label="Address">
            {control => <Input {...control} value={address} placeholder="Gali, farm, nishani..." onChange={e => setAddress(e.target.value)} />}
          </Field>
        </Section>

        <Section title="Supply aur rate">
          <div>
            <Label>Supply category<span className="ml-0.5 text-danger" aria-hidden="true">*</span></Label>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Supply category">
              {CATEGORIES.map(cat => {
                const selected = types.includes(cat.key);
                return (
                  <button
                    key={cat.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleType(cat.key)}
                    className={cn(
                      'h-10 cursor-pointer rounded-control border px-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected ? 'border-brand-accent bg-brand-soft text-brand-fg' : 'border-line bg-surface text-fg-muted hover:bg-surface-2'
                    )}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
            {errors.types && <p className="mt-1.5 text-xs font-semibold text-danger-fg">{errors.types}</p>}
          </div>

          {types.includes('Milk') && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default milk">
                {control => (
                  <Select {...control} value={milkType} onChange={e => setMilkType(e.target.value)}>
                    <option value="">Chunein...</option>
                    {isMilkVarietyActive('Buffalo') && <option value="Buffalo">Buffalo milk</option>}
                    {isMilkVarietyActive('Cow') && <option value="Cow">Cow milk</option>}
                    {isMilkVarietyActive('Mixed') && <option value="Mixed">Mixed milk</option>}
                    {milkType && !isMilkVarietyActive(milkType) && <option value={milkType}>{milkType} milk (inactive)</option>}
                  </Select>
                )}
              </Field>
              <Field label="Rate / litre" error={errors.rate} hint="Khali = FAT/SNF chart">
                {control => (
                  <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix="Rs" placeholder="e.g. 180" className="tabular-nums" value={rate} onChange={e => { setRate(e.target.value); clearError('rate'); }} />
                )}
              </Field>
            </div>
          )}
        </Section>

        <Section title={editing ? 'Khata balance' : 'Opening balance'}>
          {editing ? (
            <div className="rounded-control border border-line bg-surface-2 px-3.5 py-3">
              <p className="flex items-center justify-between gap-3 text-sm font-bold">
                <span className="text-fg-muted">{balanceLabel(currentBalance, true)}</span>
                <SupplierBalance value={currentBalance} label="none" />
              </p>
              <p className="mt-1 text-[11px] text-fg-subtle">Balance yahan se nahi badalta. Purchase, payment ya return se khud update hota hai.</p>
            </div>
          ) : (
            <>
              <SegmentedControl
                aria-label="Opening balance type"
                size="sm"
                value={openingSide}
                onChange={setOpeningSide}
                options={[
                  { value: 'payable', label: 'Payable · hum ne dena hai' },
                  { value: 'advance', label: 'Advance · hum ne diya hua' },
                ]}
              />
              <Field label="Amount" error={errors.opening} hint="Pehle se chalta hisaab ho to likhein, warna khali chhor dein">
                {control => (
                  <Input {...control} type="number" inputMode="decimal" min="0" step="any" suffix="Rs" placeholder="0" className="tabular-nums" value={openingAmount} onChange={e => { setOpeningAmount(e.target.value); clearError('opening'); }} />
                )}
              </Field>
            </>
          )}
        </Section>

        <Section title="Notes aur status">
          <Field label="Notes">
            {control => <Textarea {...control} rows={2} value={notes} placeholder="Contact person, delivery time, khaas hidayat..." onChange={e => setNotes(e.target.value)} />}
          </Field>
          <label className="flex cursor-pointer items-center gap-3 rounded-control border border-line bg-surface-2 px-3.5 py-3 text-[13px] font-semibold text-fg">
            <input type="checkbox" className="size-4 cursor-pointer accent-brand" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            Active: milk / material purchase mein nazar aaye
          </label>
        </Section>
      </form>
    </Modal>
  );
}

export default SupplierFormModal;
