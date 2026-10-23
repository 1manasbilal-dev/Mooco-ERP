import { describe, expect, it } from 'vitest';
import {
  buildMilkSupplierReport,
  formatMilkQty,
  formatMilkRate,
  formatPkWhatsapp,
  milkReportCaption,
  milkReportSheetHtml,
  milkSlipFilename
} from '../milkSupplierReport';

const purchases = [
  { id: 'a', supplier_id: 's1', date: '2026-10-01T01:00:00Z', quantity: 40, milk_type: 'Buffalo', shift: 'Morning', rate: 160, fat: 7, total_amount: 6400, paid_amount: 1000 },
  { id: 'b', supplier_id: 's1', date: '2026-10-01T13:00:00Z', quantity: 20, milk_type: 'cow', shift: 'evening', rate: 120, fat: 4, total_amount: 2400 },
  { id: 'c', supplier_id: 's1', date: '2026-10-01T20:30:00Z', quantity: 10.255, milk_type: 'Buffalo', shift: 'Night', total_amount: 1641.6 },
  { id: 'd', supplier_id: 's1', date: '2026-10-03T01:00:00Z', quantity: 30, milk_type: 'Buffalo', shift: 'Morning', rate: 160, total_amount: 4800, status: 'Returned' },
  { id: 'e', supplier_id: 's2', date: '2026-10-01T01:00:00Z', quantity: 99, milk_type: 'Cow', shift: 'Morning', rate: 100, total_amount: 9900 },
  { id: 'f', supplier_id: 's1', date: '2026-10-05', quantity: 0, total_amount: 0 }
];

describe('buildMilkSupplierReport', () => {
  it('totals one supplier, skipping returns, other suppliers and empty slips', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1' });
    expect(report.slipCount).toBe(3);
    expect(report.litres).toBe(70.26);
    expect(report.amount).toBe(10441.6);
    expect(report.paid).toBe(1000);
    expect(report.rate).toBe(148.61);
    expect(report.fat).toBe(6);
    expect(report.dayCount).toBe(2);
    expect(report.showFat).toBe(true);
    expect(report.showSnf).toBe(false);
  });

  it('groups by milk with canonical names and shift order', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1', mode: 'milk' });
    expect(report.sections.map(s => [s.title, s.litres, s.slips])).toEqual([['Buffalo', 50.26, 2], ['Cow', 20, 1]]);
    expect(report.shiftBreakdown.map(b => b.label)).toEqual(['Morning', 'Evening', 'Night']);
    expect(report.shiftOptions).toEqual(['Morning', 'Evening', 'Night']);
    expect(report.milkOptions).toEqual(['Buffalo', 'Cow']);
  });

  it('groups by Pakistan day', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1', mode: 'day' });
    // Slip c was saved at 20:30 UTC on the 1st: 01:30 on the 2nd in Pakistan.
    expect(report.sections.map(s => [s.id, s.slips])).toEqual([['day_2026-10-01', 2], ['day_2026-10-02', 1]]);
  });

  it('derives a missing rate from amount and litres', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1' });
    expect(report.sections.flatMap(s => s.lines).find(l => l.id === 'c')?.rate).toBe(160);
  });

  it('filters by milk, shift and inclusive date range', () => {
    const buffaloMorning = buildMilkSupplierReport({ purchases, supplierId: 's1', milkType: 'buffalo', shift: 'MORNING' });
    expect(buffaloMorning.slipCount).toBe(1);
    expect(buffaloMorning.rangeCount).toBe(3);
    expect(buffaloMorning.filterLabel).toBe('buffalo · MORNING');

    const secondOnly = buildMilkSupplierReport({ purchases, supplierId: 's1', from: '2026-10-02', to: '2026-10-02' });
    expect(secondOnly.sections.flatMap(s => s.lines).map(l => l.id)).toEqual(['c']);

    const none = buildMilkSupplierReport({ purchases, supplierId: 's1', from: '2026-11-01', to: '2026-11-30' });
    expect(none.slipCount).toBe(0);
    expect(none.rate).toBe(0);
    expect(none.shiftOptions).toEqual(['Morning', 'Evening']);
  });
});

describe('milk slip text', () => {
  it('formats litres and rates without trailing zeros', () => {
    expect(formatMilkQty(12)).toBe('12');
    expect(formatMilkQty(12.5)).toBe('12.5');
    expect(formatMilkQty(12.255)).toBe('12.26');
    expect(formatMilkRate(160)).toBe('Rs 160');
  });

  it('makes a safe file name', () => {
    expect(milkSlipFilename('Ali / Dairy: Farm', '2026-10-01', '2026-10-15')).toBe('Milk-slip-Ali-Dairy-Farm-2026-10-01_2026-10-15.png');
    expect(milkSlipFilename('???')).toBe('Milk-slip-supplier-all.png');
  });

  it('turns local and international numbers into wa.me form', () => {
    expect(formatPkWhatsapp('0300-1234567')).toBe('923001234567');
    expect(formatPkWhatsapp('+92 300 1234567')).toBe('923001234567');
    expect(formatPkWhatsapp('0092 300 1234567')).toBe('923001234567');
    expect(formatPkWhatsapp('3001234567')).toBe('923001234567');
    expect(formatPkWhatsapp('')).toBe('');
  });

  it('escapes supplier text in the printable sheet', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1' });
    const html = milkReportSheetHtml({
      company: { name: 'Mooco <Dairy>' },
      supplier: { id: 's1', name: '<img src=x onerror=alert(1)>', pendingBalance: 0 },
      report
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Mooco &lt;Dairy&gt;');
  });

  it('writes a WhatsApp caption', () => {
    const report = buildMilkSupplierReport({ purchases, supplierId: 's1' });
    const caption = milkReportCaption({ companyName: 'Mooco', supplierName: 'Ali', report, balanceLabel: 'Rs 500 Payable' });
    expect(caption).toContain('Milk: 70.26 L');
    expect(caption).toContain('Amount: Rs 10,441.6');
    expect(caption).toContain('Net Balance: Rs 500 Payable');
  });
});
