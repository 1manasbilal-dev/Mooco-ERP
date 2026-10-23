import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { Button, Modal, Money } from '../ui';
import { cn } from '../../lib/cn';

type Action = 'hard_delete' | 'deactivate' | 'settle_discount';

const Icon = ({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) => (
  <span className={cn('flex size-10 items-center justify-center rounded-xl [&_svg]:size-5', tone === 'danger' ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg')}>
    {children}
  </span>
);

/**
 * Remove a supplier safely: a supplier with history or an open khata is archived (made inactive), never
 * hard-deleted, so milk slips and payments stay in the books. `ids` with more than one entry is a bulk archive.
 */
export function SupplierDeleteDialog({ ids, onClose, onDone }: {
  ids: string[];
  onClose: () => void;
  /** Called with the ids that were archived or deleted. */
  onDone: (ids: string[]) => void;
}) {
  const { suppliers = [], getDeleteAssessment, safeDeleteSupplier } = useDairy();
  const [busy, setBusy] = useState<Action | null>(null);
  const [progress, setProgress] = useState(0);
  const busyRef = useRef(false);

  const targets = useMemo(() => (suppliers || []).filter(s => ids.includes(s.id)), [suppliers, ids]);
  const isBulk = ids.length > 1;

  const run = async (action: Action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      if (isBulk) {
        const done: string[] = [];
        // Already-inactive suppliers need nothing; archiving them again only costs a reload each.
        const work = targets.filter(s => s.isActive !== false);
        for (const [index, s] of work.entries()) {
          setProgress(index + 1);
          if (await safeDeleteSupplier(s.id, 'deactivate')) done.push(s.id);
        }
        onDone(done);
        onClose();
        return;
      }
      const target = targets[0];
      if (target && await safeDeleteSupplier(target.id, action)) {
        onDone([target.id]);
        onClose();
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const cancel = (
    <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
  );

  if (isBulk) {
    const active = targets.filter(s => s.isActive !== false);
    const payable = active.filter(s => Number(s.pending_balance) > 0.5);
    const payableTotal = payable.reduce((sum, s) => sum + Number(s.pending_balance || 0), 0);
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        role="alertdialog"
        icon={<Icon tone="warning"><Archive /></Icon>}
        title={`${active.length} supplier${active.length === 1 ? '' : 's'} inactive karein?`}
        description="Inactive supplier milk intake mein nahi aate. Unki milk slips, FAT/SNF aur payments mehfooz rehti hain."
        footer={
          <>
            {cancel}
            <Button variant="danger" leftIcon={<Archive />} loading={busy === 'deactivate'} disabled={active.length === 0} onClick={() => run('deactivate')}>
              {busy ? `Inactive ho rahe hain ${progress}/${active.length}` : 'Inactive karein'}
            </Button>
          </>
        }
      >
        <ul className="space-y-1.5 text-[13px] text-fg-muted">
          {targets.length > active.length && <li>{targets.length - active.length} pehle se inactive hain, unhein chhor diya jayega.</li>}
          {payable.length > 0 && (
            <li className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 font-medium text-warning-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{payable.length} supplier ka <Money amount={payableTotal} /> payable khata mein rahega.</span>
            </li>
          )}
        </ul>
      </Modal>
    );
  }

  const target = targets[0];
  if (!target) return null;
  const assessment = getDeleteAssessment('supplier', target.id);
  const balance = Number(assessment.balance) || 0;
  const alreadyInactive = target.isActive === false;
  const history = assessment.details || {};
  const historyText = `${history.purCount || 0} milk intake, ${history.matCount || 0} material, ${history.txCount || 0} payments`;

  if (balance !== 0) {
    const payable = balance > 0;
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        role="alertdialog"
        icon={<Icon tone="warning"><AlertTriangle /></Icon>}
        title={payable ? 'Is supplier ka payable baqi hai' : 'Is supplier par advance baqi hai'}
        description={`${target.name}: open khata wala supplier delete nahi hota, warna creditors ka hisaab ghalat ho jayega.`}
        footer={
          <div className="flex w-full flex-col gap-2">
            {payable && (
              <Button variant="danger" fullWidth loading={busy === 'settle_discount'} disabled={Boolean(busy)} onClick={() => run('settle_discount')}>
                Waiver / discount se settle karke inactive karein
              </Button>
            )}
            {!alreadyInactive && (
              <Button variant="secondary" fullWidth leftIcon={<Archive />} loading={busy === 'deactivate'} disabled={Boolean(busy)} onClick={() => run('deactivate')}>
                {payable ? 'Payable khata mein rakh kar inactive karein' : 'Advance khata mein rakh kar inactive karein'}
              </Button>
            )}
            <Button variant="ghost" fullWidth onClick={onClose} disabled={Boolean(busy)}>Cancel, active rehne dein</Button>
          </div>
        }
      >
        <div className={cn('rounded-control px-4 py-3 text-center', payable ? 'bg-danger-soft text-danger-fg' : 'bg-success-soft text-success-fg')}>
          <p className="text-[11px] font-semibold uppercase tracking-wider">{payable ? 'Payable · hum ne dena hai' : 'Advance · supplier ne wapas karna hai'}</p>
          <Money amount={Math.abs(balance)} className="mt-1 block text-2xl font-bold" />
        </div>
        <p className="mt-3 text-xs text-fg-subtle">
          {payable
            ? 'Waiver ek "Supplier Waiver / Discount" entry banata hai: khata zero hota hai, kisi account se paisa nahi nikalta.'
            : 'Advance waiver se khatam nahi hota. Pehle paisa wapas lein ya milk se adjust karein, ya khata rakh kar inactive karein.'}
        </p>
      </Modal>
    );
  }

  if (assessment.hasHistory) {
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        role="alertdialog"
        icon={<Icon tone="warning"><Archive /></Icon>}
        title={alreadyInactive ? 'Supplier pehle se inactive hai' : 'Supplier inactive karein?'}
        description={`${target.name}: ${historyText}. Purana record hamesha mehfooz rahega.`}
        footer={
          <>
            {cancel}
            {!alreadyInactive && (
              <Button variant="danger" leftIcon={<Archive />} loading={busy === 'deactivate'} onClick={() => run('deactivate')}>Inactive karein</Button>
            )}
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">
          {alreadyInactive
            ? 'History wala supplier permanently delete nahi hota. Wapas laane ke liye profile par Reactivate dabayein.'
            : 'Khata settled hai (Rs 0). Inactive supplier daily milk intake mein nahi aayega, lekin slips, FAT/SNF aur payments mehfooz rahengi.'}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      role="alertdialog"
      icon={<Icon tone="danger"><Trash2 /></Icon>}
      title="Permanently delete karein?"
      description={`${target.name} ka koi milk intake, material ya payment record nahi, aur khata Rs 0 hai.`}
      footer={
        <>
          {cancel}
          <Button variant="danger" leftIcon={<Trash2 />} loading={busy === 'hard_delete'} onClick={() => run('hard_delete')}>Delete permanently</Button>
        </>
      }
    >
      <p className="text-[13px] text-fg-muted">Supplier database se hamesha ke liye hat jayega. Ye wapas nahi hoga.</p>
    </Modal>
  );
}

export default SupplierDeleteDialog;
