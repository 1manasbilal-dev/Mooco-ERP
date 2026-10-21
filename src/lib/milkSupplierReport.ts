import {
  StatementCompany,
  StatementSupplier,
  formatLedgerDate,
  formatMoney,
  ledgerDay,
  localIsoDate,
  money,
  rangeLabel
} from './supplierStatement';

export type MilkGroupMode = 'milk' | 'shift' | 'day';

const MILK_GROUP_LABEL: Record<MilkGroupMode, string> = {
  milk: 'By milk',
  shift: 'By shift',
  day: 'By day'
};

interface RawMilkPurchase {
  id: string;
  supplier_id?: string;
  date?: string;
  quantity?: number;
  milk_type?: string;
  shift?: string;
  rate?: number;
  fat?: number;
  snf?: number;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number };
}

export interface MilkReportLine {
  id: string;
  date: string;
  shift: string;
  milkType: string;
  litres: number;
  fat: number;
  snf: number;
  rate: number;
  amount: number;
}

export interface MilkBucket {
  label: string;
  litres: number;
  amount: number;
  slips: number;
}

export interface MilkReportSection {
  id: string;
  title: string;
  litres: number;
  amount: number;
  rate: number;
  fat: number;
  slips: number;
  lines: MilkReportLine[];
}

export interface MilkSupplierReport {
  mode: MilkGroupMode;
  modeLabel: string;
  filterLabel: string;
  rangeLabel: string;
  sections: MilkReportSection[];
  milkBreakdown: MilkBucket[];
  shiftBreakdown: MilkBucket[];
  litres: number;
  amount: number;
  paid: number;
  rate: number;
  fat: number;
  slipCount: number;
  dayCount: number;
  showFat: boolean;
  showSnf: boolean;
  rangeCount: number;
  milkOptions: string[];
  shiftOptions: string[];
}

const MILK_ORDER = ['Buffalo', 'Cow', 'Mixed'];

function dayKey(value?: string) {
  return ledgerDay(value);
}

