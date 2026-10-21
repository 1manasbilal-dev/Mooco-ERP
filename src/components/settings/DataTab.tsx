import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../ui/Modal';
import { Notice, PageHeader, Section, buttonClass, inputClass } from './SettingsUI';

const CONFIRM_WORD = 'DELETE';

export const DataTab: React.FC = () => {
  const {
    buildBackup, clearData, items, sales, dailySupplyEntries, purchases, materialPurchases, productionBatches,
    suppliers, customers, expenses, expenseVendors, bankTransactions, journalEntries, retailClosings,
    customerTransactions, supplierTransactions,
  } = useDairy();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ ids: string[]; label: string } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(() => {
    try { return localStorage.getItem('mooco_last_backup_at'); } catch { return null; }
  });

  const modules = useMemo(() => [
    { id: 'transactions', label: 'Sab transactions (test data saaf)', desc: 'Bills, purchases, batches, kharche, payments aur journal. Customers, suppliers, products aur accounts rehte hain; balance 0 ho jate hain.', count: sales.length + purchases.length + expenses.length + bankTransactions.length, unit: 'entries' },
    { id: 'sales', label: 'POS bills & daily supply', desc: 'Tamam bills aur supply slips.', count: sales.length + dailySupplyEntries.length, unit: 'bills' },
    { id: 'purchases', label: 'Milk & material purchases', desc: 'Doodh ki intake aur material ke bills.', count: purchases.length + materialPurchases.length, unit: 'bills' },
    { id: 'production', label: 'Production batches', desc: 'Tamam batch history.', count: productionBatches.length, unit: 'batches' },
    { id: 'customer_ledger', label: 'Customer khata', desc: 'Balance 0; customer profiles rehte hain.', count: customerTransactions.length, unit: 'entries' },
    { id: 'supplier_ledger', label: 'Supplier khata', desc: 'Balance 0; supplier profiles rehte hain.', count: supplierTransactions.length, unit: 'entries' },
    { id: 'expenses', label: 'Expenses & vendors', desc: 'Kharche ke vouchers aur vendor payments.', count: expenses.length + expenseVendors.length, unit: 'records' },
    { id: 'bank_cash', label: 'Bank & cash transactions', desc: 'Transactions mit jati hain, account balance 0.', count: bankTransactions.length, unit: 'entries' },
    { id: 'accounts_journal', label: 'Journal entries', desc: 'Manual journal vouchers.', count: journalEntries.length, unit: 'entries' },
    { id: 'retail_closings', label: 'Shift closings', desc: 'Counter ki closing records.', count: retailClosings.length, unit: 'closings' },
    { id: 'stock', label: 'Stock 0 karein', desc: 'Har product ka stock 0 aur stock logs saaf.', count: Math.round(items.reduce((sum, i) => sum + (Number(i.stock) || 0), 0)), unit: 'units' },
    { id: 'customers', label: 'Customers (poori list)', desc: 'Customer profiles hamesha ke liye delete.', count: customers.length, unit: 'customers' },
    { id: 'suppliers', label: 'Suppliers (poori list)', desc: 'Supplier profiles hamesha ke liye delete.', count: suppliers.length, unit: 'suppliers' },
    { id: 'items', label: 'Custom products', desc: 'Apne banaye products aur variants.', count: items.filter(i => !i.isSystem).length, unit: 'products' },
  ], [items, sales, dailySupplyEntries, purchases, materialPurchases, productionBatches, suppliers, customers, expenses, expenseVendors, bankTransactions, journalEntries, retailClosings, customerTransactions, supplierTransactions]);

  const downloadBackup = () => {
    const data = buildBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    link.href = url;
    link.download = `mooco-backup-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    const at = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
    setLastBackup(at);
    try { localStorage.setItem('mooco_last_backup_at', at); } catch (_) {}
    showToast('Backup download ho gaya.', 'success');
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ask = (ids: string[]) => {
    const labels = modules.filter(m => ids.includes(m.id)).map(m => m.label);
    setTyped('');
    setPending({ ids, label: labels.join(', ') });
  };

  const run = async () => {
    if (!pending || typed !== CONFIRM_WORD) return;
    setBusy(true);
    try {
      await clearData(pending.ids.length === 1 ? pending.ids[0] : pending.ids);
      setSelected(new Set());
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div>
      <PageHeader title="Backup & Data" description="Apna data mehfooz karein. Delete ke option sirf Owner ke liye hain." />

      <Section title="Backup" description="Tamam customers, suppliers, products, bills, khata aur accounts ki ek file (.json) jo is device par mojood hai.">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Poore data ki backup file</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{lastBackup ? `Pichla backup is device se: ${lastBackup}` : 'Is device se abhi koi backup nahi liya.'}</p>
          </div>
          <button type="button" onClick={downloadBackup} className={buttonClass.primary}><Download size={15} /> Download backup</button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">Hafte mein kam az kam ek dafa, aur data delete karne se pehle hamesha backup lein. File ko kisi mehfooz jagah (USB / Google Drive) rakhein.</p>
      </Section>

      <Section title="Danger zone" description="Ye data hamesha ke liye mit jata hai aur wapas nahi aata.">
        <Notice tone="danger" icon={<AlertTriangle size={14} />}>
          Sirf test data saaf karne ya naye saal ki shuruat ke liye. Pehle backup zaroor download karein.
        </Notice>
        <div className="overflow-hidden rounded-2xl border border-rose-200 dark:border-rose-900/50">
          <div className="flex items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/60 px-3 py-2 dark:border-rose-900/40 dark:bg-rose-950/20">
            <span className="text-xs font-bold text-rose-800 dark:text-rose-200">{selected.size ? `${selected.size} chune gaye` : 'Kya delete karna hai, chunein'}</span>
            <button type="button" disabled={selected.size === 0} onClick={() => ask([...selected])} className={`${buttonClass.danger} px-3 py-1.5 text-xs`}><Trash2 size={13} /> Delete selected</button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {modules.map(m => (
              <label key={m.id} className={`flex cursor-pointer items-start gap-3 px-3 py-3 transition ${selected.has(m.id) ? 'bg-rose-50/50 dark:bg-rose-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}>
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{m.label}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{m.desc}</span>
                </span>
                <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{m.count} {m.unit}</span>
              </label>
            ))}
          </div>
        </div>
      </Section>

      {pending && (
        <Modal
          open
          role="alertdialog"
          size="sm"
          dismissible={!busy}
          onClose={() => setPending(null)}
          title="Data hamesha ke liye delete karein?"
          description={pending.label}
          icon={<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"><Trash2 size={20} /></div>}
          footer={<>
            <button type="button" onClick={() => setPending(null)} disabled={busy} className={buttonClass.secondary}>Wapas jayen</button>
            <button type="button" onClick={run} disabled={busy || typed !== CONFIRM_WORD} className={buttonClass.danger}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
          </>}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">Ye kaam wapas nahi ho sakta. Tasdeeq ke liye neeche <strong className="font-mono">{CONFIRM_WORD}</strong> likhein.</p>
            <input value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} className={`${inputClass} font-mono`} placeholder={CONFIRM_WORD} aria-label={`Tasdeeq ke liye ${CONFIRM_WORD} likhein`} autoComplete="off" />
            <button type="button" onClick={downloadBackup} className={`${buttonClass.ghost} px-0`}><Download size={13} /> Pehle backup download karein</button>
          </div>
        </Modal>
      )}
    </div>
  );
};
