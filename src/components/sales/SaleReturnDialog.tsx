import React, { memo } from 'react';
import { Banknote, Minus, Plus, RotateCcw, Trash2, Undo2, Wallet } from 'lucide-react';
import type { POSBill } from '../../types';
import { cn } from '../../lib/cn';
import { cleanNumber, cleanQty, formatCurrency, formatQty } from '../../lib/formatters';
import { Badge, Button, Field, IconButton, Input, Modal, Money, Select } from '../ui';
import { ChoiceCard, SummaryRow } from './SalesBits';
import { returnIsScrap, returnLinePile, type ReturnItemSelection } from './salesHistoryUtils';

type AccountOption = { id: string; name: string; type: string; balance: number; isActive?: boolean };

export interface SaleReturnDialogProps {
  sale: POSBill;
  items: ReturnItemSelection[];
  /** Lines that will actually be returned (selected with qty > 0). */
  selectedCount: number;
  /** proportionalRefund() of the selected lines: the same figure the return posts. */
  refundAmount: number;
  returnAction: 'refund' | 'replace';
  restockOption: 'restock' | 'scrap_spoilage';
  returnReason: string;
  customReturnReason: string;
  refundPaymentMode: 'Cash' | 'Online';
  refundAccountId: string;
  correctOriginalSaleMode: boolean;
  /** saleModeLockReason(sale) === null: the "mark original Online" fix is only offered when it can succeed. */
  canCorrectOriginalMode: boolean;
  accounts: AccountOption[];
  processing: boolean;
  onToggleItem: (index: number) => void;
  onQtyChange: (index: number, qty: number) => void;
  onSelectAll: (select: boolean) => void;
  onReturnActionChange: (action: 'refund' | 'replace') => void;
  onRestockChange: (option: 'restock' | 'scrap_spoilage') => void;
  onReasonChange: (reason: string) => void;
  onCustomReasonChange: (reason: string) => void;
  onRefundModeChange: (mode: 'Cash' | 'Online') => void;
  onRefundAccountChange: (accountId: string) => void;
  onCorrectOriginalChange: (checked: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}

const FORM_ID = 'sale-return-form';
const maxReturnQty = (item: ReturnItemSelection) => (item.remainingQty !== undefined ? item.remainingQty : item.soldQty);

type StockMode = 'restock' | 'scrap' | 'replace';

/** "Wapas: +24 pcs loose stock mein" — which pile this line moves, in the words the cashier reads. */
function pileText(item: ReturnItemSelection, mode: StockMode): string {
  if (mode === 'scrap') return 'Stock mein wapas nahi jayega (spoilage)';
  const qty = item.isSelected ? item.returnQty : 0;
  const pile = returnLinePile(item, qty);
  // "2 × 500 g tub" for packs, "24 pcs" for loose (a dozen line counted in pieces).
  const amount = qty <= 0 || pile.amount === null ? ''
    : pile.kind === 'pack' ? `${formatQty(pile.amount, 3)} × ${pile.unit}` : `${formatQty(pile.amount, 3)} ${pile.unit}`.trim();
  const where = amount && pile.kind === 'pack' ? 'pack stock' : pile.name;
  if (mode === 'replace') return amount ? `Naya maal: ${amount} ${where} se niklega` : `Naya maal ${where} se niklega`;
  return amount ? `Wapas: +${amount} ${where} mein` : `${where} mein wapas jayega`;
}

const ReturnLine = memo(function ReturnLine({ item, index, mode, onToggle, onQtyChange }: {
  item: ReturnItemSelection;
  index: number;
  mode: StockMode;
  onToggle: (index: number) => void;
  onQtyChange: (index: number, qty: number) => void;
}) {
  const max = maxReturnQty(item);
  const exhausted = max <= 0;
  const unit = item.unit || 'L';
  const returnedBefore = cleanQty(item.soldQty - max);
  const lineValue = (item.isSelected ? item.returnQty : 0) * item.price;
  // Steppers move by one unit; the page clamps to what is left and floors pack lines.
  const step = (delta: number) => onQtyChange(index, cleanQty((item.returnQty || 0) + delta));

  return (
    <li className={cn('flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between', !item.isSelected && 'bg-surface-2/50')}>
      <label className={cn('flex min-w-0 flex-1 items-start gap-3', exhausted ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
        <input
          type="checkbox"
          checked={item.isSelected}
          disabled={exhausted}
          onChange={() => onToggle(index)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-brand-accent disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-fg">{item.name}</span>
          <span className="block text-xs tabular-nums text-fg-subtle">
            Sold: {formatQty(item.soldQty, 3)} {unit} • {formatCurrency(item.price)}/{unit}
          </span>
          {exhausted ? (
            <Badge className="mt-1">Pura wapas ho chuka</Badge>
          ) : (
            <>
              <span className={cn('block text-xs font-medium tabular-nums', returnedBefore > 0 ? 'text-warning-fg' : 'text-fg-subtle')}>
                Wapas ho sakta hai: {formatQty(max, 3)} {unit}{returnedBefore > 0 ? ` (pehle ${formatQty(returnedBefore, 3)} ${unit} wapas)` : ''}
              </span>
              <span className={cn('mt-0.5 block text-xs font-medium tabular-nums', mode === 'scrap' ? 'text-fg-faint' : 'text-brand-fg')}>
                {pileText(item, mode)}
              </span>
            </>
          )}
        </span>
      </label>

      {!exhausted && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:flex-nowrap sm:justify-end">
          <div className="flex items-center gap-1.5">
            <IconButton
              variant="secondary"
              aria-label={`${item.name}: ek kam`}
              icon={<Minus />}
              disabled={!item.isSelected || item.returnQty <= 0}
              onClick={() => step(-1)}
            />
            <Input
              type="number"
              inputMode="decimal"
              aria-label={`${item.name} return qty (${unit})`}
              step={item.wholeOnly ? 1 : 'any'}
              min="0"
              max={max}
              value={item.returnQty === 0 ? '' : item.returnQty}
              onChange={event => onQtyChange(index, parseFloat(event.target.value))}
              disabled={!item.isSelected}
              placeholder="0"
              className="w-16 px-2 text-center font-semibold tabular-nums"
            />
            <IconButton
              variant="secondary"
              aria-label={`${item.name}: ek zyada`}
              icon={<Plus />}
              disabled={!item.isSelected || item.returnQty >= max}
              onClick={() => step(1)}
            />
            <span className="min-w-7 max-w-20 truncate text-xs font-semibold text-fg-subtle" title={unit}>{unit}</span>
          </div>
          <Money
            amount={lineValue}
            title="Qty x rate (bill discount se pehle)"
            className={cn('w-20 text-right text-sm font-semibold', item.isSelected ? 'text-fg' : 'text-fg-faint')}
          />
        </div>
      )}
    </li>
  );
});

/** Return & refund form. Lazy-loaded by Sales History; every rule and the processSalesReturn call stay in the page. */
export default function SaleReturnDialog(props: SaleReturnDialogProps) {
  const {
    sale, items, selectedCount, refundAmount, returnAction, restockOption, returnReason, customReturnReason,
    refundPaymentMode, refundAccountId, correctOriginalSaleMode, canCorrectOriginalMode, accounts, processing,
    onToggleItem, onQtyChange, onSelectAll, onReturnActionChange, onRestockChange, onReasonChange, onCustomReasonChange,
    onRefundModeChange, onRefundAccountChange, onCorrectOriginalChange, onSubmit, onClose,
  } = props;

  const returnable = items.filter(item => maxReturnQty(item) > 0);
  const allSelected = returnable.length > 0 && returnable.every(item => item.isSelected);
  // Line prices are before the bill discount; the refund keeps that discount (proportionalRefund).
  const itemsValue = items.reduce((sum, item) => sum + (item.isSelected && item.returnQty > 0 ? item.returnQty * item.price : 0), 0);
  const adjustment = cleanNumber(refundAmount - itemsValue, 2);
  const isReplace = returnAction === 'replace';
  const finalReason = returnReason === 'Other' ? customReturnReason : returnReason;
  // Same rule processSalesReturn applies: a "spoiled / defective" reason never puts stock back.
  const reasonForcesScrap = !isReplace && restockOption === 'restock' && returnIsScrap('restock', finalReason);
  const stockMode: StockMode = isReplace ? 'replace' : returnIsScrap(restockOption, finalReason) ? 'scrap' : 'restock';
  const showRefundPayment = returnAction === 'refund' && sale.payment_mode !== 'Credit';
  const refundAccounts = accounts
    .filter(a => a.isActive !== false)
    .filter(a => refundPaymentMode === 'Cash' ? (a.type === 'Cash' || a.type === 'Drawer') : (a.type === 'Bank' || a.type === 'Wallet'));

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!processing}
      size="lg"
      title="Return & Refund"
      description={<span className="font-mono">Bill: {sale.bill_number}</span>}
      icon={
        <span className="flex size-10 items-center justify-center rounded-control bg-warning-soft text-warning-fg">
          <RotateCcw className="size-5" aria-hidden="true" />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={processing}>Cancel</Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant={isReplace ? 'primary' : 'danger'}
            loading={processing}
            disabled={selectedCount === 0}
            leftIcon={<RotateCcw />}
          >
            {processing ? 'Processing...' : `Confirm Return (${selectedCount})`}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <fieldset disabled={processing} className="min-w-0 space-y-4">
          <section aria-labelledby={`${FORM_ID}-items`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 id={`${FORM_ID}-items`} className="text-xs font-semibold text-fg-muted">Select Items to Return</h3>
              <Button size="sm" variant="ghost" onClick={() => onSelectAll(!allSelected)} disabled={returnable.length === 0}>
                {allSelected ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-control bg-surface ring-1 ring-inset ring-line">
              {items.map((item, idx) => (
                <ReturnLine key={idx} item={item} index={idx} mode={stockMode} onToggle={onToggleItem} onQtyChange={onQtyChange} />
              ))}
            </ul>
          </section>

          <div role="group" aria-labelledby={`${FORM_ID}-resolution`}>
            <p id={`${FORM_ID}-resolution`} className="mb-2 text-xs font-semibold text-fg-muted">Resolution Method</p>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceCard selected={returnAction === 'refund'} onSelect={() => onReturnActionChange('refund')} icon={<Banknote />} title="Refund Money" />
              <ChoiceCard selected={isReplace} onSelect={() => onReturnActionChange('replace')} icon={<RotateCcw />} title="Replace Item" />
            </div>
          </div>

          <div className="space-y-1.5 rounded-control bg-surface-2 p-3 text-sm ring-1 ring-inset ring-line/70" aria-live="polite">
            <SummaryRow label="Items value (qty x rate)"><Money amount={itemsValue} /></SummaryRow>
            {!isReplace && Math.abs(adjustment) >= 0.01 && (
              <SummaryRow label={sale.discount > 0 ? 'Bill discount' : 'Bill adjustment'}>
                {adjustment < 0 ? '- ' : '+ '}<Money amount={Math.abs(adjustment)} />
              </SummaryRow>
            )}
            <div className="flex items-end justify-between gap-3 border-t border-line pt-2">
              <div className="min-w-0">
                <p className="font-semibold text-fg">{isReplace ? 'Replacement Value' : 'Total Refund Amount'}</p>
                <p className="text-xs text-fg-subtle">
                  Selected: <strong className="text-fg-muted">{selectedCount} item(s)</strong> • Mode: <strong className="text-fg-muted">{sale.payment_mode}</strong>
                </p>
              </div>
              <div className="shrink-0 text-right">
                {isReplace ? (
                  <>
                    <Money amount={0} className="block text-xl font-bold text-fg" />
                    <span className="block text-xs text-fg-subtle">(Fresh stock worth <Money amount={refundAmount} /> issued)</span>
                  </>
                ) : (
                  <Money amount={refundAmount} className="text-xl font-bold text-danger-fg" />
                )}
              </div>
            </div>
          </div>

          <Field label="Return Reason" required>
            {control => (
              <Select {...control} value={returnReason} onChange={event => onReasonChange(event.target.value)}>
                <option value="Customer Changed Mind">Customer Changed Mind</option>
                <option value="Defective / Spoiled Product">Defective / Spoiled Product</option>
                <option value="Wrong Item Billed">Wrong Item Billed</option>
                <option value="Packaging Damaged">Packaging Damaged</option>
                <option value="Other">Other Reason...</option>
              </Select>
            )}
          </Field>

          {returnReason === 'Other' && (
            <Field label="Reason Description">
              {control => (
                <Input
                  {...control}
                  type="text"
                  required
                  placeholder="Describe reason..."
                  value={customReturnReason}
                  onChange={event => onCustomReasonChange(event.target.value)}
                />
              )}
            </Field>
          )}

          {returnAction === 'refund' && (
            <div role="group" aria-labelledby={`${FORM_ID}-disposal`}>
              <p id={`${FORM_ID}-disposal`} className="mb-2 text-xs font-semibold text-fg-muted">Stock Disposal</p>
              <div className="grid grid-cols-2 gap-2">
                <ChoiceCard
                  selected={restockOption === 'scrap_spoilage'}
                  onSelect={() => onRestockChange('scrap_spoilage')}
                  icon={<Trash2 />}
                  title="Dump as Spoilage"
                />
                <ChoiceCard
                  selected={restockOption === 'restock'}
                  onSelect={() => onRestockChange('restock')}
                  icon={<Undo2 />}
                  title="Restock to Counter"
                />
              </div>
              {reasonForcesScrap && (
                <p role="status" className="mt-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
                  Reason "{finalReason}" kharab maal batata hai, is liye stock wapas nahi jayega (spoilage). Maal theek hai to reason badlein.
                </p>
              )}
            </div>
          )}

          {showRefundPayment && (
            <div className="space-y-3">
              <div role="group" aria-labelledby={`${FORM_ID}-refund-mode`}>
                <p id={`${FORM_ID}-refund-mode`} className="mb-2 text-xs font-semibold text-fg-muted">Refund Kis Tarah Dena Hy? (Payment Mode)</p>
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceCard selected={refundPaymentMode === 'Cash'} onSelect={() => onRefundModeChange('Cash')} icon={<Banknote />} title="Cash (Drawer)" />
                  <ChoiceCard selected={refundPaymentMode === 'Online'} onSelect={() => onRefundModeChange('Online')} icon={<Wallet />} title="Online / Bank Transfer" />
                </div>
              </div>

              {sale.payment_mode === 'Cash' && canCorrectOriginalMode && (
                <label className="flex cursor-pointer items-start gap-3 rounded-control bg-warning-soft p-3 ring-1 ring-inset ring-warning/25">
                  <input
                    type="checkbox"
                    checked={correctOriginalSaleMode}
                    onChange={event => onCorrectOriginalChange(event.target.checked)}
                    className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-warning"
                  />
                  <span className="text-left">
                    <span className="block text-sm font-semibold text-warning-fg">
                      Ghalati se Cash select hua tha? Original sale ko "Online" mark karein
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-warning-fg/90">
                      Customer ne online pay kiya tha lekin sale Cash par cut gayi thi? Is option ko tick karein taake sale "Online" me convert ho jaye aur Cash Drawer ka balance theek rahe.
                    </span>
                  </span>
                </label>
              )}

              <Field label={refundPaymentMode === 'Cash' ? 'Deduct From Cash Account' : 'Deduct From Bank / Digital Account'}>
                {control => (
                  <Select {...control} value={refundAccountId} onChange={event => onRefundAccountChange(event.target.value)}>
                    <option value="">Auto-Detect Default Account</option>
                    {refundAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.type}) - Bal: {formatCurrency(acc.balance)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
