import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanNumber,
  cleanQty,
  formatCurrency,
  formatMoneyRaw,
  formatPercent,
  formatQty,
  formatTransactionTime,
  getTodayLocalDate,
  isDateOnlyOrMidnight,
  normalizeTransactionTimestamp
} from '../formatters';

const originalTz = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  // Assigning undefined would set the zone to the string "undefined".
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('cleanNumber', () => {
  it('rounds half-paisa values up, including ones binary floats store just below the half', () => {
    expect(cleanNumber(1.005)).toBe(1.01);
    expect(cleanNumber(10.075)).toBe(10.08);
    expect(cleanNumber(1.255)).toBe(1.26);
    expect(cleanNumber(0.285)).toBe(0.29);
    expect(cleanNumber(0.5 * 20.15)).toBe(10.08);
  });

  it('rounds negative halves away from zero, mirroring positives', () => {
    expect(cleanNumber(-10.075)).toBe(-10.08);
    expect(cleanNumber(-0.125)).toBe(-0.13);
    expect(cleanNumber(-8993.5)).toBe(-8993.5);
  });

  it('removes float drift and never returns negative zero', () => {
    expect(cleanNumber(0.1 + 0.2)).toBe(0.3);
    expect(cleanNumber(1.1 * 3)).toBe(3.3); // 3.3000000000000003
    expect(cleanNumber(60.26 - 1e-14)).toBe(60.26);
    expect(Object.is(cleanNumber(-0.001), 0)).toBe(true);
    expect(Object.is(cleanNumber(-0), 0)).toBe(true);
  });

  it('treats junk as zero and parses numeric strings', () => {
    expect(cleanNumber(null)).toBe(0);
    expect(cleanNumber(undefined)).toBe(0);
    expect(cleanNumber('abc')).toBe(0);
    expect(cleanNumber(Infinity)).toBe(0);
    expect(cleanNumber(NaN)).toBe(0);
    expect(cleanNumber('12.345')).toBe(12.35);
    expect(cleanNumber('')).toBe(0);
  });

  it('honours the decimals argument', () => {
    expect(cleanNumber(1.23456, 3)).toBe(1.235);
    expect(cleanNumber(2.5, 0)).toBe(3);
    expect(cleanNumber(-2.5, 0)).toBe(-3);
    expect(cleanQty(0.1 + 0.7)).toBe(0.8);
    expect(cleanQty(1.0005)).toBe(1.001);
  });

  it('keeps large rupee totals exact', () => {
    expect(cleanNumber(123456789.125)).toBe(123456789.13);
    expect(cleanNumber(9_999_999_999.99)).toBe(9_999_999_999.99);
  });
});

describe('Rs formatting', () => {
  it('formats rupees with grouping and a minus before the prefix', () => {
    expect(formatCurrency(12500)).toBe('Rs 12,500');
    expect(formatCurrency(60.26 - 1e-14)).toBe('Rs 60.26');
    expect(formatCurrency(-8993.5)).toBe('-Rs 8,993.5');
    expect(formatCurrency(1234567.5)).toBe('Rs 1,234,567.5');
    expect(formatCurrency(0)).toBe('Rs 0');
    expect(formatCurrency(null)).toBe('Rs 0');
    expect(formatCurrency(10.075)).toBe('Rs 10.08');
  });

  it('never prints a negative zero', () => {
    expect(formatCurrency(-0.001)).toBe('Rs 0');
    expect(formatQty(-0.0001)).toBe('0');
    expect(formatMoneyRaw(-0.004)).toBe('0');
  });

  it('formats quantities without trailing zeros', () => {
    expect(formatQty(60)).toBe('60');
    expect(formatQty(60.5)).toBe('60.5');
    expect(formatQty(1000.5)).toBe('1,000.5');
    expect(formatQty(0.125, 3)).toBe('0.125');
    expect(formatQty('2.10')).toBe('2.1');
  });

  it('formats percentages', () => {
    expect(formatPercent(30.3333333)).toBe('30.3%');
    expect(formatPercent(30)).toBe('30%');
    expect(formatPercent(-12.25)).toBe('-12.3%');
    expect(formatPercent(12.345, 2)).toBe('12.35%');
  });
});

