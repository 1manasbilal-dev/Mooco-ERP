import React, { useState } from 'react';
import { Clock, Info, Lock, Plus, Printer, ShieldCheck, X } from 'lucide-react';
import { FinancialAccount, SystemSettings } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { Field, Notice, PageHeader, Section, Toggle, buttonClass, inputClass } from './SettingsUI';

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

/** Problems that block saving, in plain words. */
export function validateDraft(d: SettingsDraft, today: string): string | null {
  if (!d.general.companyName.trim()) return 'Business ka naam zaroori hai.';
  if (d.general.email && !/^\S+@\S+\.\S+$/.test(d.general.email.trim())) return 'Email sahi nahi lag raha.';
  if (d.sales.invoicePrefix.length > 8) return 'Bill prefix 8 huroof se zyada nahi ho sakta.';
  if (d.security.lockDate && d.security.lockDate > today) return 'Lock date aaj se aage ki nahi ho sakti.';
  if (d.security.maxDiscountPercent !== null && (d.security.maxDiscountPercent < 0 || d.security.maxDiscountPercent > 100)) return 'Discount limit 0 se 100% ke darmiyan honi chahiye.';
  if (d.security.autoLockMinutes < 0 || d.security.autoLockMinutes > 240) return 'Auto-lock 0 se 240 minute tak ho sakta hai.';
  return null;
}

