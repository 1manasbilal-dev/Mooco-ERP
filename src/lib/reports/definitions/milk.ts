import type { ReportData, ReportDefinition, ReportFilters, ReportRow } from '../types';
import {
  autoGroup, CHART_COLORS, COLOR, dayOf, groupSum, inRange, isMilkPurchaseVoid, lower, n, pct, r2, r3,
  sum, supplierName, timeSeries, topSlices
} from '../helpers';
import { purchaseCashPaid } from '../../moneyFlow';
import type { AllocationEntry, PurchaseEntry } from '../../../types';

const litresOf = (p: PurchaseEntry) => Math.max(0, n(p.quantity));
const fatOf = (p: PurchaseEntry) => n(p.fat ?? p.details?.fat);
const snfOf = (p: PurchaseEntry) => n(p.snf ?? p.details?.snf);
const milkTypeOf = (p: { milk_type?: unknown }) => String(p.milk_type || '').trim() || 'Milk';
const shiftOf = (p: PurchaseEntry): 'morning' | 'evening' | 'other' => {
  const s = lower(p.shift);
  if (s.includes('morn')) return 'morning';
  if (s.includes('even')) return 'evening';
  return 'other';
};
const fmt = (value: number, digits = 0) => value.toLocaleString('en-PK', { maximumFractionDigits: digits });

/** Milk received in the range, without voided or fully returned slips, after the toolbar filters. */
const milkRows = (data: ReportData, f: ReportFilters, opts: { supplier?: boolean } = { supplier: true }) =>
  data.purchases.filter(p =>
    p && !isMilkPurchaseVoid(p.status) && inRange(p.date, f) &&
    (!f.milkType || lower(milkTypeOf(p)) === lower(f.milkType)) &&
    (!f.shift || lower(p.shift).includes(lower(f.shift))) &&
    (!opts.supplier || !f.supplierId || p.supplier_id === f.supplierId)
  );

/** Litre-weighted quality; slips without a reading are left out. */
interface Quality { fatW: number; fatQ: number; snfW: number; snfQ: number; fatMin: number; fatMax: number; snfMin: number; snfMax: number }
const emptyQuality = (): Quality => ({ fatW: 0, fatQ: 0, snfW: 0, snfQ: 0, fatMin: Infinity, fatMax: 0, snfMin: Infinity, snfMax: 0 });
const addQuality = (q: Quality, p: PurchaseEntry) => {
  const litres = litresOf(p), fat = fatOf(p), snf = snfOf(p);
  if (litres > 0 && fat > 0) { q.fatW += fat * litres; q.fatQ += litres; q.fatMin = Math.min(q.fatMin, fat); q.fatMax = Math.max(q.fatMax, fat); }
  if (litres > 0 && snf > 0) { q.snfW += snf * litres; q.snfQ += litres; q.snfMin = Math.min(q.snfMin, snf); q.snfMax = Math.max(q.snfMax, snf); }
};
const avgFat = (q: Quality) => (q.fatQ ? r2(q.fatW / q.fatQ) : 0);
const avgSnf = (q: Quality) => (q.snfQ ? r2(q.snfW / q.snfQ) : 0);
const finite = (v: number) => (Number.isFinite(v) ? r2(v) : 0);

const quality = (rows: PurchaseEntry[]) => {
  const q = emptyQuality();
  rows.forEach(p => addQuality(q, p));
  return q;
};

const DESTINATIONS = ['Retail Counter', 'Home Delivery', 'Production'] as const;
const destKey = (value: unknown) => {
  const v = lower(value);
  if (v.includes('retail') || v.includes('counter')) return 'retail';
  if (v.includes('delivery') || v.includes('supply')) return 'delivery';
  if (v.includes('production')) return 'production';
  return 'other';
};

