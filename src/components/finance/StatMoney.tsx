import { Money } from '../ui';
import { useMediaQuery, BREAKPOINTS } from '../../hooks/useMediaQuery';
import { cn } from '../../lib/cn';

/**
 * Amount for a StatCard. On phones the two-column grid has no room for 7-digit rupees,
 * so amounts of a million or more switch to "Rs 1.3M" there; the exact figure stays in the tooltip.
 */
export function StatMoney({ amount, negativeRed = false }: { amount: number; negativeRed?: boolean }) {
  const wide = useMediaQuery(BREAKPOINTS.sm);
  return (
    <Money
      amount={amount}
      compact={!wide && Math.abs(amount) >= 1_000_000}
      className={cn(negativeRed && amount < 0 && 'text-danger-fg')}
    />
  );
}