describe('Pakistan business dates', () => {
  it('rolls the business day at PKT midnight, not UTC midnight', () => {
    vi.useFakeTimers();
    // 2026-10-22 19:30 UTC is 2026-10-23 00:30 PKT.
    vi.setSystemTime(new Date('2026-10-22T19:30:00Z'));
    expect(getTodayLocalDate()).toBe('2026-10-23');
    // 2026-10-22 18:59:59 UTC is still 23:59:59 on the 22nd in Pakistan.
    vi.setSystemTime(new Date('2026-10-22T18:59:59Z'));
    expect(getTodayLocalDate()).toBe('2026-10-22');
  });

  it('gives the PKT date whatever the device zone is', () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T20:00:00Z'));
    expect(getTodayLocalDate()).toBe('2026-10-23');
  });

  it('recognises date-only values and legacy UTC-midnight stamps', () => {
    expect(isDateOnlyOrMidnight('2026-09-22')).toBe(true);
    expect(isDateOnlyOrMidnight('2026-09-22T00:00:00Z')).toBe(true);
    expect(isDateOnlyOrMidnight('2026-09-22T00:00:00.000Z')).toBe(true);
    expect(isDateOnlyOrMidnight('2026-09-22T00:00:00+00:00')).toBe(true);
    expect(isDateOnlyOrMidnight('2026-09-22 00:00:00+00')).toBe(true);
    expect(isDateOnlyOrMidnight('2026-09-22T00:00:00.123Z')).toBe(false);
    expect(isDateOnlyOrMidnight('2026-09-22T10:15:00Z')).toBe(false);
    expect(isDateOnlyOrMidnight('2026-09-22T00:00:00+05:00')).toBe(false);
    expect(isDateOnlyOrMidnight('')).toBe(false);
    expect(isDateOnlyOrMidnight(null)).toBe(false);
  });
});

describe('normalizeTransactionTimestamp', () => {
  it('stores a past date-only entry at noon Pakistan time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z'));
    expect(normalizeTransactionTimestamp('2026-10-20')).toBe('2026-10-20T07:00:00.000Z');
    expect(normalizeTransactionTimestamp('2026-10-20T00:00:00Z')).toBe('2026-10-20T07:00:00.000Z');
  });

  it('keeps the Pakistan date on a device in a far-west zone', () => {
    process.env.TZ = 'Pacific/Honolulu';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z'));
    const stored = normalizeTransactionTimestamp('2026-10-20');
    expect(new Date(stored).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })).toBe('2026-10-20');
  });

  it('stamps today with the current moment', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T20:15:00Z'));
    // 20:15 UTC is already the 23rd in Pakistan.
    expect(normalizeTransactionTimestamp('2026-10-23')).toBe('2026-10-22T20:15:00.000Z');
  });

  it('preserves a real time and falls back to now for empty or bad input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T06:00:00Z'));
    expect(normalizeTransactionTimestamp('2026-10-20T09:30:00+05:00')).toBe('2026-10-20T04:30:00.000Z');
    expect(normalizeTransactionTimestamp('')).toBe('2026-10-23T06:00:00.000Z');
    expect(normalizeTransactionTimestamp(null)).toBe('2026-10-23T06:00:00.000Z');
    expect(normalizeTransactionTimestamp(new Date('invalid'))).toBe('2026-10-23T06:00:00.000Z');
    expect(normalizeTransactionTimestamp('not-a-date')).toBe('2026-10-23T06:00:00.000Z');
  });
});

describe('formatTransactionTime', () => {
  it('shows the bill time in Pakistan time on any device zone', () => {
    process.env.TZ = 'UTC';
    const text = formatTransactionTime('2026-10-22T04:30:00Z');
    expect(text).toMatch(/09:30/);
  });

  it('hides the phantom 05:00 AM of date-only stamps', () => {
    expect(formatTransactionTime('2026-10-22')).toBe('');
    expect(formatTransactionTime('2026-10-22T00:00:00Z', '—')).toBe('—');
    expect(formatTransactionTime('garbage', 'n/a')).toBe('n/a');
    expect(formatTransactionTime(undefined)).toBe('');
  });
});
