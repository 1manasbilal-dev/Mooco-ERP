import React, { useMemo, useRef, useState } from 'react';
import { Plus, UserPlus, UserCog, X } from 'lucide-react';
import { Button, Field, IconButton, Input, Modal, SegmentedControl, Textarea } from '../ui';
import { formatCurrency } from '../../lib/formatters';
import type { Customer } from '../../types';
import { CheckRow } from './CustomerBits';
import { balanceState, canonicalPhone, customerPhones, parseAmount } from './customerUtils';

export interface AdditionalPhone {
  phone: string;
  is_whatsapp: boolean;
  label: string;
}

export interface CustomerPayload {
  name: string;
  phone: string;
  is_phone_whatsapp: boolean;
  whatsapp: string;
  additional_phones: AdditionalPhone[];
  address: string;
  city: string;
  /** Opening balance for a new customer: positive = due, negative = advance. Ignored on edit. */
  balance: number;
  notes: string;
  isActive: boolean;
}

interface CustomerFormModalProps {
  customer: Customer | null;
  customers: Customer[];
  onClose: () => void;
  /** Resolves true when saved; the modal stays open on false so nothing typed is lost. */
  onSubmit: (payload: CustomerPayload) => Promise<boolean>;
}

const FORM_ID = 'customer-form';

