/**
 * Universal Formatting & Precision Utility for Mooco Dairy Accounting ERP
 * Eliminates IEEE 754 floating point display glitches (e.g., 60.259999999999992 -> 60.26)
 */

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const formatCompactValue = (value: number) => compactNumber.format(value);

/** Returns a rounded numeric value without floating point display drift. */
export const cleanNumber = (val: number | string | null | undefined, decimals: number = 2): number => {
  const num = typeof val === 'string' ? parseFloat(val) : Number(val);
  if (isNaN(num) || !isFinite(num)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
};

/**
 * Returns a clean quantity rounded to up to 3 decimal places.
 */
export const cleanQty = (val: number | string | null | undefined): number => {
  return cleanNumber(val, 3);
};

/**
 * Formats a quantity/weight/liter number cleanly:
 * - Omits ugly floating trails: 60.259999999999992 -> '60.26'
 * - Omits redundant trailing zeros: 60.00 -> '60', 60.50 -> '60.5'
 * - Formats with thousands separators for large quantities: 1000.5 -> '1,000.5'
 */
export const formatQty = (
  qty: number | string | null | undefined,
  maxDecimals: number = 2
): string => {
  const cleaned = cleanNumber(qty, maxDecimals);
  return cleaned.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals
  });
};

/**
 * Formats monetary amounts cleanly with Pakistani Rupee prefix:
 * - Example: formatCurrency(12500) => 'Rs 12,500'
 * - Example: formatCurrency(60.259999999999992) => 'Rs 60.26'
 * - Example: formatCurrency(-8993.5) => '-Rs 8,993.5'
 */
export const formatCurrency = (
  amount: number | string | null | undefined,
  prefix: string = 'Rs '
): string => {
  const cleaned = cleanNumber(amount, 2);
  const isNegative = cleaned < 0;
  const absFormatted = Math.abs(cleaned).toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  return isNegative ? `-${prefix}${absFormatted}` : `${prefix}${absFormatted}`;
};

/**
 * Clean currency string without 'Rs ' prefix (for inputs or custom badges).
 */
export const formatMoneyRaw = (
  amount: number | string | null | undefined,
  maxDecimals: number = 2
): string => {
  const cleaned = cleanNumber(amount, maxDecimals);
  return cleaned.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals
  });
};

/**
 * Formats rates or prices cleanly:
 * - Example: formatRate(180, 'L') => 'Rs 180/L'
 * - Example: formatRate(60.259999999999992) => 'Rs 60.26'
 */
export const formatRate = (
  rate: number | string | null | undefined,
  unit?: string
): string => {
  const cleaned = cleanNumber(rate, 2);
  const formatted = cleaned.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  return unit ? `Rs ${formatted}/${unit}` : `Rs ${formatted}`;
};

/**
 * Formats percentages cleanly:
 * - Example: formatPercent(30.3333333) => '30.3%'
 */
export const formatPercent = (
  val: number | string | null | undefined,
  decimals: number = 1
): string => {
  const cleaned = cleanNumber(val, decimals);
  return `${cleaned.toFixed(decimals).replace(/\.0+$/, '')}%`;
};

/**
 * Drop-in replacement for the common `money()` helper used across several screens.
 */
export const money = (value: number | undefined | null): string => {
  return formatCurrency(value);
};

/**
 * Returns today's date in local user timezone as 'YYYY-MM-DD'.
 */
export const getTodayLocalDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Detects whether a string or Date is date-only (e.g. 'YYYY-MM-DD') or represents
 * a legacy UTC midnight artifact (e.g. '2026-09-22 00:00:00+00') where no actual time was captured.
 */
export const isDateOnlyOrMidnight = (dateStr?: string | Date | null): boolean => {
  if (!dateStr) return false;
  if (dateStr instanceof Date) {
    return dateStr.getHours() === 0 && dateStr.getMinutes() === 0 && dateStr.getSeconds() === 0;
  }
  const trimmed = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return true;
  if (/T00:00:00(\.0+)?(Z|\+00:?00)?$/i.test(trimmed) || / 00:00:00(\+00)?$/.test(trimmed)) return true;
  return false;
};

/**
 * Central Transaction Timestamp Normalizer:
 * - If no date is given, returns the current ISO timestamp (exact second).
 * - If date matches today (in user's local timezone), records the current ISO timestamp
 *   so the transaction captures the exact moment it was created (hours, minutes, seconds).
 * - If date has no time or is UTC midnight from an HTML <input type="date">, attaches
 *   local noon (12:00:00) on that date to prevent timezone roll-overs and the phantom 05:00 AM bug.
 * - If date already has a non-midnight time, preserves it.
 */
export const normalizeTransactionTimestamp = (dateInput?: string | Date | null): string => {
  if (!dateInput) return new Date().toISOString();

  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? new Date().toISOString() : dateInput.toISOString();
  }

  const trimmed = String(dateInput).trim();
  if (!trimmed) return new Date().toISOString();

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const isMidnight = isDateOnlyOrMidnight(trimmed);

  // If it already has a non-midnight timestamp, preserve it
  if (!isDateOnly && !isMidnight) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const datePart = trimmed.slice(0, 10);
  const today = getTodayLocalDate();

  // If entry date is today, attach current real-time moment
  if (datePart === today) {
    return new Date().toISOString();
  }

  // If entry date is in the past or future, anchor at 12:00:00 local time
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  const targetDate = new Date(y, m - 1, d, 12, 0, 0, 0);
  return targetDate.toISOString();
};

/**
 * Formats a transaction time safely:
 * - If time is empty or is a legacy midnight artifact, returns fallback (default '')
 *   to avoid showing a false '05:00 AM' in Pakistan/UTC+5 timezones.
 * - If time is valid, formats as 'hh:mm AM/PM'.
 */
export const formatTransactionTime = (
  timeStr?: string | Date | null,
  fallback: string = ''
): string => {
  if (!timeStr) return fallback;
  try {
    const d = typeof timeStr === 'string' ? new Date(timeStr) : timeStr;
    if (isNaN(d.getTime())) return fallback;

    // Reject date-only and midnight UTC artifacts from showing false 05:00 AM
    if (typeof timeStr === 'string' && isDateOnlyOrMidnight(timeStr)) {
      return fallback;
    }

    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return fallback;
  }
};

/**
 * Formats a transaction date cleanly as 'DD MMM YYYY'.
 */
export const formatTransactionDate = (
  dateStr?: string | Date | null,
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!dateStr) return '';
  try {
    const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    if (isNaN(d.getTime())) return typeof dateStr === 'string' ? dateStr : '';
    return d.toLocaleDateString('en-GB', options || { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return typeof dateStr === 'string' ? dateStr : '';
  }
};
