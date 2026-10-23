import React, { memo, useMemo, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, History, Plus, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import type { JournalEntry } from '../../types';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { businessDate } from '../../lib/dashboardAnalytics';
import { cleanNumber } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import {
  Badge, Button, Card, CardBody, CardFooter, CardHeader, EmptyState, Field, IconButton, Input, LoadMoreRow, Money, Select,
} from '../ui';
import { ACCOUNT_TYPE_ORDER } from './coa';
import { formatDay, parseAmount, todayPk } from './ledger';

interface DraftLine {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
}

let lineSeq = 0;
const newLine = (): DraftLine => ({ id: `jl_${Date.now()}_${lineSeq++}`, accountId: '', debit: '', credit: '' });
const blankLines = () => [newLine(), newLine()];

interface SelectableAccount {
  id: string;
  name: string;
  /** 'Bank' for cash / bank / wallet accounts, 'Manual' for ledger accounts (stored on the line as accountType). */
  kind: 'Bank' | 'Manual';
  category: string;
}

const amountOf = (value: string) => {
  const parsed = parseAmount(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const VoucherCard = memo(function VoucherCard({ entry }: { entry: JournalEntry }) {
  const day = businessDate(entry.date);
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge tone="neutral" className="font-mono">{entry.referenceNo || 'JV'}</Badge>
          <span className="text-xs tabular-nums text-fg-subtle">{day ? formatDay(day) : ''}</span>
        </div>
        <Money amount={entry.totalAmount} className="shrink-0 text-sm font-bold text-fg" />
      </div>
      {entry.narration && <p className="text-[13px] text-fg-muted">{entry.narration}</p>}
      <div className="space-y-1 rounded-control bg-surface-2 px-3 py-2 text-xs">
        {(entry.lines || []).map((line, index) => (
          <div key={index} className="flex items-center justify-between gap-3">
            <span className={cn('min-w-0 truncate', line.credit > 0 ? 'pl-4 text-fg-muted' : 'font-semibold text-fg')}>{line.accountName}</span>
            <span className="shrink-0 tabular-nums">
              {line.debit > 0 ? <span className="font-semibold text-fg">Dr <Money amount={line.debit} /></span> : null}
              {line.credit > 0 ? <span className="font-semibold text-info-fg">Cr <Money amount={line.credit} /></span> : null}
            </span>
          </div>
        ))}
      </div>
    </li>
  );
});

/** Double-entry journal voucher form plus the list of recent vouchers. */
export default function JournalPanel() {
  const { accounts, manualAccounts, journalEntries, addJournalEntry, canPerform, isPeriodLocked, settings } = useDairy();
  const { showToast } = useToast();
  const canCreate = canPerform('accounts', 'create');

  const [date, setDate] = useState(todayPk);
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(blankLines);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const selectable = useMemo(() => {
    const list: SelectableAccount[] = [];
    manualAccounts.filter(a => a.isActive !== false).forEach(a => list.push({ id: a.id, name: a.name, kind: 'Manual', category: a.type }));
    accounts.filter(a => a.isActive).forEach(a => list.push({ id: a.id, name: a.name, kind: 'Bank', category: 'Asset' }));
    // Customer / supplier khata is not offered: a journal line cannot post to those ledgers, and it
    // used to be dropped silently. Use Receive Payment / Pay Supplier (or a khata charge) instead.
    return list;
  }, [manualAccounts, accounts]);
  const selectableById = useMemo(() => new Map(selectable.map(a => [a.id, a])), [selectable]);
  const groups = useMemo(() => {
    const bank = selectable.filter(a => a.kind === 'Bank');
    return [
      { label: 'Bank & Cash', accounts: bank },
      ...ACCOUNT_TYPE_ORDER.map(type => ({ label: type, accounts: selectable.filter(a => a.kind === 'Manual' && a.category === type) })),
    ].filter(group => group.accounts.length > 0);
  }, [selectable]);

  const totalDebit = cleanNumber(lines.reduce((sum, l) => sum + amountOf(l.debit), 0));
  const totalCredit = cleanNumber(lines.reduce((sum, l) => sum + amountOf(l.credit), 0));
  const difference = cleanNumber(totalDebit - totalCredit);
  const isBalanced = totalDebit > 0 && Math.abs(difference) < 0.01;
  const isEmpty = totalDebit === 0 && totalCredit === 0;

  const problems: string[] = [];
  if (!date) problems.push('Tareekh chunein.');
  else if (isPeriodLocked(date)) problems.push(`Books ${settings.security?.lockDate} tak band hain. Baad ki tareekh chunein.`);
  if (lines.some(l => !l.accountId)) problems.push('Har line mein account chunein.');
  if (lines.some(l => {
    const dr = parseAmount(l.debit);
    const cr = parseAmount(l.credit);
    const hasDr = Number.isFinite(dr) && dr > 0;
    const hasCr = Number.isFinite(cr) && cr > 0;
    const badInput = (l.debit.trim() && !(Number.isFinite(dr) && dr >= 0)) || (l.credit.trim() && !(Number.isFinite(cr) && cr >= 0));
    return badInput || hasDr === hasCr;
  })) problems.push('Har line mein sirf Debit ya sirf Credit mein raqam likhein.');
  if (!isBalanced) problems.push('Debit aur Credit barabar hone chahiyen.');

  const updateLine = (id: string, patch: Partial<DraftLine>) => setLines(prev => prev.map(line => (line.id === id ? { ...line, ...patch } : line)));
  const removeLine = (id: string) => setLines(prev => (prev.length <= 2 ? prev : prev.filter(line => line.id !== id)));

  const handlePost = async () => {
    setSubmitted(true);
    if (!canCreate) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return;
    }
    if (busyRef.current || problems.length > 0) return;
    busyRef.current = true;
    setSaving(true);
    try {
      // The posting engine reads `account_id` on each line; `accountId` alone made every line "unknown".
      const payloadLines = lines.map(line => {
        const account = selectableById.get(line.accountId);
        return {
          id: line.id,
          accountId: line.accountId,
          account_id: line.accountId,
          accountName: account?.name || '',
          accountType: account?.kind || '',
          debit: amountOf(line.debit),
          credit: amountOf(line.credit),
        };
      });
      const ok = await addJournalEntry({ date, referenceNo: reference.trim(), narration: narration.trim(), lines: payloadLines, totalAmount: totalDebit });
      // Keep the form on failure so nothing typed is lost. addJournalEntry already toasts the reason on every failure.
      if (!ok) return;
      showToast('Journal entry post ho gayi', 'success');
      setReference('');
      setNarration('');
      setLines(blankLines());
      setSubmitted(false);
    } catch (err: any) {
      showToast('Journal entry post nahi hui: ' + (err?.message || 'dobara koshish karein'), 'error');
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<JournalEntry>(journalEntries, 20);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader icon={<BookOpen />} title="New journal voucher" description="Debit aur Credit barabar hon tab hi post hoga." />
        <CardBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              {control => <Input {...control} type="date" value={date} onChange={event => setDate(event.target.value)} />}
            </Field>
            <Field label="Reference #">
              {control => <Input {...control} placeholder="e.g. JV-001" value={reference} onChange={event => setReference(event.target.value)} maxLength={40} />}
            </Field>
          </div>
          <Field label="Narration">
            {control => <Input {...control} placeholder="Entry ki wajah / tafseel..." value={narration} onChange={event => setNarration(event.target.value)} maxLength={300} />}
          </Field>

          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_2.5rem] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle sm:grid">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
              <span className="sr-only">Remove</span>
            </div>
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid grid-cols-2 gap-2 rounded-control border border-line/70 bg-surface-2 p-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_2.5rem] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
              >
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <Select
                    aria-label={`Line ${index + 1} account`}
                    value={line.accountId}
                    onChange={event => updateLine(line.id, { accountId: event.target.value })}
                    aria-invalid={submitted && !line.accountId ? true : undefined}
                  >
                    <option value="">Account chunein...</option>
                    {groups.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                      </optgroup>
                    ))}
                  </Select>
                  <IconButton
                    aria-label={`Line ${index + 1} hatayen`}
                    icon={<Trash2 />}
                    size="sm"
                    disabled={lines.length <= 2}
                    onClick={() => removeLine(line.id)}
                    className="shrink-0 hover:bg-danger-soft hover:text-danger-fg sm:hidden"
                  />
                </div>
                <Input
                  aria-label={`Line ${index + 1} debit`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="Debit"
                  value={line.debit}
                  onChange={event => updateLine(line.id, { debit: event.target.value, credit: '' })}
                  className="text-right font-semibold tabular-nums"
                />
                <Input
                  aria-label={`Line ${index + 1} credit`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="Credit"
                  value={line.credit}
                  onChange={event => updateLine(line.id, { credit: event.target.value, debit: '' })}
                  className="text-right font-semibold tabular-nums"
                />
                <IconButton
                  aria-label={`Line ${index + 1} hatayen`}
                  icon={<Trash2 />}
                  size="sm"
                  disabled={lines.length <= 2}
                  onClick={() => removeLine(line.id)}
                  className="hidden hover:bg-danger-soft hover:text-danger-fg sm:inline-flex"
                />
              </div>
            ))}
            <div>
              <Button variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => setLines(prev => [...prev, newLine()])}>Add line</Button>
            </div>
          </div>
        </CardBody>
        <CardFooter className="flex-col items-stretch gap-3">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-control bg-surface px-2 py-2 ring-1 ring-inset ring-line">
              <dt className="text-[11px] font-semibold text-fg-subtle">Debit</dt>
              <dd className="text-sm font-bold tabular-nums text-fg"><Money amount={totalDebit} /></dd>
            </div>
            <div className="rounded-control bg-surface px-2 py-2 ring-1 ring-inset ring-line">
              <dt className="text-[11px] font-semibold text-fg-subtle">Credit</dt>
              <dd className="text-sm font-bold tabular-nums text-fg"><Money amount={totalCredit} /></dd>
            </div>
            <div className={cn('rounded-control px-2 py-2 ring-1 ring-inset', isEmpty ? 'bg-surface ring-line' : isBalanced ? 'bg-success-soft ring-success/20' : 'bg-danger-soft ring-danger/20')}>
              <dt className={cn('text-[11px] font-semibold', isEmpty ? 'text-fg-subtle' : isBalanced ? 'text-success-fg' : 'text-danger-fg')}>Difference</dt>
              <dd className={cn('text-sm font-bold tabular-nums', isEmpty ? 'text-fg' : isBalanced ? 'text-success-fg' : 'text-danger-fg')}><Money amount={Math.abs(difference)} /></dd>
            </div>
          </dl>
          {submitted && problems.length > 0 && (
            <ul className="space-y-1 text-xs font-semibold text-danger-fg" role="alert">
              {problems.map(problem => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          <Button
            fullWidth
            leftIcon={<CheckCircle2 />}
            loading={saving}
            disabled={!canCreate || totalDebit === 0}
            title={!canCreate ? 'Aap ko journal entry post karne ki ijazat nahi hai' : undefined}
            onClick={handlePost}
          >
            Post journal entry
          </Button>
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          icon={<History />}
          title="Recent journal vouchers"
          actions={<Badge tone="neutral">{journalEntries.length} entries</Badge>}
          className="border-b border-line pb-4"
        />
        {journalEntries.length === 0 ? (
          <EmptyState size="compact" icon={<BookOpen />} title="Abhi koi journal entry nahi" description="Post ki gayi entries yahan nazar aayengi." />
        ) : (
          <ul className="divide-y divide-line">
            {visibleItems.map(entry => <VoucherCard key={entry.id} entry={entry} />)}
            {hiddenCount > 0 && (
              <li>
                <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
              </li>
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