/** Litres sent to each destination: the allocation history when saved, else the whole allocated amount on the saved destination. */
const destinationSplit = (a: AllocationEntry) => {
  const split = { retail: 0, delivery: 0, production: 0, other: 0 };
  const allocated = Math.max(0, n(a.allocated_quantity));
  const history = Array.isArray(a.details?.allocation_history) ? a.details.allocation_history : [];
  let covered = 0;
  history.forEach((h: any) => {
    const qty = Math.max(0, n(h?.quantity));
    if (!qty) return;
    split[destKey(h?.destination)] += qty;
    covered += qty;
  });
  const gap = allocated - covered;
  if (gap > 0.001) split[a.destination ? destKey(a.destination) : 'other'] += gap;
  return split;
};

export const milkReports: ReportDefinition[] = [
  {
    id: 'milk_collection',
    title: 'Milk Collection Summary',
    subtitle: 'Litres, amount, rate, fat and SNF collected each day, week or month',
    category: 'milk',
    icon: 'Milk',
    keywords: ['milk purchase', 'collection', 'doodh', 'procurement', 'intake', 'litres'],
    filters: ['milkType', 'shift', 'supplierId', 'groupBy'],
    comparable: true,
    build: (data, f) => {
      const rows = milkRows(data, f);
      const groupBy = autoGroup(f);
      const series = timeSeries(rows, p => p.date, f, groupBy, (b, p) => {
        const litres = litresOf(p), fat = fatOf(p), snf = snfOf(p);
        b.entries += 1; b.litres += litres; b.amount += n(p.total_amount); b[shiftOf(p)] += litres;
        if (litres > 0 && fat > 0) { b.fatW += fat * litres; b.fatQ += litres; }
        if (litres > 0 && snf > 0) { b.snfW += snf * litres; b.snfQ += litres; }
      }, ['entries', 'litres', 'amount', 'morning', 'evening', 'other', 'fatW', 'fatQ', 'snfW', 'snfQ']);
      const periods = series.map((s: any) => ({
        key: s.key, label: s.label, entries: s.entries, litres: r3(s.litres), amount: r2(s.amount),
        rate: s.litres ? r2(s.amount / s.litres) : 0,
        fat: s.fatQ ? r2(s.fatW / s.fatQ) : 0, snf: s.snfQ ? r2(s.snfW / s.snfQ) : 0,
        morning: r3(s.morning), evening: r3(s.evening), other: r3(s.other),
      }));
      const litres = sum(rows, litresOf);
      const amount = sum(rows, p => n(p.total_amount));
      const q = quality(rows);
      const suppliers = new Set(rows.map(p => p.supplier_id).filter(Boolean)).size;
      const activeDays = new Set(rows.map(p => dayOf(p.date)).filter(Boolean)).size;
      const hasOther = periods.some(p => p.other > 0);
      const byType = groupSum(rows, milkTypeOf, litresOf);
      const best = [...periods].sort((a, b) => b.litres - a.litres)[0];
      const morning = sum(rows.filter(p => shiftOf(p) === 'morning'), litresOf);
      const evening = sum(rows.filter(p => shiftOf(p) === 'evening'), litresOf);
      return {
        kpis: [
          { key: 'litres', label: 'Milk collected', value: r3(litres), format: 'qty', unit: 'L', tone: 'good' },
          { key: 'amount', label: 'Amount', value: amount, format: 'money', inverse: true },
          { key: 'rate', label: 'Avg rate / L', value: litres ? r2(amount / litres) : 0, format: 'money', inverse: true },
          { key: 'fat', label: 'Avg fat', value: avgFat(q), format: 'number' },
          { key: 'snf', label: 'Avg SNF', value: avgSnf(q), format: 'number' },
          { key: 'suppliers', label: 'Suppliers', value: suppliers, format: 'number' },
          { key: 'perDay', label: 'Litres per day', value: activeDays ? r3(litres / activeDays) : 0, format: 'qty', unit: 'L', hint: `${activeDays} collection day(s)` },
        ],
        charts: [
          {
            id: 'trend', title: 'Litres by shift', type: 'stacked', wide: true, xKey: 'label', format: 'qty', data: periods,
            series: [
              { key: 'morning', label: 'Morning', color: COLOR.credit },
              { key: 'evening', label: 'Evening', color: COLOR.online },
              ...(hasOther ? [{ key: 'other', label: 'Other', color: COLOR.neutral }] : []),
            ],
          },
          { id: 'types', title: 'By milk type', type: 'pie', xKey: 'name', format: 'qty', data: topSlices(byType), series: [{ key: 'value', label: 'Litres' }] },
          { id: 'rate', title: 'Average rate / L', type: 'line', xKey: 'label', format: 'money', data: periods.filter(p => p.litres > 0), series: [{ key: 'rate', label: 'Avg rate', color: COLOR.purchase }] },
        ],
        tables: [{
          id: 'periods', title: `Collection by ${groupBy}`, showTotals: true, sort: { key: 'key', dir: 'desc' },
          columns: [
            { key: 'label', label: groupBy === 'day' ? 'Date' : groupBy === 'week' ? 'Week' : 'Month' },
            { key: 'entries', label: 'Slips', format: 'number', total: true },
            { key: 'morning', label: 'Morning', format: 'qty', unit: 'L', total: true },
            { key: 'evening', label: 'Evening', format: 'qty', unit: 'L', total: true },
            ...(hasOther ? [{ key: 'other', label: 'Other shift', format: 'qty' as const, unit: 'L', total: true }] : []),
            { key: 'litres', label: 'Total litres', format: 'qty', unit: 'L', total: true },
            { key: 'amount', label: 'Amount', format: 'money', total: true },
            { key: 'rate', label: 'Avg rate', format: 'money' },
            { key: 'fat', label: 'Avg fat', format: 'number' },
            { key: 'snf', label: 'Avg SNF', format: 'number' },
          ],
          rows: periods as ReportRow[],
        }],
        insights: [
          best && best.litres > 0 ? `Highest collection: ${best.label} with ${fmt(best.litres, 1)} L` : '',
          litres > 0 ? `Morning ${pct(morning, litres)}% · Evening ${pct(evening, litres)}% of litres` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'milk_by_supplier',
    title: 'Supplier-wise Milk',
    subtitle: 'Litres, amount, rate, quality and dues for each milk supplier',
    category: 'milk',
    icon: 'Users',
    keywords: ['gawala', 'supplier milk', 'farmer', 'dodhi', 'vendor'],
    filters: ['milkType', 'shift'],
    comparable: true,
    build: (data, f) => {
      const rows = milkRows(data, f, { supplier: false });
      const map = new Map<string, { supplierId: string; name: string; entries: number; litres: number; amount: number; paid: number; q: Quality; types: Set<string> }>();
      rows.forEach(p => {
        const key = p.supplier_id || p.supplier_name || 'unknown';
        const row = map.get(key) || { supplierId: p.supplier_id, name: supplierName(data, p.supplier_id, p.supplier_name), entries: 0, litres: 0, amount: 0, paid: 0, q: emptyQuality(), types: new Set<string>() };
        row.entries++; row.litres += litresOf(p); row.amount += n(p.total_amount); row.paid += purchaseCashPaid(p);
        row.types.add(milkTypeOf(p));
        addQuality(row.q, p);
        map.set(key, row);
      });
      const totalLitres = [...map.values()].reduce((s, r) => s + r.litres, 0);
      const table: ReportRow[] = [...map.values()].map(r => ({
        supplier: r.name, types: [...r.types].join(', '), entries: r.entries, litres: r3(r.litres), amount: r2(r.amount),
        rate: r.litres ? r2(r.amount / r.litres) : 0, fat: avgFat(r.q), snf: avgSnf(r.q),
        paid: r2(r.paid), due: r2(Math.max(0, r.amount - r.paid)), share: pct(r.litres, totalLitres),
        balance: r.supplierId ? r2(n(data.suppliers.find(s => s.id === r.supplierId)?.pending_balance)) : 0,
        _drill: r.supplierId ? { report: 'supplier_statement', filters: { supplierId: r.supplierId }, label: 'Supplier statement' } : undefined,
      }));
      const amount = sum(table, r => n(r.amount));
      const top = [...table].sort((a, b) => n(b.litres) - n(a.litres)).slice(0, 10);
      const leader = top[0];
      return {
        kpis: [
          { key: 'suppliers', label: 'Suppliers', value: table.length, format: 'number' },
          { key: 'litres', label: 'Milk collected', value: r3(totalLitres), format: 'qty', unit: 'L', tone: 'good' },
          { key: 'amount', label: 'Amount', value: amount, format: 'money' },
          { key: 'paid', label: 'Paid on intake', value: sum(table, r => n(r.paid)), format: 'money' },
          { key: 'due', label: 'Left on khata', value: sum(table, r => n(r.due)), format: 'money', inverse: true },
          { key: 'rate', label: 'Avg rate / L', value: totalLitres ? r2(amount / totalLitres) : 0, format: 'money', inverse: true },
        ],
        charts: [
          { id: 'top', title: 'Top 10 suppliers by litres', type: 'bar', wide: true, xKey: 'name', format: 'qty', data: top.map(r => ({ name: r.supplier, litres: r.litres })), series: [{ key: 'litres', label: 'Litres', color: COLOR.purchase }] },
          { id: 'share', title: 'Share of litres', type: 'pie', xKey: 'name', format: 'qty', data: topSlices(table.map(r => ({ name: String(r.supplier), value: n(r.litres) }))), series: [{ key: 'value', label: 'Litres' }] },
        ],
        tables: [{
          id: 'suppliers', showTotals: true, sort: { key: 'litres', dir: 'desc' },
          emptyText: 'No milk collected in this period.',
          columns: [
            { key: 'supplier', label: 'Supplier' },
            { key: 'types', label: 'Milk', hidden: true },
            { key: 'entries', label: 'Slips', format: 'number', total: true },
            { key: 'litres', label: 'Litres', format: 'qty', unit: 'L', total: true },
            { key: 'amount', label: 'Amount', format: 'money', total: true },
            { key: 'rate', label: 'Avg rate', format: 'money' },
            { key: 'fat', label: 'Avg fat', format: 'number' },
            { key: 'snf', label: 'Avg SNF', format: 'number' },
            { key: 'paid', label: 'Paid on intake', format: 'money', total: true },
            { key: 'due', label: 'On khata', format: 'money', total: true },
            { key: 'balance', label: 'Balance today', format: 'money', signed: true, hidden: true },
            { key: 'share', label: 'Share', format: 'percent' },
          ],
          rows: table,
        }],
        insights: [
          leader ? `${leader.supplier} gives the most milk: ${fmt(n(leader.litres), 1)} L (${leader.share}%)` : '',
        ].filter(Boolean),
      };
    },
  },
  {
    id: 'milk_quality',
    title: 'Milk Quality (Fat / SNF)',
    subtitle: 'Litre-weighted fat and SNF per supplier and per day, with low readings marked',
    category: 'milk',
    icon: 'FlaskConical',
    keywords: ['fat', 'snf', 'lactometer', 'quality', 'testing'],
    filters: ['milkType', 'shift', 'supplierId', 'groupBy'],
    build: (data, f) => {
      const rows = milkRows(data, f);
      const overall = quality(rows);
      const periodFat = avgFat(overall);
      const periodSnf = avgSnf(overall);
      const lowFat = (fat: number) => periodFat > 0 && fat > 0 && fat < periodFat - 0.5;

      const bySupplier = new Map<string, { supplierId: string; name: string; entries: number; litres: number; q: Quality; low: number }>();
      rows.forEach(p => {
        const key = p.supplier_id || p.supplier_name || 'unknown';
        const row = bySupplier.get(key) || { supplierId: p.supplier_id, name: supplierName(data, p.supplier_id, p.supplier_name), entries: 0, litres: 0, q: emptyQuality(), low: 0 };
        row.entries++; row.litres += litresOf(p);
        addQuality(row.q, p);
        if (lowFat(fatOf(p))) row.low++;
        bySupplier.set(key, row);
      });
      const supplierRows: ReportRow[] = [...bySupplier.values()].map(r => {
        const fat = avgFat(r.q);
        return {
          supplier: r.name, entries: r.entries, litres: r3(r.litres), tested: r3(r.q.fatQ),
          fat, fatMin: finite(r.q.fatMin), fatMax: finite(r.q.fatMax),
          snf: avgSnf(r.q), snfMin: finite(r.q.snfMin), snfMax: finite(r.q.snfMax), low: r.low,
          _tone: lowFat(fat) ? 'warn' : undefined,
          _drill: r.supplierId ? { report: 'milk_collection', filters: { supplierId: r.supplierId }, label: 'Milk from this supplier' } : undefined,
        };
      });

      const byDay = new Map<string, { litres: number; q: Quality; entries: number }>();
      rows.forEach(p => {
        const day = dayOf(p.date);
        if (!day) return;
        const row = byDay.get(day) || { litres: 0, q: emptyQuality(), entries: 0 };
        row.entries++; row.litres += litresOf(p);
        addQuality(row.q, p);
        byDay.set(day, row);
      });
      const dayRows: ReportRow[] = [...byDay.entries()].map(([date, r]) => {
        const fat = avgFat(r.q);
        return {
          date, entries: r.entries, litres: r3(r.litres), fat, fatMin: finite(r.q.fatMin), fatMax: finite(r.q.fatMax),
          snf: avgSnf(r.q), snfMin: finite(r.q.snfMin), snfMax: finite(r.q.snfMax),
          _tone: lowFat(fat) ? 'warn' : undefined,
        };
      });

      const groupBy = autoGroup(f);
      const series = timeSeries(rows, p => p.date, f, groupBy, (b, p) => {
        const litres = litresOf(p), fat = fatOf(p), snf = snfOf(p);
        if (litres > 0 && fat > 0) { b.fatW += fat * litres; b.fatQ += litres; }
        if (litres > 0 && snf > 0) { b.snfW += snf * litres; b.snfQ += litres; }
      }, ['fatW', 'fatQ', 'snfW', 'snfQ']).map((s: any) => ({
        label: s.label, fat: s.fatQ ? r2(s.fatW / s.fatQ) : 0, snf: s.snfQ ? r2(s.snfW / s.snfQ) : 0,
      })).filter(s => s.fat > 0 || s.snf > 0);

      const untested = rows.filter(p => fatOf(p) <= 0 && snfOf(p) <= 0).length;
      const lowSuppliers = supplierRows.filter(r => r._tone === 'warn').length;
      const lowSlips = rows.filter(p => lowFat(fatOf(p))).length;
      return {
        kpis: [
          { key: 'fat', label: 'Avg fat', value: periodFat, format: 'number', tone: 'info' },
          { key: 'snf', label: 'Avg SNF', value: periodSnf, format: 'number', tone: 'info' },
          { key: 'fatRange', label: 'Fat range', value: finite(overall.fatMax), format: 'number', hint: periodFat ? `Lowest ${finite(overall.fatMin)} · Highest ${finite(overall.fatMax)}` : 'No fat readings' },
          { key: 'tested', label: 'Litres tested', value: r3(overall.fatQ), format: 'qty', unit: 'L', hint: `${pct(overall.fatQ, sum(rows, litresOf))}% of collected` },
          { key: 'low', label: 'Low-fat slips', value: lowSlips, format: 'number', tone: lowSlips ? 'warn' : 'good', inverse: true, hint: 'Fat more than 0.5 below average' },
        ],
        charts: [{
          id: 'trend', title: 'Average fat & SNF', type: 'line', wide: true, xKey: 'label', format: 'number', data: series,
          series: [{ key: 'fat', label: 'Fat', color: CHART_COLORS[2] }, { key: 'snf', label: 'SNF', color: CHART_COLORS[1] }],
        }],
        tables: [
          {
            id: 'suppliers', title: 'By supplier', sort: { key: 'fat', dir: 'asc' },
            subtitle: periodFat ? `Rows in amber have fat more than 0.5 below the period average (${periodFat}).` : undefined,
            emptyText: 'No milk collected in this period.',
            columns: [
              { key: 'supplier', label: 'Supplier' },
              { key: 'entries', label: 'Slips', format: 'number' },
              { key: 'litres', label: 'Litres', format: 'qty', unit: 'L' },
              { key: 'tested', label: 'Tested litres', format: 'qty', unit: 'L', hidden: true },
              { key: 'fat', label: 'Avg fat', format: 'number' },
              { key: 'fatMin', label: 'Min fat', format: 'number' },
              { key: 'fatMax', label: 'Max fat', format: 'number' },
              { key: 'snf', label: 'Avg SNF', format: 'number' },
              { key: 'snfMin', label: 'Min SNF', format: 'number', hidden: true },
              { key: 'snfMax', label: 'Max SNF', format: 'number', hidden: true },
              { key: 'low', label: 'Low-fat slips', format: 'number' },
            ],
            rows: supplierRows,
          },
          {
            id: 'days', title: 'By day', sort: { key: 'date', dir: 'desc' },
            columns: [
              { key: 'date', label: 'Date', format: 'date' },
              { key: 'entries', label: 'Slips', format: 'number' },
              { key: 'litres', label: 'Litres', format: 'qty', unit: 'L' },
              { key: 'fat', label: 'Avg fat', format: 'number' },
              { key: 'fatMin', label: 'Min fat', format: 'number' },
              { key: 'fatMax', label: 'Max fat', format: 'number' },
              { key: 'snf', label: 'Avg SNF', format: 'number' },
              { key: 'snfMin', label: 'Min SNF', format: 'number', hidden: true },
              { key: 'snfMax', label: 'Max SNF', format: 'number', hidden: true },
            ],
            rows: dayRows,
          },
        ],
        notes: [
          untested ? { tone: 'info' as const, text: `${untested} of ${rows.length} slip(s) have no fat or SNF reading and are left out of the averages.` } : null,
          lowSuppliers ? { tone: 'warn' as const, text: `${lowSuppliers} supplier(s) are giving milk with fat well below average.` } : null,
        ].filter((x): x is { tone: 'info' | 'warn'; text: string } => Boolean(x)),
      };
    },
  },
  {
    id: 'milk_allocation',
    title: 'Milk Allocation & Usage',
    subtitle: 'Where collected milk went: counter, home delivery or production, and what is left',
    category: 'milk',
    icon: 'Split',
    keywords: ['allocation', 'usage', 'distribution', 'unallocated', 'milk pool'],
    filters: ['milkType', 'supplierId'],
    build: (data, f) => {
      const purchaseSupplier = new Map(data.purchases.map(p => [p.id, p.supplier_id]));
      const list = data.allocations.filter(a =>
        a && inRange(a.date, f) &&
        (!f.milkType || lower(milkTypeOf(a)) === lower(f.milkType)) &&
        (!f.supplierId || purchaseSupplier.get(a.purchase_id) === f.supplierId)
      );
      const rows: ReportRow[] = list.map(a => {
        const original = Math.max(0, n(a.original_quantity));
        const allocated = Math.max(0, n(a.allocated_quantity));
        const remaining = a.remaining_quantity !== null && a.remaining_quantity !== undefined
          ? Math.max(0, n(a.remaining_quantity))
          : Math.max(0, original - allocated);
        const split = destinationSplit(a);
        const status = String(a.status || (remaining > 0.01 ? (allocated > 0 ? 'Partially Allocated' : 'Unallocated') : 'Fully Allocated'));
        return {
          date: a.date, source: a.supplier_name || 'Milk', milkType: milkTypeOf(a),
          original: r3(original), allocated: r3(allocated), remaining: r3(remaining),
          retail: r3(split.retail), delivery: r3(split.delivery), production: r3(split.production), other: r3(split.other),
          rate: r2(n(a.average_rate)), status,
          _tone: remaining > 0.01 && dayOf(a.date) < data.today ? 'warn' : undefined,
        };
      });
      const original = sum(rows, r => n(r.original));
      const allocated = sum(rows, r => n(r.allocated));
      const remaining = sum(rows, r => n(r.remaining));
      const retail = sum(rows, r => n(r.retail));
      const delivery = sum(rows, r => n(r.delivery));
      const production = sum(rows, r => n(r.production));
      const other = sum(rows, r => n(r.other));
      const pie = [
        { name: DESTINATIONS[0], value: r3(retail) }, { name: DESTINATIONS[1], value: r3(delivery) },
        { name: DESTINATIONS[2], value: r3(production) }, { name: 'Other', value: r3(other) },
        { name: 'Not allocated', value: r3(remaining) },
      ].filter(x => x.value > 0);
      const groupBy = autoGroup(f);
      const series = timeSeries(rows, r => String(r.date), f, groupBy, (b, r) => {
        b.retail += n(r.retail); b.delivery += n(r.delivery); b.production += n(r.production); b.remaining += n(r.remaining);
      }, ['retail', 'delivery', 'production', 'remaining']);
      const stale = rows.filter(r => r._tone === 'warn').length;
      return {
        kpis: [
          { key: 'original', label: 'Milk in pool', value: r3(original), format: 'qty', unit: 'L' },
          { key: 'allocated', label: 'Allocated', value: r3(allocated), format: 'qty', unit: 'L', tone: 'good', hint: `${pct(allocated, original)}% of pool` },
          { key: 'remaining', label: 'Not allocated', value: r3(remaining), format: 'qty', unit: 'L', tone: remaining > 0.01 ? 'warn' : 'good', inverse: true },
          { key: 'retail', label: 'Retail counter', value: r3(retail), format: 'qty', unit: 'L' },
          { key: 'delivery', label: 'Home delivery', value: r3(delivery), format: 'qty', unit: 'L' },
          { key: 'production', label: 'Production', value: r3(production), format: 'qty', unit: 'L' },
        ],
        charts: [
          { id: 'dest', title: 'Litres by destination', type: 'pie', xKey: 'name', format: 'qty', data: pie, series: [{ key: 'value', label: 'Litres' }] },
          {
            id: 'trend', title: 'Allocation over time', type: 'stacked', xKey: 'label', format: 'qty', data: series,
            series: [
              { key: 'retail', label: 'Retail', color: COLOR.sales }, { key: 'delivery', label: 'Delivery', color: COLOR.online },
              { key: 'production', label: 'Production', color: COLOR.profit }, { key: 'remaining', label: 'Not allocated', color: COLOR.neutral },
            ],
          },
        ],
        tables: [{
          id: 'allocations', showTotals: true, sort: { key: 'date', dir: 'desc' },
          emptyText: 'No milk in the allocation pool for this period.',
          columns: [
            { key: 'date', label: 'Date', format: 'date' },
            { key: 'source', label: 'Source' },
            { key: 'milkType', label: 'Milk' },
            { key: 'original', label: 'Original', format: 'qty', unit: 'L', total: true },
            { key: 'allocated', label: 'Allocated', format: 'qty', unit: 'L', total: true },
            { key: 'remaining', label: 'Remaining', format: 'qty', unit: 'L', total: true },
            { key: 'retail', label: 'Retail', format: 'qty', unit: 'L', total: true },
            { key: 'delivery', label: 'Delivery', format: 'qty', unit: 'L', total: true },
            { key: 'production', label: 'Production', format: 'qty', unit: 'L', total: true },
            { key: 'other', label: 'Other', format: 'qty', unit: 'L', total: true, hidden: true },
            { key: 'rate', label: 'Avg rate', format: 'money', hidden: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { 'Fully Allocated': 'good', Completed: 'good', 'Partially Allocated': 'warn', Unallocated: 'bad', 'Allocated for Supply': 'info' } },
          ],
          rows,
        }],
        notes: stale ? [{ tone: 'warn', text: `${stale} older milk entr${stale === 1 ? 'y still has' : 'ies still have'} unallocated litres. Allocate or record them as wastage.` }] : undefined,
      };
    },
  },
];
