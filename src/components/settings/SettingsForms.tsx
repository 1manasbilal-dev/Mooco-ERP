import React, { useState } from 'react';
import { BadgePercent, Banknote, Building2, Clock, Hash, Info, Landmark, Lock, MonitorSmartphone, Package, Plus, Printer, ReceiptText, ShieldCheck, Timer, Undo2, X } from 'lucide-react';
import { FinancialAccount, SystemSettings } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { Button, Field, Input, Select, Textarea } from '../ui';
import { Notice, Section, TabHeader, Toggle } from './SettingsUI';

// The settings a Settings tab edits as one unsaved draft. Units, expense categories and other
// lists that other pages manage are not part of it, so saving here never overwrites them.
export interface SettingsDraft {
  general: Pick<SystemSettings['general'], 'companyName' | 'address' | 'phone' | 'email' | 'taxId'> & { shifts: string[] };
  financial: SystemSettings['financial'];
  sales: { invoicePrefix: string; invoiceFooter: string; showPosSearch: boolean; showPosCategories: boolean };
  inventory: { allowNegativeStock: boolean };
  security: { lockDate: string; autoLockMinutes: number; maxDiscountPercent: number | null; returnNeedsApproval: boolean };
}

export const draftFromSettings = (s: SystemSettings): SettingsDraft => ({
  general: {
    companyName: s.general.companyName || '',
    address: s.general.address || '',
    phone: s.general.phone || '',
    email: s.general.email || '',
    taxId: s.general.taxId || '',
    shifts: s.general.shifts?.length ? [...s.general.shifts] : ['Morning', 'Evening'],
  },
  financial: {
    defaultCashAccountId: s.financial.defaultCashAccountId || '',
    defaultDigitalAccountId: s.financial.defaultDigitalAccountId || '',
  },
  sales: {
    invoicePrefix: s.sales.invoicePrefix ?? 'INV-',
    invoiceFooter: s.sales.invoiceFooter || '',
    showPosSearch: s.sales.showPosSearch !== false,
    showPosCategories: s.sales.showPosCategories !== false,
  },
  inventory: { allowNegativeStock: s.inventory.allowNegativeStock !== false },
  security: {
    lockDate: s.security?.lockDate || '',
    autoLockMinutes: Number(s.security?.autoLockMinutes) || 0,
    maxDiscountPercent: typeof s.security?.maxDiscountPercent === 'number' ? s.security.maxDiscountPercent : null,
    returnNeedsApproval: !!s.security?.returnNeedsApproval,
  },
});

export type FieldKey = 'companyName' | 'email' | 'invoicePrefix' | 'lockDate' | 'maxDiscountPercent' | 'autoLockMinutes';
export type FieldErrors = Partial<Record<FieldKey, string>>;
/** Which tab holds each field, so Save can open the tab with the first problem. */
export const FIELD_TAB: Record<FieldKey, 'business' | 'sales' | 'security'> = {
  companyName: 'business', email: 'business', invoicePrefix: 'sales', lockDate: 'security', maxDiscountPercent: 'security', autoLockMinutes: 'security',
};

/** Every problem that blocks saving, per field, in plain words (in the order a person reads the tabs). */
export function validateFields(d: SettingsDraft, today: string): FieldErrors {
  const e: FieldErrors = {};
  if (!d.general.companyName.trim()) e.companyName = 'Business ka naam zaroori hai.';
  if (d.general.email.trim() && !/^\S+@\S+\.\S+$/.test(d.general.email.trim())) e.email = 'Email sahi nahi lag raha (misal: info@mooco.pk).';
  if (d.sales.invoicePrefix.trim().length > 8) e.invoicePrefix = 'Bill prefix 8 huroof se zyada nahi ho sakta.';
  if (d.security.lockDate && d.security.lockDate > today) e.lockDate = 'Lock date aaj se aage ki nahi ho sakti.';
  if (d.security.maxDiscountPercent !== null && (!Number.isFinite(d.security.maxDiscountPercent) || d.security.maxDiscountPercent < 0 || d.security.maxDiscountPercent > 100)) e.maxDiscountPercent = 'Discount limit 0 se 100% ke darmiyan honi chahiye.';
  if (d.security.autoLockMinutes < 0 || d.security.autoLockMinutes > 240) e.autoLockMinutes = 'Auto-lock 0 se 240 minute tak ho sakta hai.';
  return e;
}

