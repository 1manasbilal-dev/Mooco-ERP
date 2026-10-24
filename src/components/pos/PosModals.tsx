import React, { useRef } from 'react';
import {
  PauseCircle, PlayCircle, Trash2, Keyboard, CheckCircle2, Printer, UserPlus, User, Phone, MessageCircle,
  MapPin, Edit3, Minus, Plus
} from 'lucide-react';
import { HeldOrder, PosNewCustomerData, LastCompletedSale } from './PosTypes';
import { formatQty, formatCurrency, cleanQty } from '../../lib/formatters';
import { SmartNumberInput } from '../SmartNumberInput';
import { stepQuickQuantity, stepWholeQuantity } from '../../lib/posQuickEntry';
import { sellLineCaption, sellUnitContains } from '../../lib/sellUnits';
import { optionStockText, type PosSellOption } from './posStock';
import { cn } from '../../lib/cn';
import { Button, EmptyState, Field, IconButton, Input, Kbd, Label, Modal, Money, SegmentedControl, confirmAction, controlClass } from '../ui';
import { printReceipt } from './printReceipt';

const dialogIcon = (icon: React.ReactNode, tone: 'brand' | 'warning' | 'success' = 'brand') => (
  <span className={cn(
    'flex size-10 items-center justify-center rounded-xl [&_svg]:size-5',
    tone === 'brand' && 'bg-brand-soft text-brand-fg',
    tone === 'warning' && 'bg-warning-soft text-warning-fg',
    tone === 'success' && 'bg-success-soft text-success-fg',
  )}>{icon}</span>
);

/** "10:42 AM", or "Kal 10:42 AM" / date for bills parked on an earlier day (the id carries the park time). */
const parkedWhen = (held: HeldOrder) => {
  const parkedAt = Number(String(held.id).replace(/^hold_/, ''));
  if (!Number.isFinite(parkedAt) || parkedAt <= 0) return held.timestamp;
  const parked = new Date(parkedAt);
  const today = new Date();
  const dayDiff = Math.round((new Date(today.toDateString()).getTime() - new Date(parked.toDateString()).getTime()) / 86_400_000);
  if (dayDiff <= 0) return held.timestamp;
  if (dayDiff === 1) return `Kal ${held.timestamp}`;
  return `${parked.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${held.timestamp}`;
};

interface PosHeldOrdersModalProps {
  open: boolean;
  onClose: () => void;
  heldOrders: HeldOrder[];
  handleRecallOrder: (held: HeldOrder) => void;
  handleDeleteHeldOrder: (heldId: string) => void;
}

