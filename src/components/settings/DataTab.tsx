import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, HardDriveDownload, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { Button, Field, Input, Modal } from '../ui';
import { cn } from '../../lib/cn';
import { Notice, Section, TabHeader } from './SettingsUI';

const CONFIRM_WORD = 'DELETE';

export const DataTab: React.FC = () => {
  const {
    buildBackup, clearData, items, sales, dailySupplyEntries, purchases, materialPurchases, productionBatches,
    suppliers, customers, expenses, expenseVendors, bankTransactions, journalEntries, retailClosings,
    customerTransactions, supplierTransactions,
  } = useDairy();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ ids: string[]; labels: string[] } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [backingUp, setBackingUp] = useState(false);
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
    if (backingUp) return;
    setBackingUp(true);
    // Let the button show its spinner before the (synchronous) serialisation of every record.
    setTimeout(() => {
      try {
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
        // Revoking in the same tick can cancel the download in Safari and Firefox.
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        const at = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });
        setLastBackup(at);
        try { localStorage.setItem('mooco_last_backup_at', at); } catch { /* storage blocked */ }
        showToast('Backup download ho gaya.', 'success');
      } catch (error) {
        console.error('[Settings] backup failed', error);
        showToast('Backup nahi ban saka. Dobara koshish karein.', 'error');
      } finally {
        setBackingUp(false);
      }
    }, 30);
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const ask = (ids: string[]) => {
    setTyped('');
    setPending({ ids, labels: modules.filter(m => ids.includes(m.id)).map(m => `${m.label} — ${m.count} ${m.unit}`) });
  };

  const close = () => { if (!busyRef.current) setPending(null); };

  const run = async () => {
    if (!pending || typed !== CONFIRM_WORD || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await clearData(pending.ids.length === 1 ? pending.ids[0] : pending.ids);
      setSelected(new Set());
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <TabHeader title="Backup & Data" description="Apna data mehfooz karein. Delete ke option sirf Owner ke liye hain." />

      <Section title="Backup" description="Tamam customers, suppliers, products, bills, khata aur accounts ki ek file (.json) jo is device par mojood hai." icon={<HardDriveDownload />}>
        <div className="flex flex-col gap-3 rounded-control bg-surface-2 p-4 ring-1 ring-inset ring-line sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold text-fg">Poore data ki backup file</p>
            <p className="text-xs text-fg-subtle">{lastBackup ? `Pichla backup is device se: ${lastBackup}` : 'Is device se abhi koi backup nahi liya.'}</p>
          </div>
          <Button leftIcon={<Download />} loading={backingUp} onClick={downloadBackup}>{backingUp ? 'Ban raha hai…' : 'Download backup'}</Button>
        </div>
        <p className="text-xs text-fg-subtle">Hafte mein kam az kam ek dafa, aur data delete karne se pehle hamesha backup lein. File ko kisi mehfooz jagah (USB / Google Drive) rakhein.</p>
      </Section>

      <Section tone="danger" title="Danger zone" description="Ye data hamesha ke liye mit jata hai aur wapas nahi aata." icon={<AlertTriangle />} bodyClassName="space-y-3">
        <Notice tone="danger">Sirf test data saaf karne ya naye saal ki shuruat ke liye. Pehle backup zaroor download karein.</Notice>
        <div className="overflow-hidden rounded-control ring-1 ring-inset ring-line">
          <div className="flex items-center justify-between gap-2 bg-danger-soft/60 px-3 py-2">
            <span className="text-xs font-bold text-danger-fg" aria-live="polite">{selected.size ? `${selected.size} chune gaye` : 'Kya delete karna hai, chunein'}</span>
            <Button variant="danger" size="sm" leftIcon={<Trash2 />} disabled={selected.size === 0} onClick={() => ask([...selected])}>Delete selected</Button>
          </div>
          <ul className="divide-y divide-line">
            {modules.map(m => {
              const on = selected.has(m.id);
              return (
                <li key={m.id}>
                  <label className={cn('flex cursor-pointer items-start gap-3 px-3 py-3 transition-colors duration-150', on ? 'bg-danger-soft/50' : 'hover:bg-surface-2')}>
                    <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="ds-control mt-0.5 size-4 shrink-0 accent-danger" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">{m.label}</span>
                      <span className="block text-xs text-fg-subtle">{m.desc}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-fg-subtle ring-1 ring-inset ring-line">{m.count} {m.unit}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      {pending && (
        <Modal
          open
          role="alertdialog"
          size="sm"
          dismissible={!busy}
          onClose={close}
          title="Data hamesha ke liye delete karein?"
          description="Ye kaam wapas nahi ho sakta."
          icon={<div className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger-fg"><Trash2 size={20} /></div>}
          footer={<>
            <Button variant="secondary" onClick={close} disabled={busy}>Wapas jayen</Button>
            <Button variant="danger" onClick={run} loading={busy} disabled={typed !== CONFIRM_WORD}>{busy ? 'Deleting…' : 'Delete permanently'}</Button>
          </>}
        >
          {/* Enter never deletes: only the danger button does. */}
          <form className="space-y-3" onSubmit={e => e.preventDefault()}>
            <ul className="space-y-1 rounded-control bg-danger-soft/60 p-3 text-xs text-danger-fg ring-1 ring-inset ring-danger/20">
              {pending.labels.map(label => <li key={label} className="flex gap-1.5"><span aria-hidden="true">•</span>{label}</li>)}
            </ul>
            <Field label={<>Tasdeeq ke liye <strong className="font-mono">{CONFIRM_WORD}</strong> likhein</>}>
              {c => <Input {...c} value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} className="font-mono" placeholder={CONFIRM_WORD} autoComplete="off" disabled={busy} />}
            </Field>
            <Button variant="ghost" size="sm" leftIcon={<Download />} onClick={downloadBackup} loading={backingUp} disabled={busy} className="-ml-2">Pehle backup download karein</Button>
          </form>
        </Modal>
      )}
    </div>
  );
};