/** First problem that blocks saving, or null. */
export function validateDraft(d: SettingsDraft, today: string): string | null {
  return Object.values(validateFields(d, today))[0] || null;
}

/** What gets sent to updateSettings: partial sections, merged over the stored ones. */
export const draftToSettings = (d: SettingsDraft): Partial<SystemSettings> => ({
  general: { ...d.general, companyName: d.general.companyName.trim(), email: d.general.email.trim() } as SystemSettings['general'],
  financial: d.financial,
  sales: { ...d.sales, invoicePrefix: d.sales.invoicePrefix.trim() } as SystemSettings['sales'],
  inventory: d.inventory as SystemSettings['inventory'],
  security: {
    lockDate: d.security.lockDate || undefined,
    autoLockMinutes: d.security.autoLockMinutes || 0,
    maxDiscountPercent: d.security.maxDiscountPercent ?? undefined,
    returnNeedsApproval: d.security.returnNeedsApproval,
  },
});

type Patch = <K extends keyof SettingsDraft>(section: K, patch: Partial<SettingsDraft[K]>) => void;

interface TabProps {
  draft: SettingsDraft;
  patch: Patch;
  readOnly: boolean;
  errors?: FieldErrors;
}

const FOOTER_MAX = 160;
const NO_ERRORS: FieldErrors = {};