export default function CustomerFormModal({ customer, customers, onClose, onSubmit }: CustomerFormModalProps) {
  const editing = Boolean(customer);
  const [name, setName] = useState(customer?.name || '');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [isPhoneWhatsApp, setIsPhoneWhatsApp] = useState(
    customer ? (customer.is_phone_whatsapp !== undefined ? customer.is_phone_whatsapp : Boolean(customer.whatsapp && customer.whatsapp === customer.phone)) : true,
  );
  const [whatsapp, setWhatsapp] = useState(customer?.whatsapp || '');
  const [extraPhones, setExtraPhones] = useState<AdditionalPhone[]>(() =>
    customer ? customerPhones(customer).map(p => ({ phone: p.phone, is_whatsapp: Boolean(p.is_whatsapp), label: p.label || 'Secondary' })) : [],
  );
  const [city, setCity] = useState(customer?.city || '');
  const [address, setAddress] = useState(customer?.address || '');
  const [notes, setNotes] = useState(customer?.notes || '');
  const [isActive, setIsActive] = useState(customer ? customer.isActive !== false : true);
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingSide, setOpeningSide] = useState<'due' | 'advance'>('due');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Other customers by phone, for the "already saved under X" hint.
  const phoneOwners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) {
      if (!c || c.id === customer?.id) continue;
      [c.phone, c.whatsapp].forEach(p => {
        const key = canonicalPhone(p);
        if (key.length >= 7 && !map.has(key)) map.set(key, c.name);
      });
    }
    return map;
  }, [customers, customer?.id]);

  const duplicateOf = (value: string) => {
    const key = canonicalPhone(value);
    return key.length >= 7 ? phoneOwners.get(key) : undefined;
  };

  const nameError = submitted && !name.trim() ? 'Customer ka naam zaroori hai' : undefined;
  const opening = openingAmount.trim() === '' || Number(openingAmount.replace(/,/g, '')) === 0
    ? { value: 0 }
    : parseAmount(openingAmount);
  const openingError = !editing && opening.error ? opening.error : undefined;
  const phoneOwner = duplicateOf(phone);
  const whatsappOwner = !isPhoneWhatsApp ? duplicateOf(whatsapp) : undefined;
  const openBalance = customer ? balanceState(customer.balance) : 'settled';

  const updateExtra = (index: number, patch: Partial<AdditionalPhone>) =>
    setExtraPhones(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (savingRef.current) return;
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (openingError) return;

    const payload: CustomerPayload = {
      name: name.trim(),
      phone: phone.trim(),
      is_phone_whatsapp: isPhoneWhatsApp,
      whatsapp: isPhoneWhatsApp ? phone.trim() : whatsapp.trim(),
      additional_phones: extraPhones.map(p => ({ ...p, phone: p.phone.trim(), label: p.label.trim() || 'Secondary' })).filter(p => p.phone !== ''),
      address: address.trim(),
      city: city.trim(),
      balance: editing ? Number(customer?.balance || 0) : openingSide === 'advance' ? -opening.value : opening.value,
      notes: notes.trim(),
      isActive,
    };

    savingRef.current = true;
    setSaving(true);
    try {
      await onSubmit(payload);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dismissible={!saving}
      initialFocusRef={nameRef}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg">{editing ? <UserCog size={20} /> : <UserPlus size={20} />}</span>}
      title={editing ? 'Customer edit karein' : 'Naya customer'}
      description={editing ? customer?.name : 'Naam zaroori hai, baqi sab baad mein bhi bhar sakte hain.'}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form={FORM_ID} loading={saving}>{editing ? 'Update customer' : 'Save customer'}</Button>
      </>}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Customer name" required error={nameError}>
          {control => <Input {...control} ref={nameRef} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Haji Muhammad Ali" autoComplete="off" />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary phone" hint={phoneOwner ? `Ye number pehle se "${phoneOwner}" ke naam hai` : undefined}>
            {control => <Input {...control} type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="03001234567" />}
          </Field>
          {!isPhoneWhatsApp && (
            <Field label="WhatsApp number" hint={whatsappOwner ? `Ye number pehle se "${whatsappOwner}" ke naam hai` : undefined}>
              {control => <Input {...control} type="tel" inputMode="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="03001234567" />}
            </Field>
          )}
        </div>
        <CheckRow id="customer-phone-is-whatsapp" checked={isPhoneWhatsApp} onChange={setIsPhoneWhatsApp} label="Primary phone WhatsApp bhi hai" />

        {extraPhones.map((item, index) => (
          <div key={index} className="space-y-3 rounded-control border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-fg-muted">Secondary contact #{index + 1}</span>
              <IconButton size="sm" aria-label="Ye number hatayen" icon={<X />} onClick={() => setExtraPhones(prev => prev.filter((_, i) => i !== index))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">
                {control => <Input {...control} type="tel" inputMode="tel" value={item.phone} onChange={e => updateExtra(index, { phone: e.target.value })} placeholder="Phone number" />}
              </Field>
              <Field label="Label">
                {control => <Input {...control} value={item.label} onChange={e => updateExtra(index, { label: e.target.value })} placeholder="Home, Brother..." />}
              </Field>
            </div>
            <CheckRow id={`customer-extra-wa-${index}`} checked={item.is_whatsapp} onChange={checked => updateExtra(index, { is_whatsapp: checked })} label="WhatsApp hai" />
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus />}
          onClick={() => setExtraPhones(prev => [...prev, { phone: '', is_whatsapp: false, label: 'Secondary' }])}
        >
          Aur phone number
        </Button>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City / area">
            {control => <Input {...control} value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Lahore" />}
          </Field>
          <Field label="Complete address">
            {control => <Input {...control} value={address} onChange={e => setAddress(e.target.value)} placeholder="Shop #, street, colony..." />}
          </Field>
        </div>

        {editing ? (
          <div className="rounded-control border border-line bg-surface-2 px-3 py-2.5 text-xs text-fg-subtle">
            <span className="font-semibold text-fg-muted">Current balance: {formatCurrency(Math.abs(Number(customer?.balance || 0)))}{' '}
              {openBalance === 'due' ? 'Due' : openBalance === 'advance' ? 'Advance' : 'Settled'}
            </span>
            <span className="mt-0.5 block">Balance khaate ki entries (Payment / Charge) se badalta hai, yahan se nahi.</span>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label="Opening balance (sabqa baqaya)" error={openingError} hint={!openingError ? 'Khali chhor dein agar purana hisaab nahi' : undefined}>
              {control => (
                <Input {...control} inputMode="decimal" value={openingAmount} onChange={e => setOpeningAmount(e.target.value)} placeholder="0" suffix="Rs" />
              )}
            </Field>
            <SegmentedControl<'due' | 'advance'>
              aria-label="Opening balance type"
              value={openingSide}
              onChange={setOpeningSide}
              className="sm:mb-[22px]"
              options={[
                { value: 'due', label: 'Customer ne dena hai' },
                { value: 'advance', label: 'Advance diya hai' },
              ]}
            />
          </div>
        )}

        <Field label="Notes / remarks">
          {control => <Textarea {...control} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery timing, special instructions..." />}
        </Field>

        <CheckRow
          id="customer-is-active"
          checked={isActive}
          onChange={setIsActive}
          label="Active customer account"
          hint={editing && !isActive && openBalance !== 'settled'
            ? `Is customer ka ${formatCurrency(Math.abs(Number(customer?.balance || 0)))} ${openBalance === 'due' ? 'baqaya' : 'advance'} hai. Inactive karne se khata wahi rahega, sirf POS aur lists se chhup jayega.`
            : 'Inactive customer POS aur routes mein nazar nahi aata.'}
        />
      </form>
    </Modal>
  );
}
