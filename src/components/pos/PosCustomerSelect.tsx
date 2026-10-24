import React, { memo, useMemo } from 'react';
import { User, UserPlus, X, ChevronDown, Check, PauseCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button, IconButton, Kbd, Money } from '../ui';

/** Long customer lists render only the best matches; typing narrows them down. */
const MAX_VISIBLE_CUSTOMERS = 60;

interface PosCustomerSelectProps {
  customerContainerRef: React.RefObject<HTMLDivElement | null>;
  customerSearchInputRef: React.RefObject<HTMLInputElement | null>;
  customerSearch: string;
  setCustomerSearch: (val: string) => void;
  customerDropdownOpen: boolean;
  setCustomerDropdownOpen: (open: boolean) => void;
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  customers: any[];
  filteredCustomers: any[];
  setNewCustomerModalOpen: (open: boolean) => void;
  cartLength: number;
  handleHoldOrder: () => void;
  paymentMode?: string;
  /** Holding is paused while a sale is being saved. */
  locked?: boolean;
}

export const PosCustomerSelect = memo(function PosCustomerSelect({
  customerContainerRef,
  customerSearchInputRef,
  customerSearch,
  setCustomerSearch,
  customerDropdownOpen,
  setCustomerDropdownOpen,
  selectedCustomerId,
  setSelectedCustomerId,
  customers,
  filteredCustomers,
  setNewCustomerModalOpen,
  cartLength,
  handleHoldOrder,
  paymentMode,
  locked = false
}: PosCustomerSelectProps) {
  const selectedCustomer = useMemo(() => (customers || []).find(c => c.id === selectedCustomerId), [customers, selectedCustomerId]);
  const visibleCustomers = customerDropdownOpen ? filteredCustomers.slice(0, MAX_VISIBLE_CUSTOMERS) : [];
  const hiddenCount = Math.max(0, filteredCustomers.length - visibleCustomers.length);
  const selectedBalance = Number(selectedCustomer?.balance || 0);

  const choose = (id: string) => {
    setSelectedCustomerId(id);
    setCustomerSearch('');
    setCustomerDropdownOpen(false);
  };

  return (
    <div className="pos-customer-select flex items-center gap-2 border-b border-line bg-surface-2/60 p-2.5" ref={customerContainerRef}>
      <div className="relative min-w-0 flex-1">
        <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
        <input
          ref={customerSearchInputRef}
          type="text"
          role="combobox"
          aria-expanded={customerDropdownOpen}
          aria-controls="pos-customer-options"
          aria-autocomplete="list"
          aria-label="Search or select customer"
          placeholder="Search customer..."
          autoComplete="off"
          className={cn(
            'ds-control h-11 w-full rounded-control border border-line bg-surface pl-9 text-sm font-semibold text-fg shadow-e1 outline-none transition-[border-color,box-shadow] duration-150',
            'placeholder:font-normal placeholder:text-fg-faint hover:border-line-strong focus:border-brand-accent focus:ring-4 focus:ring-ring/20',
            selectedCustomerId ? 'pr-12 sm:pr-36' : 'pr-10 md:pr-16',
          )}
          value={customerDropdownOpen ? customerSearch : (selectedCustomer ? selectedCustomer.name : 'Walk-in Customer')}
          onFocus={() => {
            setCustomerDropdownOpen(true);
            setCustomerSearch(selectedCustomerId ? (selectedCustomer?.name || '') : '');
          }}
          onChange={e => {
            setCustomerSearch(e.target.value);
            setCustomerDropdownOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredCustomers.length > 0) choose(filteredCustomers[0].id);
            }
          }}
        />
        {selectedCustomerId ? (
          <div className="absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1">
            {paymentMode === 'Credit' ? (
              <span className="hidden h-6 items-center rounded-full bg-warning-soft px-2 text-[11px] font-bold text-warning-fg ring-1 ring-inset ring-warning/25 sm:inline-flex">Credit</span>
            ) : selectedBalance !== 0 && !customerDropdownOpen ? (
              <span className="hidden h-6 items-center gap-1 rounded-full bg-surface-2 px-2 text-[11px] font-semibold ring-1 ring-inset ring-line sm:inline-flex" title={selectedBalance > 0 ? "Customer's previous due" : "Customer's advance"}>
                <span className="text-fg-subtle">{selectedBalance > 0 ? 'Due' : 'Adv'}</span>
                <Money amount={Math.abs(selectedBalance)} tone="plain" className={selectedBalance > 0 ? 'text-danger-fg' : 'text-success-fg'} />
              </span>
            ) : null}
            <IconButton
              size="sm"
              aria-label="Reset to Walk-in Customer"
              icon={<X />}
              onClick={() => { setSelectedCustomerId(''); setCustomerSearch(''); }}
              className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg"
            />
          </div>
        ) : (
          <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-fg-faint">
            <Kbd className="hidden md:inline-flex">F4</Kbd>
            <ChevronDown className="size-4" aria-hidden="true" />
          </div>
        )}

        {customerDropdownOpen && (
          <div
            id="pos-customer-options"
            role="listbox"
            aria-label="Customers"
            className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-e2 animate-fade-up"
          >
            <CustomerOption selected={!selectedCustomerId} onSelect={() => choose('')}>
              <span className="flex items-center gap-2 font-semibold text-fg">
                <span className="size-2 rounded-full bg-fg-faint" aria-hidden="true" />
                Walk-in Customer (General)
              </span>
            </CustomerOption>

            {visibleCustomers.length > 0 ? (
              visibleCustomers.map(c => {
                const bal = Number(c.balance || 0);
                return (
                  <CustomerOption key={c.id} selected={selectedCustomerId === c.id} onSelect={() => choose(c.id)}>
                    <span className="flex min-w-0 flex-col pr-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-semibold text-fg">{c.name}</span>
                        {bal !== 0 && (
                          <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ring-1 ring-inset', bal > 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-success-soft text-success-fg ring-success/20')}>
                            {bal > 0 ? 'Due' : 'Adv'} <Money amount={Math.abs(bal)} />
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[11px] text-fg-subtle">Ph: {c.phone || 'N/A'}{c.city ? ` · ${c.city}` : ''}</span>
                    </span>
                  </CustomerOption>
                );
              })
            ) : (
              <p className="p-3 text-center text-xs text-fg-subtle">No customer found matching "{customerSearch}"</p>
            )}
            {hiddenCount > 0 && (
              <p className="px-3 py-2 text-center text-[11px] text-fg-subtle">+{hiddenCount} more customers — type a name or phone to search</p>
            )}
          </div>
        )}
      </div>

      <IconButton
        variant="primary"
        size="lg"
        aria-label="Quick Add Customer"
        icon={<UserPlus />}
        onClick={() => setNewCustomerModalOpen(true)}
        className="size-11"
      />

      {cartLength > 0 && (
        <Button
          variant="secondary"
          size="lg"
          className="h-11 px-3 text-warning-fg"
          leftIcon={<PauseCircle />}
          disabled={locked}
          onClick={handleHoldOrder}
          title="Hold / park current order (F8)"
        >
          Hold
          <Kbd className="hidden md:inline-flex">F8</Kbd>
        </Button>
      )}
    </div>
  );
});

function CustomerOption({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode; key?: React.Key }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 w-full cursor-pointer items-center justify-between rounded-[10px] px-3 py-1.5 text-left text-[13px] transition-colors',
        selected ? 'bg-brand-soft' : 'hover:bg-surface-2',
      )}
    >
      {children}
      {selected && <Check className="size-4 shrink-0 text-brand-fg" aria-hidden="true" />}
    </button>
  );
}