/** What gets sent to updateSettings: partial sections, merged over the stored ones. */
export const draftToSettings = (d: SettingsDraft): Partial<SystemSettings> => ({
  general: { ...d.general, companyName: d.general.companyName.trim() } as SystemSettings['general'],
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
}

export const BusinessTab: React.FC<TabProps> = ({ draft, patch, readOnly }) => {
  const g = draft.general;
  return (
    <div>
      <PageHeader title="Business Profile" description="Ye maloomat bills, receipts aur khata statements par chhapti hai." />
      <Section title="Business details" description="Naam aur rabta jo customer apni receipt par dekhta hai.">
        <Field label="Business name" required htmlFor="s-company">
          <input id="s-company" className={inputClass} disabled={readOnly} value={g.companyName} onChange={e => patch('general', { companyName: e.target.value })} placeholder="Mooco Dairy" />
        </Field>
        <Field label="Address" htmlFor="s-address">
          <input id="s-address" className={inputClass} disabled={readOnly} value={g.address} onChange={e => patch('general', { address: e.target.value })} placeholder="Shop #12, Main Market, City" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="s-phone">
            <input id="s-phone" className={inputClass} disabled={readOnly} value={g.phone} onChange={e => patch('general', { phone: e.target.value })} placeholder="0300-1234567" inputMode="tel" />
          </Field>
          <Field label="Email" htmlFor="s-email">
            <input id="s-email" type="email" className={inputClass} disabled={readOnly} value={g.email} onChange={e => patch('general', { email: e.target.value })} placeholder="info@mooco.pk" />
          </Field>
        </div>
      </Section>
      <Section title="Tax registration" description="Khali chhorein to receipt par nahi chhapega.">
        <Field label="NTN / STRN" htmlFor="s-ntn" hint="Receipt ke upar business ke naam ke neeche chhapta hai.">
          <input id="s-ntn" className={inputClass} disabled={readOnly} value={g.taxId} onChange={e => patch('general', { taxId: e.target.value })} placeholder="1234567-8" />
        </Field>
      </Section>
    </div>
  );
};

export const SalesTab: React.FC<TabProps> = ({ draft, patch, readOnly }) => {
  const { general: g, sales } = draft;
  return (
    <div>
      <PageHeader title="Sales & Receipts" description="Bill numbering, receipt ka footer aur POS counter ki screen." />
      <Section title="Bill numbering" description="Har naye POS bill ke number se pehle lagta hai.">
        <Field label="Bill prefix" htmlFor="s-prefix" hint={<>Misal: <span className="font-mono">{(sales.invoicePrefix || 'INV-')}00042</span></>}>
          <input id="s-prefix" className={`${inputClass} max-w-[12rem] font-mono`} maxLength={8} disabled={readOnly} value={sales.invoicePrefix} onChange={e => patch('sales', { invoicePrefix: e.target.value.toUpperCase() })} placeholder="INV-" />
        </Field>
      </Section>
      <Section title="Receipt" description="Receipt ke aakhir mein chhapne wala paigham.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <Field label="Receipt footer" htmlFor="s-footer">
            <textarea id="s-footer" rows={3} className={`${inputClass} resize-none`} maxLength={160} disabled={readOnly} value={sales.invoiceFooter} onChange={e => patch('sales', { invoiceFooter: e.target.value })} placeholder="Thank you for your visit!" />
          </Field>
          <ReceiptPreview draft={draft} />
        </div>
      </Section>
      <Section title="POS screen" description="Counter par kya nazar aaye.">
        <Toggle label="Product search bar" description="Band karne se products ke liye zyada jagah milti hai." checked={sales.showPosSearch} disabled={readOnly} onChange={v => patch('sales', { showPosSearch: v })} />
        <Toggle label="Category filters" description="Products ke upar category buttons." checked={sales.showPosCategories} disabled={readOnly} onChange={v => patch('sales', { showPosCategories: v })} />
      </Section>
      {!g.companyName.trim() && <Notice tone="warning">Business Profile mein naam likhein, warna receipt par default naam chhapega.</Notice>}
    </div>
  );
};

const ReceiptPreview: React.FC<{ draft: SettingsDraft }> = ({ draft }) => {
  const { general: g, sales } = draft;
  return (
    <div aria-label="Receipt preview" className="self-start rounded-2xl bg-slate-100 p-3 dark:bg-slate-800/60">
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Printer size={12} /> Preview</div>
      <div className="space-y-1.5 rounded-lg bg-white p-3 font-mono text-[10px] text-slate-800 shadow-sm">
        <div className="border-b border-dashed border-slate-300 pb-1.5 text-center">
          <div className="text-xs font-black uppercase">{g.companyName || 'Mooco Dairy'}</div>
          {g.address && <div className="text-slate-500">{g.address}</div>}
          {g.phone && <div className="text-slate-500">Ph: {g.phone}</div>}
          {g.taxId && <div className="text-slate-500">NTN: {g.taxId}</div>}
        </div>
        <div className="flex justify-between text-slate-500"><span>{sales.invoicePrefix || 'INV-'}00042</span><span>10:30</span></div>
        <div className="flex justify-between"><span>Milk 2 L</span><span>440</span></div>
        <div className="flex justify-between"><span>Yogurt 1 kg</span><span>350</span></div>
        <div className="flex justify-between border-t border-dashed border-slate-300 pt-1 font-bold"><span>TOTAL</span><span>{formatCurrency(790)}</span></div>
        <div className="border-t border-slate-200 pt-1.5 text-center italic text-slate-500">{sales.invoiceFooter || 'Thank you for your visit!'}</div>
      </div>
    </div>
  );
};

export const PaymentsTab: React.FC<TabProps & { accounts: FinancialAccount[] }> = ({ draft, patch, readOnly, accounts }) => {
  const active = accounts.filter(a => a.isActive !== false);
  const cash = active.filter(a => a.type === 'Cash');
  const digital = active.filter(a => a.type === 'Bank' || a.type === 'Wallet');
  const label = (a: FinancialAccount) => `${a.name}${a.bank_name ? ` · ${a.bank_name}` : ''} (${formatCurrency(Number(a.balance || 0))})`;
  return (
    <div>
      <PageHeader title="Payments & Accounts" description="Paisa kis account mein jaye jab entry par account alag se na chuna jaye." />
      <Section title="Cash" description="POS cash bills, khata ki cash wasooli aur suppliers ko cash payment.">
        <Field label="Default cash account" htmlFor="s-cash">
          <select id="s-cash" className={inputClass} disabled={readOnly} value={draft.financial.defaultCashAccountId} onChange={e => patch('financial', { defaultCashAccountId: e.target.value })}>
            <option value="">— Chunein —</option>
            {cash.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </select>
        </Field>
      </Section>
      <Section title="Bank & wallet" description="Online / bank transfer, QR aur delivery app ki online payments.">
        <Field label="Default bank / wallet" htmlFor="s-bank">
          <select id="s-bank" className={inputClass} disabled={readOnly} value={draft.financial.defaultDigitalAccountId} onChange={e => patch('financial', { defaultDigitalAccountId: e.target.value })}>
            <option value="">— Chunein —</option>
            {digital.map(a => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </select>
        </Field>
        {digital.length === 0 && <Notice icon={<Info size={14} />}>Koi bank ya wallet account nahi bana. Bank & Cash page se account banayein.</Notice>}
      </Section>
    </div>
  );
};

export const OperationsTab: React.FC<TabProps & { onOpenItems: () => void }> = ({ draft, patch, readOnly, onOpenItems }) => {
  const [newShift, setNewShift] = useState('');
  const shifts = draft.general.shifts;
  const addShift = () => {
    const name = newShift.trim();
    if (!name || shifts.some(s => s.toLowerCase() === name.toLowerCase())) return;
    patch('general', { shifts: [...shifts, name] });
    setNewShift('');
  };
  return (
    <div>
      <PageHeader title="Inventory & Milk" description="Stock ke qawaid aur doodh ki collection ki shifts." />
      <Section title="Stock" description="Jab system mein stock khatam ho magar counter par maal mojood ho.">
        <Toggle
          label="Stock 0 hone par bhi bechne dein"
          description="On: counter kabhi nahi rukta, stock minus mein chala jata hai. Off: stock khatam hone par bill nahi banega."
          checked={draft.inventory.allowNegativeStock}
          disabled={readOnly}
          onChange={v => patch('inventory', { allowNegativeStock: v })}
        />
        <Notice icon={<Info size={14} />}>
          Har product ki low-stock hadd aur units (kg, L, pao, pack) <button type="button" onClick={onOpenItems} className="font-bold underline">Products</button> page par set hoti hain.
        </Notice>
      </Section>
      <Section title="Milk collection shifts" description="Suppliers se doodh lene ke waqt — Milk Intake mein ye options aate hain.">
        <div className="flex flex-wrap gap-2">
          {shifts.map(shift => (
            <span key={shift} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Clock size={13} className="text-lime-600" />
              {shift}
              {!readOnly && shifts.length > 1 && (
                <button type="button" aria-label={`${shift} shift hatayein`} onClick={() => patch('general', { shifts: shifts.filter(s => s !== shift) })} className="rounded-md p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40">
                  <X size={14} />
                </button>
              )}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="flex max-w-sm gap-2">
            <input className={inputClass} value={newShift} onChange={e => setNewShift(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addShift(); } }} placeholder="Nayi shift, e.g. Dopehar" aria-label="Nayi shift ka naam" />
            <button type="button" onClick={addShift} disabled={!newShift.trim()} className={buttonClass.secondary}><Plus size={15} /> Add</button>
          </div>
        )}
      </Section>
    </div>
  );
};

export const SecurityTab: React.FC<TabProps & { today: string; savedLockDate: string }> = ({ draft, patch, readOnly, today, savedLockDate }) => {
  const sec = draft.security;
  return (
    <div>
      <PageHeader title="Security & Controls" description="Hisaab ko mehfooz rakhne aur staff ke ikhtiyar ki hadd." />
      {readOnly && <div className="pt-5"><Notice tone="info" icon={<Lock size={14} />}>Ye settings sirf Owner badal sakta hai.</Notice></div>}

      <Section title="Lock date (books close)" description="Is tareekh tak ki koi entry add, edit ya delete nahi ho sakegi — bills, purchases, kharche, payments, journal sab.">
        <Field label="Books band hain is tareekh tak (shamil)" htmlFor="s-lock" hint={savedLockDate ? `Abhi ${savedLockDate} tak band hain.` : 'Abhi koi lock nahi.'}>
          <div className="flex max-w-sm gap-2">
            <input id="s-lock" type="date" max={today} className={inputClass} disabled={readOnly} value={sec.lockDate} onChange={e => patch('security', { lockDate: e.target.value })} />
            {sec.lockDate && !readOnly && <button type="button" onClick={() => patch('security', { lockDate: '' })} className={buttonClass.secondary}>Hatayein</button>}
          </div>
        </Field>
        <Notice tone="warning" icon={<ShieldCheck size={14} />}>
          Mahina ya saal band karte waqt lagayein, jab hisaab check ho chuka ho. Ghalti theek karni ho to pehle lock date peeche karein.
        </Notice>
      </Section>

      <Section title="Discount limit" description="Cashier is had tak khud discount de sakta hai. Zyada ho to manager PIN maanga jayega.">
        <Field label="Zyada se zyada discount (% of bill)" htmlFor="s-disc" hint="Khali chhorein = koi limit nahi. Jis role ke paas 'Give discount' nahi, us se har discount par PIN maanga jata hai.">
          <div className="relative max-w-[10rem]">
            <input
              id="s-disc" type="number" min={0} max={100} step={1} inputMode="decimal" className={`${inputClass} pr-8`} disabled={readOnly}
              value={sec.maxDiscountPercent ?? ''}
              onChange={e => patch('security', { maxDiscountPercent: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
              placeholder="No limit"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">%</span>
          </div>
        </Field>
      </Section>

      <Section title="Returns" description="Bill wapas karne (return / refund) par control.">
        <Toggle
          label="Har return par manager PIN"
          description="On: return ki ijazat wale staff ko bhi manager PIN chahiye. Off: sirf unhein jin ke role mein 'Process returns' nahi."
          checked={sec.returnNeedsApproval}
          disabled={readOnly}
          onChange={v => patch('security', { returnNeedsApproval: v })}
        />
      </Section>

      <Section title="Auto-lock" description="Counter khali chhor diya jaye to screen khud lock ho jaye; PIN se khulti hai.">
        <Field label="Itne minute kuch na ho to lock karein" htmlFor="s-idle">
          <select id="s-idle" className={`${inputClass} max-w-[14rem]`} disabled={readOnly} value={sec.autoLockMinutes} onChange={e => patch('security', { autoLockMinutes: Number(e.target.value) })}>
            <option value={0}>Kabhi nahi</option>
            {[2, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} minute</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-400 dark:text-slate-500">Internet band ho to lock nahi hota, taake counter PIN check na hone ki wajah se ruk na jaye.</p>
      </Section>
    </div>
  );
};