function inRange(date: string, from: string, to: string) {
  if (!from && !to) return true;
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function isVoid(status?: string) {
  const value = (status || '').toLowerCase();
  return value === 'returned' || value === 'cancelled' || value === 'canceled';
}

function cleanLabel(value: string | undefined, fallback: string) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function sameLabel(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function weightedQuality(lines: MilkReportLine[], field: 'fat' | 'snf') {
  let qty = 0;
  let sum = 0;
  lines.forEach(line => {
    const quality = Number(line[field]) || 0;
    if (quality > 0 && line.litres > 0) {
      qty += line.litres;
      sum += quality * line.litres;
    }
  });
  return qty > 0 ? money(sum / qty) : 0;
}

function avgRate(litres: number, amount: number) {
  if (litres <= 0.0001) return 0;
  return money(amount / litres);
}

function orderIndex(label: string, order: string[]) {
  const index = order.findIndex(item => sameLabel(item, label));
  return index === -1 ? order.length : index;
}

function compareLabels(left: string, right: string, order: string[]) {
  const rank = orderIndex(left, order) - orderIndex(right, order);
  if (rank) return rank;
  return left.localeCompare(right);
}

function canonical(label: string, order: string[]) {
  return order.find(item => sameLabel(item, label)) || label;
}

function toLine(row: RawMilkPurchase, shiftOrder: string[]): MilkReportLine {
  const litres = money(Number(row.quantity) || 0);
  const amount = money(Number(row.total_amount) || 0);
  const statedRate = money(Number(row.rate) || 0);
  return {
    id: String(row.id),
    date: dayKey(row.date),
    shift: canonical(cleanLabel(row.shift, 'Shift'), shiftOrder),
    milkType: canonical(cleanLabel(row.milk_type, 'Milk'), MILK_ORDER),
    litres,
    fat: money(Number(row.fat) || 0),
    snf: money(Number(row.snf) || 0),
    rate: statedRate > 0 ? statedRate : avgRate(litres, amount),
    amount
  };
}

function paidOf(row: RawMilkPurchase) {
  return money(row.paid_amount ?? row.details?.paid_amount ?? 0);
}

function totals(lines: MilkReportLine[]) {
  const litres = money(lines.reduce((sum, line) => sum + line.litres, 0));
  const amount = money(lines.reduce((sum, line) => sum + line.amount, 0));
  return {
    litres,
    amount,
    rate: avgRate(litres, amount),
    fat: weightedQuality(lines, 'fat'),
    slips: lines.length
  };
}

function buckets(lines: MilkReportLine[], key: 'milkType' | 'shift', order: string[]): MilkBucket[] {
  const groups = new Map<string, MilkReportLine[]>();
  lines.forEach(line => {
    const label = line[key];
    const list = groups.get(label) || [];
    list.push(line);
    groups.set(label, list);
  });
  return Array.from(groups.entries())
    .sort((a, b) => compareLabels(a[0], b[0], order))
    .map(([label, group]) => {
      const sum = totals(group);
      return { label, litres: sum.litres, amount: sum.amount, slips: sum.slips };
    });
}

function sectionFrom(id: string, title: string, lines: MilkReportLine[]): MilkReportSection {
  const sum = totals(lines);
  return { id, title, ...sum, lines };
}

function groupLines(lines: MilkReportLine[], mode: MilkGroupMode, shiftOrder: string[]): MilkReportSection[] {
  if (mode === 'day') {
    const byDate = new Map<string, MilkReportLine[]>();
    lines.forEach(line => {
      const list = byDate.get(line.date) || [];
      list.push(line);
      byDate.set(line.date, list);
    });
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, group]) => sectionFrom(
        `day_${date || 'none'}`,
        date ? formatLedgerDate(date, true) : 'Undated',
        sortLines(group, shiftOrder)
      ));
  }

  const key = mode === 'milk' ? 'milkType' : 'shift';
  const order = mode === 'milk' ? MILK_ORDER : shiftOrder;
  const groups = new Map<string, MilkReportLine[]>();
  lines.forEach(line => {
    const label = line[key];
    const list = groups.get(label) || [];
    list.push(line);
    groups.set(label, list);
  });
  return Array.from(groups.entries())
    .sort((a, b) => compareLabels(a[0], b[0], order))
    .map(([label, group]) => sectionFrom(`${mode}_${label}`, label, sortLines(group, shiftOrder)));
}

function sortLines(lines: MilkReportLine[], shiftOrder: string[]) {
  return [...lines].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const shift = compareLabels(a.shift, b.shift, shiftOrder);
    if (shift) return shift;
    const milk = compareLabels(a.milkType, b.milkType, MILK_ORDER);
    return milk || a.id.localeCompare(b.id);
  });
}