export const PosHeldOrdersModal: React.FC<PosHeldOrdersModalProps> = ({ open, onClose, heldOrders, handleRecallOrder, handleDeleteHeldOrder }) => {
  const removeHeld = async (held: HeldOrder) => {
    const ok = await confirmAction({
      tone: 'danger',
      title: 'Parked bill delete karein?',
      message: `${held.customerName} · ${formatCurrency(held.grandTotal)}`,
      consequences: [`Is bill ke ${held.cart.length} item(s) hamesha ke liye hat jayenge.`, 'Stock ya khaate par koi asar nahi (bill save nahi hua tha).'],
      confirmLabel: 'Haan, delete karein',
    });
    if (ok) handleDeleteHeldOrder(held.id);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={dialogIcon(<PauseCircle />, 'warning')}
      title="Held / parked bills"
      description="Parked bill ko wapas cart mein laayein."
    >
      {heldOrders.length === 0 ? (
        <EmptyState size="compact" icon={<PauseCircle />} title="Koi bill park nahi" description="Cart mein items hon to Hold (F8) se bill park karein." />
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pb-1">
          {heldOrders.map(held => (
            <li key={held.id} className="flex items-center justify-between gap-3 rounded-control border border-line bg-surface p-3 shadow-e1">
              <div className="min-w-0">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-bold text-fg">{held.customerName}</span>
                  <span className="rounded-md bg-surface-2 px-1.5 text-[11px] font-semibold tabular-nums leading-5 text-fg-subtle">{parkedWhen(held)}</span>
                </p>
                <p className="mt-1 text-xs text-fg-subtle">
                  {held.cart.length} item(s) · <Money amount={held.grandTotal} className="font-bold text-fg" />
                  {held.paymentMode && held.paymentMode !== 'Cash' && <> · {held.paymentMode === 'Credit' ? 'Khata' : held.paymentMode}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="soft" leftIcon={<PlayCircle />} onClick={() => handleRecallOrder(held)}>Recall</Button>
                <IconButton aria-label={`Delete parked bill of ${held.customerName}`} icon={<Trash2 />} onClick={() => void removeHeld(held)} className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

interface PosShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'F2', action: 'Product search' },
  { key: 'Enter', action: 'Search mein pehla product kholein' },
  { key: '↓', action: 'Search se product cards par jayein' },
  { key: 'F4', action: 'Customer search / select' },
  { key: 'F8', action: 'Bill hold / park karein' },
  { key: 'F9', action: 'Sale confirm aur payment complete' },
  { key: 'Esc', action: 'Khula dialog ya list band karein' },
];

export const PosShortcutsModal: React.FC<PosShortcutsModalProps> = ({ open, onClose }) => (
  <Modal
    open={open}
    onClose={onClose}
    icon={dialogIcon(<Keyboard />)}
    title="POS keyboard shortcuts"
    description="Counter par tez kaam ke liye."
  >
    <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
      {SHORTCUTS.map(sc => (
        <li key={sc.key} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-fg-muted">
          <span>{sc.action}</span>
          <Kbd className="h-6 min-w-8 px-2 text-[11px]">{sc.key}</Kbd>
        </li>
      ))}
    </ul>
  </Modal>
);

interface PosReceiptModalProps {
  open: boolean;
  onClose: () => void;
  lastCompletedSale: LastCompletedSale | null;
  settings: any;
}

export const PosReceiptModal: React.FC<PosReceiptModalProps> = ({ open, onClose, lastCompletedSale, settings }) => {
  const paper = useRef<HTMLDivElement>(null);
  const printButton = useRef<HTMLButtonElement>(null);
  if (!lastCompletedSale) return null;
  const sale = lastCompletedSale;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      icon={dialogIcon(<CheckCircle2 />, 'success')}
      title="Sale completed"
      description={<>Bill <span className="font-mono font-semibold">{sale.invoiceNo}</span> · <Money amount={sale.grandTotal} className="font-semibold" /></>}
      initialFocusRef={printButton}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button ref={printButton} leftIcon={<Printer />} onClick={() => printReceipt(paper.current)}>Print receipt</Button>
        </>
      }
    >
      <div ref={paper} className="receipt-paper space-y-4 rounded-control border border-line p-5 font-mono text-xs" id="printable-pos-receipt">
        <div className="receipt-rule space-y-1 border-b pb-3 text-center">
          <h2 className="text-base font-black uppercase tracking-tight">{settings?.general?.companyName || 'Mooco Dairy'}</h2>
          <p className="receipt-muted text-[10px]">{settings?.general?.address || 'Counter POS'}</p>
          <p className="receipt-muted text-[10px]">Ph: {settings?.general?.phone || 'N/A'}</p>
          {settings?.general?.taxId && <p className="receipt-muted text-[10px]">NTN: {settings.general.taxId}</p>}
        </div>

        <div className="receipt-rule space-y-1 border-b pb-3 text-[11px]">
          <div className="flex justify-between gap-2"><span>Inv #:</span><strong>{sale.invoiceNo}</strong></div>
          <div className="flex justify-between gap-2"><span>Date:</span><span>{sale.date} {sale.time}</span></div>
          <div className="flex justify-between gap-2"><span>Customer:</span><strong className="text-right">{sale.customerName}</strong></div>
          <div className="flex justify-between gap-2"><span>Payment:</span><strong>{sale.paymentMode}</strong></div>
        </div>

        <table className="receipt-rule w-full border-b text-left text-[11px]">
          <thead>
            <tr className="receipt-line border-b">
              <th className="py-1 font-bold">Item</th>
              <th className="py-1 text-center font-bold">Qty</th>
              <th className="py-1 text-right font-bold">Amt</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item: any, idx: number) => (
              <tr key={idx} className="receipt-line border-b last:border-0">
                <td className="max-w-[120px] py-1 pr-1">{item.name} {item.variantName ? `(${item.variantName})` : ''}</td>
                <td className="py-1 text-center">{formatQty(item.qty)}</td>
                {/* A "Rs 100 of milk" line bills its typed amount, not rate x rounded qty, so lines add up to the subtotal. */}
                <td className="py-1 text-right">{formatCurrency(item.customTotal !== undefined && item.customTotal !== null && Number.isFinite(Number(item.customTotal)) ? Number(item.customTotal) : (Number(item.total) || (Number(item.price) || 0) * (Number(item.qty) || 0)), '')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 text-right text-[11px] font-bold">
          <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(sale.subtotal)}</span></div>
          {sale.discountAmount > 0 && (
            <div className="receipt-good flex justify-between"><span>Discount:</span><span>- {formatCurrency(sale.discountAmount)}</span></div>
          )}
          <div className="receipt-line flex justify-between border-t pt-1 text-sm font-extrabold"><span>TOTAL:</span><span>{formatCurrency(sale.grandTotal)}</span></div>
          <div className="flex justify-between"><span>Paid:</span><span>{formatCurrency(sale.paidAmount)}</span></div>
          {sale.dueAmount > 0 && <div className="receipt-warn flex justify-between"><span>Khata / Due:</span><span>{formatCurrency(sale.dueAmount)}</span></div>}
          {sale.paymentMode === 'Cash' && sale.cashGiven > 0 && (
            <>
              <div className="receipt-muted flex justify-between text-[10px] font-normal"><span>Cash Received:</span><span>{formatCurrency(sale.cashGiven)}</span></div>
              <div className="receipt-muted flex justify-between text-[10px] font-normal"><span>Change Returned:</span><span>{formatCurrency(sale.changeReturn)}</span></div>
            </>
          )}
        </div>

        <div className="receipt-rule receipt-muted border-t pt-2 text-center text-[10px]">
          {settings?.sales?.invoiceFooter || 'Thank you for your visit!'}
        </div>
      </div>
    </Modal>
  );
};

interface PosNewCustomerModalProps {
  open: boolean;
  onClose: () => void;
  newCustomer: PosNewCustomerData;
  setNewCustomer: React.Dispatch<React.SetStateAction<PosNewCustomerData>>;
  handleCreateCustomer: (e: React.FormEvent) => void;
  isCreatingCustomer: boolean;
}

const BALANCE_OPTIONS = [
  { value: 'None' as const, label: 'Clean (0)' },
  { value: 'Due' as const, label: 'Due (Receivable)' },
  { value: 'Advance' as const, label: 'Advance (Credit)' },
];

export const PosNewCustomerModal: React.FC<PosNewCustomerModalProps> = ({ open, onClose, newCustomer, setNewCustomer, handleCreateCustomer, isCreatingCustomer }) => {
  const nameRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<PosNewCustomerData>) => setNewCustomer(prev => ({ ...prev, ...patch }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!isCreatingCustomer}
      icon={dialogIcon(<UserPlus />)}
      title="Quick register customer"
      description="Naya customer banayein; ye isi bill mein select ho jayega."
      initialFocusRef={nameRef}
      footer={
        <>
          <Button variant="secondary" disabled={isCreatingCustomer} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="pos-new-customer-form" loading={isCreatingCustomer} leftIcon={<UserPlus />}>Register &amp; select in cart</Button>
        </>
      }
    >
      <form id="pos-new-customer-form" onSubmit={handleCreateCustomer} className="space-y-4">
        <Field label="Customer full name" required>
          {control => (
            <Input
              {...control}
              ref={nameRef}
              required
              inputSize="lg"
              leftIcon={<User />}
              placeholder="e.g. Haji Muhammad Aslam"
              value={newCustomer.name}
              onChange={e => update({ name: e.target.value })}
            />
          )}
        </Field>

        <Field label="Phone number">
          {control => <Input {...control} type="tel" inputMode="tel" leftIcon={<Phone />} placeholder="0300-1234567" value={newCustomer.phone} onChange={e => update({ phone: e.target.value })} />}
        </Field>

        <label className="flex min-h-10 cursor-pointer select-none items-center gap-2.5 rounded-control bg-success-soft px-3 py-2 text-[13px] font-semibold text-success-fg">
          <input
            type="checkbox"
            checked={newCustomer.is_phone_whatsapp}
            onChange={e => update({ is_phone_whatsapp: e.target.checked })}
            className="size-4 rounded accent-[rgb(var(--success))]"
          />
          <MessageCircle className="size-4" aria-hidden="true" />
          Phone number hi WhatsApp hai
        </label>

        {!newCustomer.is_phone_whatsapp && (
          <Field label="WhatsApp number">
            {control => <Input {...control} type="tel" inputMode="tel" leftIcon={<MessageCircle />} placeholder="e.g. 0321-7654321" value={newCustomer.whatsapp} onChange={e => update({ whatsapp: e.target.value })} />}
          </Field>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="City">
            {control => <Input {...control} leftIcon={<MapPin />} placeholder="e.g. Shorkot" value={newCustomer.city} onChange={e => update({ city: e.target.value })} />}
          </Field>
          <Field label="Street / shop address">
            {control => <Input {...control} placeholder="House #, Mohallah, Road..." value={newCustomer.address} onChange={e => update({ address: e.target.value })} />}
          </Field>
        </div>

        <div className="space-y-2.5 rounded-control bg-surface-2 p-3 ring-1 ring-inset ring-line/70">
          <Label className="mb-0">Opening balance (starting khata)</Label>
          <SegmentedControl
            aria-label="Opening balance type"
            fullWidth
            options={BALANCE_OPTIONS}
            value={newCustomer.balanceType}
            onChange={value => update(value === 'None' ? { balanceType: 'None', balanceAmount: '' } : { balanceType: value })}
          />
          {newCustomer.balanceType !== 'None' && (
            <div>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
                <SmartNumberInput
                  min="0"
                  step="any"
                  required
                  aria-label="Opening balance amount"
                  placeholder="Opening balance likhein..."
                  className={cn(controlClass, 'h-10 pl-9 pr-3 font-bold tabular-nums')}
                  value={newCustomer.balanceAmount}
                  onChange={val => update({ balanceAmount: val })}
                />
              </div>
              <p className={cn('mt-1.5 text-xs font-semibold', newCustomer.balanceType === 'Due' ? 'text-danger-fg' : 'text-success-fg')}>
                {newCustomer.balanceType === 'Due' ? 'Customer ne ye raqam deni hai (due).' : 'Customer ki ye raqam aap ke paas jama hai (advance).'}
              </p>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
};

interface PosEditItemModalProps {
  editingCartItem: any;
  setEditingCartItem: (item: any) => void;
  editRate: string;
  handleEditRateChange: (val: string) => void;
  editQty: string;
  handleEditQtyChange: (val: string) => void;
  editTotal: string;
  handleEditTotalChange: (val: string) => void;
  editVariantId: string;
  onSellUnitChange: (variantId: string) => void;
  items: any[];
  /** Units this product sells now, with stock after the rest of the cart (this line left out). */
  sellOptions: PosSellOption[];
  allowNegativeStock: boolean;
  onRemove: (item: any) => void;
  handleSaveEditItem: () => void;
}

export const PosEditItemModal: React.FC<PosEditItemModalProps> = ({
  editingCartItem,
  setEditingCartItem,
  editRate,
  handleEditRateChange,
  editQty,
  handleEditQtyChange,
  editTotal,
  handleEditTotalChange,
  editVariantId,
  onSellUnitChange,
  items,
  sellOptions,
  allowNegativeStock,
  onRemove,
  handleSaveEditItem,
}) => {
  if (!editingCartItem) return null;

  const productDef = (items || []).find(i => i.id === editingCartItem.id);
  const variants = (productDef?.variants || []).filter((v: any) => v.isActive !== false);
  const baseUnit = productDef?.unit || editingCartItem.baseUnit || editingCartItem.unit || 'Unit';
  const selectedVariant = editVariantId !== 'base' ? variants.find((v: any) => v.id === editVariantId) : null;
  // The line's own pack was hidden after it was added: say so instead of quietly showing it as loose.
  const hiddenUnit = editVariantId !== 'base' && !selectedVariant
    ? (productDef?.variants || []).find((v: any) => v.id === editVariantId)
    : null;
  const looseEdit = !selectedVariant;
  const selectedOption = hiddenUnit ? undefined : sellOptions.find(o => o.id === (selectedVariant ? selectedVariant.id : 'base'));
  const typedQty = parseFloat(editQty) || 0;
  // Stock left in the selected unit's pile once this line (at the typed quantity) is on the bill.
  const leftAfter = selectedOption
    ? (selectedOption.kind === 'packed' ? selectedOption.pileLeft - typedQty : (selectedOption.pileLeft - typedQty * selectedOption.contains) / selectedOption.contains)
    : null;
  const editContains = selectedVariant ? sellUnitContains(selectedVariant) : 1;
  // Labels follow the unit picked in this dialog, not the line's unit before the change.
  const selectedUnitName = looseEdit ? baseUnit : (selectedVariant.name || 'Pack');
  const editCaption = sellLineCaption({
    qty: parseFloat(editQty) || 0,
    unit: looseEdit ? baseUnit : selectedVariant.name,
    baseUnit,
    variantName: selectedVariant?.name,
    stockDeduction: editContains,
    isLoose: looseEdit
  });
  const minimumQty = looseEdit ? (['kg'].includes(baseUnit.toLowerCase()) ? 0.25 : ['l', 'liter', 'liters'].includes(baseUnit.toLowerCase()) ? 0.5 : 1) : 1;
  const step = (direction: number) => {
    const cur = parseFloat(editQty) || 0;
    const next = looseEdit ? stepQuickQuantity(cur, direction, baseUnit, false) : stepWholeQuantity(cur, direction, 1);
    handleEditQtyChange(cleanQty(next).toString());
  };
  const close = () => setEditingCartItem(null);
  const unitOption = (option: PosSellOption) => {
    const selected = editVariantId === option.id;
    const title = option.kind === 'loose' ? `1 ${baseUnit}` : `${option.name} (${formatQty(option.contains, 3)} ${baseUnit})`;
    const empty = option.available <= 0;
    return (
      <button
        key={option.id}
        type="button"
        aria-pressed={selected}
        aria-label={`${title}, ${formatCurrency(option.price)}, ${optionStockText(option, baseUnit)}`}
        onClick={() => onSellUnitChange(option.id)}
        className={cn(
          'flex min-h-12 cursor-pointer flex-col justify-center rounded-control border px-3 py-2 text-left transition-colors duration-150',
          selected ? 'border-brand-accent bg-brand-soft ring-1 ring-inset ring-brand-accent' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
        )}
      >
        <span className="truncate text-[13px] font-bold text-fg">{title}</span>
        <Money amount={option.price} className={cn('text-xs font-semibold', selected ? 'text-brand-fg' : 'text-fg-subtle')} />
        <span className={cn('text-[11px] font-semibold tabular-nums', empty ? (allowNegativeStock ? 'text-warning-fg' : 'text-danger-fg') : 'text-fg-subtle')}>
          {optionStockText(option, baseUnit)}
        </span>
      </button>
    );
  };

  return (
    <Modal
      open
      onClose={close}
      icon={dialogIcon(<Edit3 />)}
      title={editingCartItem.name}
      description={<>Unit: {editingCartItem.unit} · Base rate: <Money amount={editingCartItem.originalPrice || editingCartItem.price} /></>}
      footer={
        <>
          <Button variant="danger-soft" leftIcon={<Trash2 />} className="sm:mr-auto" onClick={() => onRemove(editingCartItem)}>Remove</Button>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={handleSaveEditItem}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        {hiddenUnit && (
          <p role="status" className="rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
            {hiddenUnit.name || 'Ye pack'} ab hidden hai, is liye bik nahi sakta. Neeche se doosri unit chunein ya line hata dein.
          </p>
        )}
        {(variants.length > 0 || hiddenUnit) && sellOptions.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label className="mb-0">Unit / packaging</Label>
              <span className="text-[11px] text-fg-subtle">Abhi: {editingCartItem.unit}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {sellOptions.map(unitOption)}
            </div>
          </div>
        )}

        <div>
          <Label>Rate / price (per {selectedUnitName})</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
            <SmartNumberInput
              step="any"
              aria-label={`Rate per ${selectedUnitName}`}
              value={editRate}
              onChange={handleEditRateChange}
              placeholder="0.00"
              className={cn(controlClass, 'h-11 pl-9 pr-3 text-base font-bold tabular-nums')}
            />
          </div>
        </div>

        <div>
          <Label>Quantity ({selectedUnitName})</Label>
          <div className="flex items-center gap-1 rounded-control bg-surface-2 p-1 ring-1 ring-inset ring-line">
            <IconButton variant="secondary" aria-label="Decrease edited quantity" icon={<Minus />} disabled={Number(editQty) <= minimumQty} onClick={() => step(-1)} />
            <SmartNumberInput
              step="any"
              aria-label="Edited quantity"
              value={editQty}
              onChange={handleEditQtyChange}
              placeholder="1"
              className="ds-control h-10 w-full bg-transparent text-center text-base font-bold tabular-nums text-fg outline-none"
            />
            <IconButton variant="secondary" aria-label="Increase edited quantity" icon={<Plus />} onClick={() => step(1)} />
          </div>
          {leftAfter !== null && (
            <p className={cn('mt-1.5 text-[11px] font-semibold tabular-nums', leftAfter < -0.0005 ? (allowNegativeStock ? 'text-warning-fg' : 'text-danger-fg') : 'text-fg-subtle')}>
              {leftAfter < -0.0005
                ? `${formatQty(-leftAfter, 3)} ${selectedUnitName} stock se zyada${allowNegativeStock ? ' (minus stock allowed)' : ''}`
                : `Is bill ke baad ${formatQty(leftAfter, 3)} ${selectedUnitName} baqi`}
            </p>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label className="mb-0">Total price (Rs)</Label>
            {parseFloat(editRate) > 0 && (
              <span className="text-[11px] tabular-nums text-fg-subtle">Rate: {formatCurrency(parseFloat(editRate))}/{selectedUnitName}</span>
            )}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-xs font-semibold text-fg-subtle">Rs</span>
            <SmartNumberInput
              step="any"
              aria-label="Line total"
              value={editTotal}
              onChange={handleEditTotalChange}
              placeholder="0.00"
              className={cn(controlClass, 'h-11 pl-9 pr-3 text-base font-bold tabular-nums')}
            />
          </div>
          <p className="mt-1.5 text-xs font-medium text-fg-muted">{editCaption}</p>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            {looseEdit || selectedVariant?.deduct_from_base ? `Changing the total changes how many ${looseEdit ? baseUnit : selectedVariant.name} you sell. The price of one stays.` : 'Changing the total changes the rate. The packed count stays.'}
          </p>
        </div>
      </div>
    </Modal>
  );
};
