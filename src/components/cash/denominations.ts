// Pakistani notes and coins, largest first. Shared by the count dialog, Cash Control and POS shifts.
export const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 1];

export type DenominationCounts = Record<string | number, number>;

/** Whole, non-negative piece count; anything else (blank, "-3", "2.5", NaN) counts as 0. */
export const pieceCount = (value: unknown): number => {
  const count = Math.floor(Number(value) || 0);
  return count > 0 ? count : 0;
};

export const denominationTotal = (counts: DenominationCounts | null | undefined): number =>
  DENOMINATIONS.reduce((sum, denomination) => sum + denomination * pieceCount(counts?.[denomination]), 0);

export const denominationPieces = (counts: DenominationCounts | null | undefined): number =>
  DENOMINATIONS.reduce((sum, denomination) => sum + pieceCount(counts?.[denomination]), 0);

/** Non-zero entries only, largest note first. */
export const denominationEntries = (counts: DenominationCounts | null | undefined): Array<[number, number]> =>
  DENOMINATIONS.map(denomination => [denomination, pieceCount(counts?.[denomination])] as [number, number]).filter(([, count]) => count > 0);

/**
 * Takes `requestedAmount` out of the counted notes, largest first. Returns {} when the notes on
 * hand cannot make the exact amount, so a wrong breakdown is never recorded.
 */
export const splitDenominations = (source: DenominationCounts, requestedAmount: number): DenominationCounts => {
  let remaining = Math.max(0, Math.round(requestedAmount * 100) / 100);
  const result: DenominationCounts = {};
  for (const denomination of DENOMINATIONS) {
    const available = pieceCount(source[denomination]);
    const take = Math.min(available, Math.floor((remaining + 0.001) / denomination));
    if (take > 0) {
      result[denomination] = take;
      remaining = Math.round((remaining - take * denomination) * 100) / 100;
    }
  }
  return Math.abs(remaining) < 0.01 ? result : {};
};