export function buildMilkSupplierReport(input: {
  purchases?: RawMilkPurchase[];
  supplierId: string;
  from?: string;
  to?: string;
  mode?: MilkGroupMode;
  milkType?: string;
  shift?: string;
  shiftOrder?: string[];
}): MilkSupplierReport {
  const mode = input.mode || 'milk';
  const from = input.from || '';
  const to = input.to || '';
  const shiftOrder = (input.shiftOrder && input.shiftOrder.length ? input.shiftOrder : ['Morning', 'Evening'])
    .map(name => cleanLabel(name, ''))
    .filter(Boolean);
  const milkFilter = cleanLabel(input.milkType, 'all');
  const shiftFilter = cleanLabel(input.shift, 'all');
  const wantAllMilk = !milkFilter || sameLabel(milkFilter, 'all');
  const wantAllShifts = !shiftFilter || sameLabel(shiftFilter, 'all');

  const inPeriod = (input.purchases || []).filter(row => (
    row.supplier_id === input.supplierId &&
    !isVoid(row.status) &&
    inRange(dayKey(row.date), from, to) &&
    (money(Number(row.quantity) || 0) > 0 || money(Number(row.total_amount) || 0) > 0)
  ));

  const period = inPeriod.map(row => ({ line: toLine(row, shiftOrder), paid: paidOf(row) }));
  const periodLines = period.map(item => item.line);
  const milkOptions = buckets(periodLines, 'milkType', MILK_ORDER).map(bucket => bucket.label);
  const knownShifts = new Set(periodLines.map(line => line.shift.toLowerCase()));
  const shiftOptions = [
    ...shiftOrder.filter(name => knownShifts.has(name.toLowerCase()) || periodLines.length === 0),
    ...buckets(periodLines, 'shift', shiftOrder).map(bucket => bucket.label).filter(label => !shiftOrder.some(name => sameLabel(name, label)))
  ];

  const matched = period.filter(item => (
    (wantAllMilk || sameLabel(item.line.milkType, milkFilter)) &&
    (wantAllShifts || sameLabel(item.line.shift, shiftFilter))
  ));
  const lines = sortLines(matched.map(item => item.line), shiftOrder);
  const sum = totals(lines);
  const days = new Set(lines.map(line => line.date).filter(Boolean));
  const filterBits = [
    wantAllMilk ? 'All milk' : milkFilter,
    wantAllShifts ? 'All shifts' : shiftFilter
  ];

  return {
    mode,
    modeLabel: MILK_GROUP_LABEL[mode],
    filterLabel: filterBits.join(' · '),
    rangeLabel: rangeLabel(from, to),
    sections: groupLines(lines, mode, shiftOrder),
    milkBreakdown: buckets(lines, 'milkType', MILK_ORDER),
    shiftBreakdown: buckets(lines, 'shift', shiftOrder),
    litres: sum.litres,
    amount: sum.amount,
    paid: money(matched.reduce((total, item) => total + item.paid, 0)),
    rate: sum.rate,
    fat: sum.fat,
    slipCount: lines.length,
    dayCount: days.size,
    showFat: lines.some(line => line.fat > 0),
    showSnf: lines.some(line => line.snf > 0),
    rangeCount: periodLines.length,
    milkOptions,
    shiftOptions: shiftOptions.length ? shiftOptions : shiftOrder
  };
}

