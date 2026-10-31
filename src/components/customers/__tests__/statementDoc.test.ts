import { describe, expect, it } from 'vitest';
import type { Customer, CustomerTransaction } from '../../../types';
import { buildLedger, ledgerForPeriod } from '../customerUtils';
import { statementFilename, statementHtml } from '../statementDoc';

const customer = { id: 'c1', name: 'Ali <b>Khan</b>', balance: 900, phone: '0300-1234567' } as Customer;
const tx = (id: string, date: string, type: string, amount: number, note?: string) =>
  ({ id, customer_id: 'c1', date, type, amount, note } as unknown as CustomerTransaction);
const { entries } = buildLedger(customer, [], [
  tx('a', '2026-09-20', 'Charge', 1000),
  tx('b', '2026-10-05', 'Payment', 100),
  tx('c', '2026-10-06', 'Charge', 0.5, '<img src=x onerror=alert(1)>'),
], new Map(), false);

const html = (from: string, to: string, extra: Partial<Parameters<typeof statementHtml>[0]> = {}) => {
  const period = ledgerForPeriod(entries, from, to);
  return statementHtml({
    customer, shop: { companyName: 'Mooco', address: '', phone: '', footer: '' }, period, rows: period.entries, from, to,
    ledgerGap: 0, issuedDay: '2026-10-31', ...extra,
  });
};

describe('statementHtml', () => {
  it('escapes names and notes, which come from user input', () => {
    const doc = html('', '');
    expect(doc).not.toContain('<b>Khan</b>');
    expect(doc).not.toContain('<img src=x');
    expect(doc).toContain('Ali &lt;b&gt;Khan&lt;/b&gt;');
  });

  it('prints the duration and the carried balance for a chosen duration', () => {
    const doc = html('2026-10-01', '2026-10-31');
    expect(doc).toContain('01 Oct 2026 – 31 Oct 2026');
    expect(doc).toContain('Opening balance');
  });

  it('runs an all-time statement from the first entry, with no carried row', () => {
    const doc = html('', '');
    expect(doc).toContain('20 Sept 2026 – 31 Oct 2026');
    expect(doc).not.toContain('Opening balance');
  });

  it('lists the oldest entry first', () => {
    const doc = html('', '');
    expect(doc.indexOf('Payment Received')).toBeLessThan(doc.indexOf('onerror'));
  });

  it('says so when a filter left rows out', () => {
    const doc = html('', '', { rows: entries.filter(e => e.type === 'Payment'), filterNote: 'Filtered statement: Payments.' });
    expect(doc).toContain('Filtered statement: Payments.');
    expect(doc).toContain('Total of entries shown');
  });

  it('warns when the stored balance and the entries disagree', () => {
    expect(html('', '', { ledgerGap: 500 })).toContain('more than these entries add up to');
    expect(html('', '', { ledgerGap: 500 })).not.toContain('Balance today');
    expect(html('', '')).not.toContain('add up to');
  });

  it('is in colour unless black and white is asked for', () => {
    expect(html('', '')).toContain('<body>');
    expect(html('', '', { mono: true })).toContain('<body class="mono">');
  });

  it('has no signature or other space-takers, and prints on A5', () => {
    const doc = html('', '');
    expect(doc).toContain('size:A5');
    for (const word of ['signature', 'Thank you', 'Computer-generated']) expect(doc).not.toContain(word);
  });

  it('shows a message instead of an empty table', () => {
    expect(html('2026-11-01', '2026-11-30')).toContain('No entries in this duration.');
  });
});

describe('statementFilename', () => {
  it('names the customer and the duration, in characters any phone can save', () => {
    expect(statementFilename('Hotel Al-Madina / Main', '2026-10-01', '2026-10-31')).toBe('Hotel-Al-Madina-Main-statement-2026-10-01_2026-10-31.pdf');
    expect(statementFilename('Ali', '', '')).toBe('Ali-statement-all-time.pdf');
    expect(statementFilename('علی', '', '')).toBe('customer-statement-all-time.pdf');
  });
});