export const BusinessTab: React.FC<TabProps> = ({ draft, patch, readOnly, errors = NO_ERRORS }) => {
  const g = draft.general;
  return (
    <div className="space-y-4">
      <TabHeader title="Business Profile" description="Ye maloomat bills, receipts aur khata statements par chhapti hai." />
      <Section title="Business details" description="Naam aur rabta jo customer apni receipt par dekhta hai." icon={<Building2 />}>
        <Field label="Business name" required error={errors.companyName}>
          {c => <Input {...c} disabled={readOnly} value={g.companyName} onChange={e => patch('general', { companyName: e.target.value })} placeholder="Mooco Dairy" autoComplete="organization" />}
        </Field>
        <Field label="Address">
          {c => <Input {...c} disabled={readOnly} value={g.address} onChange={e => patch('general', { address: e.target.value })} placeholder="Shop #12, Main Market, City" autoComplete="street-address" />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone">
            {c => <Input {...c} disabled={readOnly} value={g.phone} onChange={e => patch('general', { phone: e.target.value })} placeholder="0300-1234567" inputMode="tel" autoComplete="tel" />}
          </Field>
          <Field label="Email" error={errors.email}>
            {c => <Input {...c} type="email" disabled={readOnly} value={g.email} onChange={e => patch('general', { email: e.target.value })} placeholder="info@mooco.pk" autoComplete="email" />}
          </Field>
        </div>
      </Section>
      <Section title="Tax registration" description="Khali chhorein to receipt par nahi chhapega." icon={<ReceiptText />}>
        <Field label="NTN / STRN" hint="Receipt ke upar business ke naam ke neeche chhapta hai.">
          {c => <Input {...c} disabled={readOnly} value={g.taxId} onChange={e => patch('general', { taxId: e.target.value })} placeholder="1234567-8" className="max-w-xs" />}
        </Field>
      </Section>
    </div>
  );
};

export const SalesTab: React.FC<TabProps> = ({ draft, patch, readOnly, errors = NO_ERRORS }) => {
  const { general: g, sales } = draft;
  return (
    <div className="space-y-4">
      <TabHeader title="Sales & Receipts" description="Bill numbering, receipt ka footer aur POS counter ki screen." />
      <Section title="Bill numbering" description="Har naye POS bill ke number se pehle lagta hai." icon={<Hash />}>
        <Field label="Bill prefix" error={errors.invoicePrefix} hint={<>Misal: <span className="font-mono">{(sales.invoicePrefix || 'INV-')}00042</span></>}>
          {c => <Input {...c} className="max-w-[12rem] font-mono" maxLength={8} disabled={readOnly} value={sales.invoicePrefix} onChange={e => patch('sales', { invoicePrefix: e.target.value.toUpperCase() })} placeholder="INV-" />}
        </Field>
      </Section>
      <Section title="Receipt" description="Receipt ke aakhir mein chhapne wala paigham." icon={<Printer />}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <Field label="Receipt footer" hint={`${sales.invoiceFooter.length}/${FOOTER_MAX}`}>
            {c => <Textarea {...c} rows={3} className="resize-none" maxLength={FOOTER_MAX} disabled={readOnly} value={sales.invoiceFooter} onChange={e => patch('sales', { invoiceFooter: e.target.value })} placeholder="Thank you for your visit!" />}
          </Field>
          <ReceiptPreview draft={draft} />
        </div>
      </Section>
      <Section title="POS screen" description="Counter par kya nazar aaye." icon={<MonitorSmartphone />}>
        <Toggle label="Product search bar" description="Band karne se products ke liye zyada jagah milti hai." checked={sales.showPosSearch} disabled={readOnly} onChange={v => patch('sales', { showPosSearch: v })} />
        <Toggle label="Category filters" description="Products ke upar category buttons." checked={sales.showPosCategories} disabled={readOnly} onChange={v => patch('sales', { showPosCategories: v })} />
      </Section>
      {!g.companyName.trim() && <Notice tone="warning">Business Profile mein naam likhein, warna receipt par default naam chhapega.</Notice>}
    </div>
  );
};

// A paper receipt: it stays white with dark ink in both themes, like the printout.
const ReceiptPreview: React.FC<{ draft: SettingsDraft }> = ({ draft }) => {
  const { general: g, sales } = draft;
  return (
    <div aria-label="Receipt preview" className="self-start rounded-card bg-surface-2 p-3 ring-1 ring-inset ring-line">
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-subtle"><Printer size={12} aria-hidden="true" /> Preview</div>
      <div className="space-y-1.5 rounded-lg p-3 font-mono text-[10px] shadow-e1" style={{ background: '#fff', color: '#1e293b' }}>
        <div className="border-b border-dashed pb-1.5 text-center" style={{ borderColor: '#cbd5e1' }}>
          <div className="text-xs font-black uppercase">{g.companyName || 'Mooco Dairy'}</div>
          {g.address && <div style={{ color: '#64748b' }}>{g.address}</div>}
          {g.phone && <div style={{ color: '#64748b' }}>Ph: {g.phone}</div>}
          {g.taxId && <div style={{ color: '#64748b' }}>NTN: {g.taxId}</div>}
        </div>
        <div className="flex justify-between" style={{ color: '#64748b' }}><span>{sales.invoicePrefix || 'INV-'}00042</span><span>10:30</span></div>
        <div className="flex justify-between"><span>Milk 2 L</span><span>440</span></div>
        <div className="flex justify-between"><span>Yogurt 1 kg</span><span>350</span></div>
        <div className="flex justify-between border-t border-dashed pt-1 font-bold" style={{ borderColor: '#cbd5e1' }}><span>TOTAL</span><span>{formatCurrency(790)}</span></div>
        <div className="border-t pt-1.5 text-center italic" style={{ borderColor: '#e2e8f0', color: '#64748b' }}>{sales.invoiceFooter || 'Thank you for your visit!'}</div>
      </div>
    </div>
  );
};

export const PaymentsTab: React.FC<TabProps & { accounts: FinancialAccount[] }> = ({ draft, patch, readOnly, accounts }) => {
  const active = accounts.filter(a => a.isActive !== false);
  const cash = active.filter(a => a.type === 'Cash');
  const digital = active.filter(a => a.type === 'Bank' || a.type === 'Wallet');
  const label = (a: FinancialAccount) => `${a.name}${a.bank_name ? ` · ${a.bank_name}` : ''} (${formatCurrency(Number(a.balance || 0))})`;
  // A default that was closed or deleted would otherwise show as "Chunein" while still being saved.
  const missing = (id: string, list: FinancialAccount[]) => Boolean(id) && accounts.length > 0 && !list.some(a => a.id === id);
  return (
    <div className="space-y-4">
      <TabHeader title="Payments & Accounts" description="Paisa kis account mein jaye jab entry par account alag se na chuna jaye." />
      <Section title="Cash" description="POS cash bills, khata ki cash wasooli aur suppliers ko cash payment." icon={<Banknote />}>
        <Field label="Default cash account" error={missing(draft.financial.defaultCashAccountId, cash) ? 'Ye account ab list mein nahi (band ya delete). Koi aur chunein.' : undefined}>
          {c => (
            <Select {...c} className="max-w-md" disabled={readOnly} value={draft.financial.defaultCashAccountId} onChange={e => patch('financial', { defaultCashAccountId: e.target.value })}>
              <option value="">— Chunein —</option>
              {missing(draft.financial.defaultCashAccountId, cash) && <option value={draft.financial.defaultCashAccountId}>Purana account (band)</option>}
              {cash.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </Select>
          )}
        </Field>
      </Section>
      <Section title="Bank & wallet" description="Online / bank transfer, QR aur delivery app ki online payments." icon={<Landmark />}>
        <Field label="Default bank / wallet" error={missing(draft.financial.defaultDigitalAccountId, digital) ? 'Ye account ab list mein nahi (band ya delete). Koi aur chunein.' : undefined}>
          {c => (
            <Select {...c} className="max-w-md" disabled={readOnly} value={draft.financial.defaultDigitalAccountId} onChange={e => patch('financial', { defaultDigitalAccountId: e.target.value })}>
              <option value="">— Chunein —</option>
              {missing(draft.financial.defaultDigitalAccountId, digital) && <option value={draft.financial.defaultDigitalAccountId}>Purana account (band)</option>}
              {digital.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
            </Select>
          )}
        </Field>
        {digital.length === 0 && <Notice icon={<Info />}>Koi bank ya wallet account nahi bana. Bank & Cash page se account banayein.</Notice>}
      </Section>
    </div>
  );
};

const SHIFT_MAX = 20;

export const OperationsTab: React.FC<TabProps & { onOpenItems: () => void }> = ({ draft, patch, readOnly, onOpenItems }) => {
  const [newShift, setNewShift] = useState('');
  const shifts = draft.general.shifts;
  const name = newShift.trim();
  const duplicate = Boolean(name) && shifts.some(s => s.toLowerCase() === name.toLowerCase());
  const addShift = () => {
    if (!name || duplicate) return;
    patch('general', { shifts: [...shifts, name] });
    setNewShift('');
  };
  return (
    <div className="space-y-4">
      <TabHeader title="Inventory & Milk" description="Stock ke qawaid aur doodh ki collection ki shifts." />
      <Section title="Stock" description="Jab system mein stock khatam ho magar counter par maal mojood ho." icon={<Package />}>
        <Toggle
          label="Stock 0 hone par bhi bechne dein"
          description="On: counter kabhi nahi rukta, stock minus mein chala jata hai. Off: stock khatam hone par bill nahi banega."
          checked={draft.inventory.allowNegativeStock}
          disabled={readOnly}
          onChange={v => patch('inventory', { allowNegativeStock: v })}
        />
        <Notice icon={<Info />}>
          Har product ki low-stock hadd aur units (kg, L, pao, pack) <button type="button" onClick={onOpenItems} className="font-bold underline underline-offset-2">Products</button> page par set hoti hain.
        </Notice>
      </Section>
      <Section title="Milk collection shifts" description="Suppliers se doodh lene ke waqt — Milk Intake mein ye options aate hain." icon={<Clock />}>
        <ul className="flex flex-wrap gap-2" aria-label="Shifts">
          {shifts.map(shift => (
            <li key={shift} className="inline-flex h-9 items-center gap-1.5 rounded-control bg-surface-2 pl-3 pr-1.5 text-sm font-semibold text-fg ring-1 ring-inset ring-line">
              <Clock size={13} className="text-brand-accent" aria-hidden="true" />
              {shift}
              {!readOnly && shifts.length > 1 ? (
                <button type="button" aria-label={`${shift} shift hatayein`} onClick={() => patch('general', { shifts: shifts.filter(s => s !== shift) })}
                  className="flex size-6 items-center justify-center rounded-md text-fg-faint hover:bg-danger-soft hover:text-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X size={14} />
                </button>
              ) : <span className="w-1.5" />}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <Field label="Nayi shift" error={duplicate ? 'Ye shift pehle se list mein hai.' : undefined} className="max-w-sm">
            {c => (
              <div className="flex gap-2">
                <Input {...c} value={newShift} maxLength={SHIFT_MAX} onChange={e => setNewShift(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addShift(); } }} placeholder="e.g. Dopehar" />
                <Button variant="secondary" leftIcon={<Plus />} onClick={addShift} disabled={!name || duplicate}>Add</Button>
              </div>
            )}
          </Field>
        )}
      </Section>
    </div>
  );
};

export const SecurityTab: React.FC<TabProps & { today: string; savedLockDate: string }> = ({ draft, patch, readOnly, today, savedLockDate, errors = NO_ERRORS }) => {
  const sec = draft.security;
  return (
    <div className="space-y-4">
      <TabHeader title="Security & Controls" description="Hisaab ko mehfooz rakhne aur staff ke ikhtiyar ki hadd." />
      {readOnly && <Notice tone="info" icon={<Lock />}>Ye settings sirf Owner badal sakta hai.</Notice>}

      <Section title="Lock date (books close)" description="Is tareekh tak ki koi entry add, edit ya delete nahi ho sakegi — bills, purchases, kharche, payments, journal sab." icon={<Lock />}>
        <Field label="Books band hain is tareekh tak (shamil)" error={errors.lockDate} hint={savedLockDate ? `Abhi ${savedLockDate} tak band hain.` : 'Abhi koi lock nahi.'}>
          {c => (
            <div className="flex max-w-sm gap-2">
              <Input {...c} type="date" max={today} disabled={readOnly} value={sec.lockDate} onChange={e => patch('security', { lockDate: e.target.value })} />
              {sec.lockDate && !readOnly && <Button variant="secondary" onClick={() => patch('security', { lockDate: '' })}>Hatayein</Button>}
            </div>
          )}
        </Field>
        <Notice tone="warning" icon={<ShieldCheck />}>
          Mahina ya saal band karte waqt lagayein, jab hisaab check ho chuka ho. Ghalti theek karni ho to pehle lock date peeche karein.
        </Notice>
      </Section>

      <Section title="Discount limit" description="Cashier is had tak khud discount de sakta hai. Zyada ho to manager PIN maanga jayega." icon={<BadgePercent />}>
        <Field label="Zyada se zyada discount (% of bill)" error={errors.maxDiscountPercent} hint="Khali chhorein = koi limit nahi. Jis role ke paas 'Give discount' nahi, us se har discount par PIN maanga jata hai.">
          {c => (
            // The width sits on the wrapper so the "%" suffix stays inside the field.
            <div className="max-w-[10rem]">
              <Input
                {...c} type="number" min={0} max={100} step={1} inputMode="decimal" suffix="%" disabled={readOnly}
                value={sec.maxDiscountPercent ?? ''}
                onChange={e => patch('security', { maxDiscountPercent: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                placeholder="No limit"
              />
            </div>
          )}
        </Field>
      </Section>

      <Section title="Returns" description="Bill wapas karne (return / refund) par control." icon={<Undo2 />}>
        <Toggle
          label="Har return par manager PIN"
          description="On: return ki ijazat wale staff ko bhi manager PIN chahiye. Off: sirf unhein jin ke role mein 'Process returns' nahi."
          checked={sec.returnNeedsApproval}
          disabled={readOnly}
          onChange={v => patch('security', { returnNeedsApproval: v })}
        />
      </Section>

      <Section title="Auto-lock" description="Counter khali chhor diya jaye to screen khud lock ho jaye; PIN se khulti hai." icon={<Timer />}>
        <Field label="Itne minute kuch na ho to lock karein" error={errors.autoLockMinutes} hint="Internet band ho to lock nahi hota, taake counter PIN check na hone ki wajah se ruk na jaye.">
          {c => (
            <Select {...c} className="max-w-[14rem]" disabled={readOnly} value={sec.autoLockMinutes} onChange={e => patch('security', { autoLockMinutes: Number(e.target.value) })}>
              <option value={0}>Kabhi nahi</option>
              {[2, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} minute</option>)}
              {![0, 2, 5, 10, 15, 30, 60].includes(sec.autoLockMinutes) && <option value={sec.autoLockMinutes}>{sec.autoLockMinutes} minute</option>}
            </Select>
          )}
        </Field>
      </Section>
    </div>
  );
};