export function formatMilkQty(value: number) {
  const rounded = money(value);
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMilkRate(value: number) {
  return `Rs ${formatMilkQty(value)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char
  ));
}

function bucketText(bucketsToShow: MilkBucket[], unit = 'L') {
  return bucketsToShow.map(bucket => `${bucket.label} ${formatMilkQty(bucket.litres)}${unit}`).join(' · ');
}

const SHEET_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap');
  .sheet { width: 760px; box-sizing: border-box; padding: 20px 24px 28px; background: #fff; color: #0f172a; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; line-height: 1.4; -webkit-font-smoothing: antialiased; }
  .sheet * { box-sizing: border-box; }
  .sheet table { width: 100%; border-collapse: collapse; }
  .sheet h1 { margin: 0; font-size: 20px; font-weight: 900; letter-spacing: -0.02em; text-transform: uppercase; color: #0f172a; line-height: 1.15; }
  .sheet h2 { margin: 0; font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #0f172a; }
  .muted { color: #64748b; }
  .right { text-align: right; }
  .num { text-align: right; white-space: nowrap; font-family: 'JetBrains Mono', Consolas, monospace; font-variant-numeric: tabular-nums; font-weight: 700; }
  .label { display: block; font-size: 8.5px; letter-spacing: .05em; text-transform: uppercase; font-weight: 800; color: #64748b; margin-bottom: 2px; }
  .rule { border-bottom: 2.5px solid #0f172a; padding-bottom: 10px; }
  .party { margin-top: 10px; }
  .cards { margin-top: 10px; }
  .cards td { width: 25%; border: 1px solid #cbd5e1; border-top: 3px solid #0f172a; padding: 8px 10px; vertical-align: top; background: #f8fafc; }
  .cards td:first-child { border-top-color: #0369a1; }
  .cards td:nth-child(2) { border-top-color: #b45309; }
  .cards td:nth-child(3) { border-top-color: #059669; }
  .cards strong { font-size: 13px; font-weight: 800; color: #0f172a; font-family: 'JetBrains Mono', Consolas, monospace; }
  .split { margin: 8px 0 0; font-size: 10px; font-weight: 600; color: #475569; }
  .sheet th { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; text-align: left; background: #0f172a; color: #f8fafc; padding: 6px 6px; }
  .sheet td { padding: 5px 6px; vertical-align: top; }
  .lines td { border-bottom: 1px solid #e2e8f0; font-size: 10px; }
  .section td { background: #f1f5f9; font-weight: 800; border-top: 1px solid #cbd5e1; border-bottom: 1px solid #cbd5e1; font-size: 10px; }
  .total td { font-weight: 800; border-top: 1.5px solid #0f172a; border-bottom: 3px double #0f172a; font-size: 11px; background: #f8fafc; }
  .sign { margin-top: 32px; }
  .sign td { width: 33%; border-top: 1.5px solid #0f172a; padding-top: 6px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #0f172a; text-align: center; }
  .foot { margin-top: 12px; font-size: 8.5px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 6px; }
`;

function lineCells(line: MilkReportLine, mode: MilkGroupMode, showFat: boolean, showSnf: boolean) {
  const cells: string[] = [];
  if (mode !== 'day') cells.push(`<td>${escapeHtml(formatLedgerDate(line.date))}</td>`);
  if (mode !== 'shift') cells.push(`<td>${escapeHtml(line.shift)}</td>`);
  if (mode !== 'milk') cells.push(`<td>${escapeHtml(line.milkType)}</td>`);
  cells.push(`<td class="num">${escapeHtml(formatMilkQty(line.litres))}</td>`);
  if (showFat) cells.push(`<td class="num">${line.fat > 0 ? escapeHtml(formatMilkQty(line.fat)) : ''}</td>`);
  if (showSnf) cells.push(`<td class="num">${line.snf > 0 ? escapeHtml(formatMilkQty(line.snf)) : ''}</td>`);
  cells.push(`<td class="num">${escapeHtml(formatMilkRate(line.rate))}</td>`);
  cells.push(`<td class="num">${escapeHtml(formatMoney(line.amount))}</td>`);
  return cells.join('');
}

function headerCells(mode: MilkGroupMode, showFat: boolean, showSnf: boolean) {
  const cells: string[] = [];
  if (mode !== 'day') cells.push('<th>Date</th>');
  if (mode !== 'shift') cells.push('<th>Shift</th>');
  if (mode !== 'milk') cells.push('<th>Milk</th>');
  cells.push('<th class="num">Litres</th>');
  if (showFat) cells.push('<th class="num">Fat</th>');
  if (showSnf) cells.push('<th class="num">SNF</th>');
  cells.push('<th class="num">Rate</th>');
  cells.push('<th class="num">Amount</th>');
  return cells.join('');
}

export function milkReportSheetHtml(input: {
  company: StatementCompany;
  supplier: StatementSupplier;
  report: MilkSupplierReport;
  balanceLabel?: string;
}) {
  const { company, supplier, report } = input;
  const location = [supplier.village, supplier.city, supplier.address].filter(Boolean).join(', ');
  const qualityCols = (report.showFat ? 1 : 0) + (report.showSnf ? 1 : 0);
  const columnCount = 5 + qualityCols;
  const afterLitres = qualityCols + 1;
  const head = headerCells(report.mode, report.showFat, report.showSnf);
  const summaryRow = (title: string, litres: number, amount: number, rowClass: string) => `
    <tr class="${rowClass}">
      <td colspan="2">${title}</td>
      <td class="num">${escapeHtml(formatMilkQty(litres))} L</td>
      <td colspan="${afterLitres}"></td>
      <td class="num">${escapeHtml(formatMoney(amount))}</td>
    </tr>
  `;
  const body = report.sections.map(section => `
    ${summaryRow(
      `${escapeHtml(section.title)}<span class="muted"> · ${section.slips} slip${section.slips === 1 ? '' : 's'}${section.fat > 0 ? ` · Fat ${formatMilkQty(section.fat)}` : ''}</span>`,
      section.litres,
      section.amount,
      'section'
    )}
    ${section.lines.map(line => `<tr class="lines">${lineCells(line, report.mode, report.showFat, report.showSnf)}</tr>`).join('')}
  `).join('');
  const split = [
    report.milkBreakdown.length ? `Milk: ${bucketText(report.milkBreakdown)}` : '',
    report.shiftBreakdown.length ? `Shifts: ${bucketText(report.shiftBreakdown)}` : ''
  ].filter(Boolean).join('<br>');

  return `
    <div class="sheet">
      <table class="rule">
        <tr>
          <td>
            <h1>${escapeHtml(company.name || 'Mooco Dairy')}</h1>
            <div class="muted">${escapeHtml([company.address, company.phone].filter(Boolean).join(' · '))}</div>
          </td>
          <td class="right">
            <h2>Milk Supply Slip</h2>
            <div class="muted">${escapeHtml(report.rangeLabel)}</div>
            <div class="muted">${escapeHtml(report.modeLabel)} · ${escapeHtml(report.filterLabel)}</div>
          </td>
        </tr>
      </table>
      <table class="party">
        <tr>
          <td>
            <strong>${escapeHtml(supplier.name)}</strong>
            <div class="muted">${escapeHtml(supplier.phone || '')}</div>
            <div class="muted">${escapeHtml(location)}</div>
          </td>
          <td class="right muted">Printed ${escapeHtml(formatLedgerDate(localIsoDate()))}</td>
        </tr>
      </table>
      <table class="cards">
        <tr>
          <td><span class="label">Litres</span><strong>${escapeHtml(formatMilkQty(report.litres))} L</strong><div class="muted">${report.slipCount} slips · ${report.dayCount} days</div></td>
          <td><span class="label">Amount</span><strong>${escapeHtml(formatMoney(report.amount))}</strong></td>
          <td><span class="label">Avg rate</span><strong>${escapeHtml(formatMilkRate(report.rate))}/L</strong>${report.fat > 0 ? `<div class="muted">Fat ${escapeHtml(formatMilkQty(report.fat))}</div>` : ''}</td>
          <td><span class="label">Net Balance</span><strong>${escapeHtml(input.balanceLabel || '—')}</strong>${report.paid > 0 ? `<div class="muted">Paid on slips ${escapeHtml(formatMoney(report.paid))}</div>` : ''}</td>
        </tr>
      </table>
      ${split ? `<div class="split muted">${split}</div>` : ''}
      <table style="margin-top:8px">
        <thead><tr>${head}</tr></thead>
        <tbody>
          ${body || `<tr><td colspan="${columnCount}">No milk collected for this supplier in the selected period.</td></tr>`}
          ${report.slipCount ? summaryRow('Total', report.litres, report.amount, 'total') : ''}
        </tbody>
      </table>
      <div class="foot muted">Milk collections statement. Supplier net balance also accounts for payments and feed/materials.</div>
      <table class="sign"><tr><td>Prepared by</td><td>Checked by</td><td>Supplier signature</td></tr></table>
    </div>
  `;
}

function sheetDocument(title: string, inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4 portrait;margin:12mm}body{margin:0}${SHEET_CSS}button{margin:12px 20px}@media print{button{display:none}}</style></head><body>${inner}<button onclick="print()">Print</button></body></html>`;
}

export function printMilkSupplierReport(input: {
  company: StatementCompany;
  supplier: StatementSupplier;
  report: MilkSupplierReport;
  balanceLabel?: string;
}) {
  const title = `Milk slip - ${input.supplier.name}`;
  const popup = window.open('', '_blank', 'width=860,height=760');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(sheetDocument(title, milkReportSheetHtml(input)));
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 250);
  return true;
}

export function milkReportCaption(input: {
  companyName: string;
  supplierName: string;
  report: MilkSupplierReport;
  balanceLabel?: string;
}) {
  const { report } = input;
  const lines = [
    `*${input.companyName} — Milk Slip*`,
    `Supplier: ${input.supplierName}`,
    `Period: ${report.rangeLabel}`,
    `${report.modeLabel} · ${report.filterLabel}`,
    '',
    `Milk: ${formatMilkQty(report.litres)} L`,
    `Amount: ${formatMoney(report.amount)}`,
    `Avg rate: ${formatMilkRate(report.rate)}/L`
  ];
  if (input.balanceLabel) lines.push(`Net Balance: ${input.balanceLabel}`);
  const extra = [
    report.milkBreakdown.length > 1 ? bucketText(report.milkBreakdown) : '',
    report.shiftBreakdown.length > 1 ? bucketText(report.shiftBreakdown) : ''
  ].filter(Boolean);
  if (extra.length) lines.push('', ...extra);
  return lines.join('\n');
}

export function milkSlipFilename(supplierName: string, from = '', to = '') {
  const safe = supplierName.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'supplier';
  const span = from && to ? `${from}_${to}` : from || to || 'all';
  return `Milk-slip-${safe}-${span}.png`;
}

function formatPkWhatsapp(phone?: string) {
  const clean = String(phone || '').replace(/[^0-9]/g, '');
  if (!clean) return '';
  if (clean.startsWith('0')) return `92${clean.slice(1)}`;
  if (clean.startsWith('92')) return clean;
  return `92${clean}`;
}

let canvasLoader: Promise<(element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>> | undefined;

function loadCanvas() {
  if (!canvasLoader) {
    canvasLoader = import('html2canvas')
      .then(module => module.default as (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>)
      .catch(error => {
        canvasLoader = undefined;
        throw error;
      });
  }
  return canvasLoader;
}

async function captureSheetImage(innerHtml: string) {
  const html2canvas = await loadCanvas();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-12000px;top:0;width:720px;background:#fff;';
  host.innerHTML = `<style>${SHEET_CSS}</style>${innerHtml}`;
  document.body.appendChild(host);
  const sheet = host.querySelector('.sheet') as HTMLElement | null;
  try {
    if (!sheet) throw new Error('Milk slip sheet was not created');
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    const canvas = await html2canvas(sheet, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: sheet.scrollWidth,
      height: sheet.scrollHeight,
      windowWidth: sheet.scrollWidth,
      windowHeight: sheet.scrollHeight
    });
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(file => resolve(file), 'image/png'));
    if (!blob) throw new Error('Milk slip image was empty');
    return blob;
  } finally {
    host.remove();
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type MilkShareResult = 'shared' | 'downloaded' | 'cancelled';

export async function shareMilkReportImage(input: {
  innerHtml: string;
  filename: string;
  caption: string;
  phone?: string;
}): Promise<MilkShareResult> {
  const blob = await captureSheetImage(input.innerHtml);
  const file = new File([blob], input.filename, { type: 'image/png' });
  try {
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Milk slip', text: input.caption });
      return 'shared';
    }
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  }
  downloadBlob(blob, input.filename);
  const phone = formatPkWhatsapp(input.phone);
  if (phone) {
    const text = `${input.caption}\n\nImage saved on this phone. Attach the milk slip in this chat.`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }
  return 'downloaded';
}
