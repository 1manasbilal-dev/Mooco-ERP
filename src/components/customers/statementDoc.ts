// The customer's A5 statement of account: one document for the preview, the printer and the PDF, so
// all three always match. Built to fit as many rows as it can on a small sheet: every row stays at
// 11px (about 8pt on paper), and the space comes from dropping boxes, not from smaller text.
// Loaded on demand with its dialog. Every value is escaped: names and notes come from user input.
import type { Customer } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { rangeLabel } from '../../lib/supplierStatement';
import { balanceState, escapeHtml as esc, isReturnEntry, type LedgerEntry, type LedgerPeriod } from './customerUtils';
import type { ShopInfo } from './printDocs';

export interface StatementInput {
  customer: Customer;
  shop: ShopInfo;
  period: LedgerPeriod;
  /** The rows to print, newest first (the duration, with any type filter and search applied). */
  rows: LedgerEntry[];
  from: string;
  to: string;
  /** Says which rows were left out by a filter; the summary always covers the whole duration. */
  filterNote?: string;
  /** Stored balance minus what the ledger entries add up to. */
  ledgerGap: number;
  /** Black and white, for a black-ink printer: no colour and no large filled areas. */
  mono?: boolean;
  /** Today, in Pakistan: where an all-time statement ends. */
  issuedDay: string;
}

// The top padding and the footer keep text clear of the 4mm or so a printer cannot reach.
const CSS = `
*{box-sizing:border-box}
@page{size:A5;margin:0}
html,body{margin:0;padding:0}
body{background:#e8eae4;color:#1b2415;font-family:'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,'Noto Sans','Noto Naskh Arabic',sans-serif;font-size:11px;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{display:flex;flex-direction:column;width:148mm;height:209.5mm;margin:13px auto;background:#fff;overflow:hidden}
.band{display:flex;flex:none;justify-content:space-between;align-items:flex-end;padding:16px 23px 9px;background:linear-gradient(115deg,#1a2e05 0%,#2f4a0d 55%,#4d7c0f 100%);color:#fff}
.band div{min-width:0}
.band h1{margin:0;font-size:15px;font-weight:800;line-height:1.2}
.band p{margin:1px 0 0;color:#d9e8c0;font-size:10px}
.band b{flex:none;margin-left:12px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.next-head{display:flex;flex:none;justify-content:space-between;align-items:baseline;margin:0 23px;padding:16px 0 5px;border-bottom:2px solid #4d7c0f}
.next-head b{font-size:12px;font-weight:800}
.next-head span{flex:none;margin-left:12px;color:#4d5a43;font-size:10px;font-weight:600}
.main{display:flex;flex:1;flex-direction:column;min-height:0;padding:7px 23px 0}
.meta{display:flex;flex:none;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.who{min-width:0;font-size:13px;font-weight:800}
.who small{margin-left:6px;color:#4d5a43;font-size:10.5px;font-weight:500;white-space:nowrap}
.dates{flex:none;margin-left:12px;color:#2f4a0d;font-size:11px;font-weight:700}
.summary{display:flex;flex:none;margin-bottom:7px;border:1px solid #d7ddcd;border-radius:6px;overflow:hidden}
.tile{flex:1;min-width:0;padding:4px 7px;border-left:1px solid #d7ddcd;white-space:nowrap}
.tile:first-child{border-left:0}
.tile span{display:block;color:#5d6a53;font-size:9.5px;font-weight:600}
.tile b{display:block;font-size:12px;font-weight:800}
.tile em{margin-left:2px;font-size:9.5px;font-style:normal;font-weight:700}
.tile.closing{flex:1.15;background:#1a2e05;border-left:0;color:#fff}
.tile.closing span{color:#c8df9f}
.t-debit{color:#b91c1c}
.t-credit{color:#047857}
.body{flex:1;min-height:0;overflow:hidden}
table{width:100%;border-collapse:collapse;table-layout:fixed}
col.c-date{width:60px}
th{padding:3px 4px;background:#f1f4ec;border-bottom:1.5px solid #4d7c0f;color:#3c4a31;font-size:9.5px;font-weight:800;text-align:left}
th.num{text-align:right}
td{padding:3px 4px;border-bottom:1px solid #e6eadf;vertical-align:top}
tbody tr:nth-child(even) td{background:#fafbf7}
td.date{color:#3c4a31;font-size:10.5px;font-weight:500;white-space:nowrap}
td.num{font-weight:600;text-align:right;white-space:nowrap}
td.none{color:#b4bcab;font-weight:400}
td.bal{font-weight:700}
td.bal em{margin-left:2px;font-size:9.5px;font-style:normal;font-weight:700}
.title{font-weight:600}
.more{color:#4d5a43}
.warn{color:#b91c1c}
.tag{margin-right:4px;padding:0 4px;border-radius:3px;background:#fee2e2;color:#991b1b;font-size:9.5px;font-weight:700}
tr.is-return .title,tr.is-return td.amount{color:#9aa391}
tr.carry td,tr.carry:nth-child(even) td{background:#f6fbea}
tr.carry .title{font-weight:700;color:#2f4a0d}
tr.totals td,tr.totals:nth-child(even) td{padding:4px;background:#f1f4ec;border-top:1.5px solid #4d7c0f;border-bottom:0;font-weight:800}
tr.totals .title{font-weight:800}
.empty{padding:16px 8px;color:#4d5a43;text-align:center}
#notes{margin-top:6px;color:#3c4a31;font-size:10.5px}
#notes p{margin:0 0 2px}
#notes .warn{font-weight:600}
.foot{flex:none;height:18px;padding:2px 23px 0;color:#4d5a43;font-size:9.5px;text-align:right}
#holding{display:none}
@media print{body{background:#fff}.page{margin:0;break-after:page}.page:last-child{break-after:auto}}
/* Black and white: pure black text and lines, since grey prints as faint dots on a laser printer. */
.mono *{color:#000!important;background:none!important}
.mono .page{background:#fff!important}
.mono .band{margin:0 23px;padding:16px 0 6px;border-bottom:2px solid #000}
.mono .next-head{border-bottom:2px solid #000}
.mono .summary,.mono .tile{border-color:#000}
.mono .tile.closing{border-left:2px solid #000}
.mono th{border-bottom:1.5px solid #000}
.mono td{border-bottom:1px solid #999}
.mono tr.carry td,.mono tr.carry:nth-child(even) td{border-bottom:1px solid #000}
.mono tr.totals td,.mono tr.totals:nth-child(even) td{border-top:1.5px solid #000;border-bottom:1.5px solid #000}
.mono tr.is-return .title,.mono tr.is-return td.amount{font-style:italic;font-weight:500}
.mono .tag{background:#000!important}
.mono .tag{color:#fff!important}
`;

const balanceWord = (balance: number) => {
  const state = balanceState(balance);
  return state === 'due' ? 'Due' : state === 'advance' ? 'Advance' : 'Settled';
};

const amount = (balance: number) => formatCurrency(balanceState(balance) === 'settled' ? 0 : Math.abs(balance));

// Rows drop the "Rs": the columns are narrow, and the summary above already says it.
const plain = (value: number) => formatCurrency(value, '');

const shortDate = (label: string) => label.replace(/ 20(\d\d)$/, ' $1');

// The ledger screen's wording, shortened so most rows stay on one line.
const shortTitle = (description: string) => description
  .replace(/^Ledger Charge: /, 'Charge: ')
  .replace(/^Payment Received /, 'Payment ')
  .replace(/^Sales Return \/ Credit: /, 'Return: ');

const details = (entry: LedgerEntry) => {
  const bill = entry.sale && !entry.rawTx ? entry.sale : undefined;
  const title = bill ? `Bill #${bill.bill_number}` : shortTitle(entry.description);
  const items = bill ? (bill.items || []).map(i => `${i.qty} x ${i.name}`).join(', ') : '';
  const tag = isReturnEntry(entry) ? 'Returned' : entry.isPartiallyReturned ? 'Part. return' : '';
  const refund = entry.refund_amount !== undefined && entry.refund_amount > 0 ? `Refund: ${formatCurrency(entry.refund_amount)}` : '';
  const reason = [entry.return_reason, refund].filter(Boolean).join(', ');
  return [
    tag && `<span class="tag">${tag}</span>`,
    `<span class="title">${esc(title)}</span>`,
    items && ` <span class="more">${esc(items)}</span>`,
    entry.note && !entry.description.includes(entry.note) && ` <span class="more">${esc(entry.note)}</span>`,
    reason && ` <span class="warn">${esc(reason)}</span>`,
  ].filter(Boolean).join('');
};

const moneyCell = (value: number) => (value > 0 ? `<td class="num amount">${plain(value)}</td>` : '<td class="num none">&ndash;</td>');

const drCr = (balance: number) => {
  const state = balanceState(balance);
  return state === 'settled' ? '' : `<em>${state === 'due' ? 'Dr' : 'Cr'}</em>`;
};

const balanceCell = (balance: number) => {
  const state = balanceState(balance);
  const tone = state === 'due' ? 't-debit' : state === 'advance' ? 't-credit' : '';
  return `<td class="num bal ${tone}">${plain(state === 'settled' ? 0 : Math.abs(balance))}${drCr(balance)}</td>`;
};

const entryRow = (entry: LedgerEntry) => `
  <tr class="${isReturnEntry(entry) ? 'is-return' : ''}">
    <td class="date">${esc(shortDate(entry.dateLabel))}</td>
    <td>${details(entry)}</td>
    ${moneyCell(entry.debit)}
    ${moneyCell(entry.credit)}
    ${balanceCell(entry.runningBalance)}
  </tr>`;

const TABLE_HEAD = `
  <colgroup><col class="c-date"><col><col class="c-num"><col class="c-num"><col class="c-bal"></colgroup>
  <thead><tr><th>Date</th><th>Details</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>`;

// Columns as wide as this statement's largest amount, so small amounts leave more room for the details
// and fewer rows wrap to a second line. Roughly one digit at this size, plus the cell padding.
const columnWidth = (values: number[], extra = 0) => Math.max(...values.map(v => plain(Math.abs(v)).length)) * 6.6 + 9 + extra;

const emptyTable = `<div class="body"><table>${TABLE_HEAD}<tbody></tbody></table></div>`;

/** The complete document, with every row waiting in #holding until paginateStatement lays out the pages. */
export function statementHtml(input: StatementInput) {
  const { customer, shop, period, rows, from, to, filterNote, ledgerGap, mono, issuedDay } = input;
  const companyName = (shop.companyName || 'Mooco Dairy').trim();
  const shopLine = [shop.address, shop.phone && `Tel: ${shop.phone}`].filter(Boolean).join('  |  ');
  const hasRange = Boolean(from || to);
  const firstDay = hasRange ? from : period.entries[period.entries.length - 1]?.date || '';
  const lastDay = to || issuedDay;
  const duration = firstDay ? rangeLabel(firstDay, lastDay) : 'No entries yet';
  const balanceToday = Number(customer.balance) || 0;
  const hasGap = Math.abs(ledgerGap) >= 1;

  const carry = from
    ? `<tr class="carry"><td class="date">${esc(shortDate(rangeLabel(from, from)))}</td><td><span class="title">Opening balance</span></td><td class="num none">&ndash;</td><td class="num none">&ndash;</td>${balanceCell(period.openingBalance)}</tr>`
    : '';
  const body = rows.length
    ? [...rows].reverse().map(entryRow).join('')
    : '<tr><td colspan="5" class="empty">No entries in this duration.</td></tr>';
  const shownDebit = rows.reduce((sum, e) => sum + e.debit, 0);
  const shownCredit = rows.reduce((sum, e) => sum + e.credit, 0);
  // A filtered list does not add up to the closing balance, so its total row leaves it out.
  const totals = rows.length
    ? `<tr class="totals"><td></td><td><span class="title">${filterNote ? 'Total of entries shown' : 'Total'}</span></td><td class="num">${plain(shownDebit)}</td><td class="num">${plain(shownCredit)}</td>${filterNote ? '<td></td>' : balanceCell(period.closingBalance)}</tr>`
    : '';

  const amountColumn = Math.max(44, columnWidth([...rows.flatMap(e => [e.debit, e.credit]), shownDebit, shownCredit]));
  const balanceColumn = Math.max(56, columnWidth([...rows.map(e => e.runningBalance), period.openingBalance, period.closingBalance], 15));

  const notes = [
    filterNote && `<p>${esc(filterNote)}</p>`,
    period.returnedAmount > 0 && `<p>Returned goods included in billed: ${formatCurrency(period.returnedAmount)}</p>`,
    hasGap
      ? `<p class="warn">The stored balance (${esc(formatCurrency(balanceToday))}) is ${esc(formatCurrency(Math.abs(ledgerGap)))} ${ledgerGap > 0 ? 'more' : 'less'} than these entries add up to. Please check this statement.</p>`
      : Math.abs(balanceToday - period.closingBalance) >= 0.01 && `<p>Balance today: ${amount(balanceToday)} ${balanceWord(balanceToday)}</p>`,
  ].filter(Boolean).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(`${customer.name} - Statement`)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400..800&display=swap">
  <style>${CSS}col.c-num{width:${amountColumn}px}col.c-bal{width:${balanceColumn}px}</style>
</head>
<body${mono ? ' class="mono"' : ''}>
  <div id="pages">
    <section class="page">
      <header class="band">
        <div>
          <h1>${esc(companyName)}</h1>
          ${shopLine ? `<p>${esc(shopLine)}</p>` : ''}
        </div>
        <b>Statement</b>
      </header>
      <div class="main">
        <div class="meta">
          <div class="who">${esc(customer.name)}${customer.phone ? `<small>${esc(customer.phone)}</small>` : ''}</div>
          <div class="dates">${esc(duration)}</div>
        </div>
        <div class="summary">
          <div class="tile"><span>Opening</span><b>${amount(period.openingBalance)}${drCr(period.openingBalance)}</b></div>
          <div class="tile"><span>Billed</span><b class="t-debit">${formatCurrency(period.totalDebit)}</b></div>
          <div class="tile"><span>Received</span><b class="t-credit">${formatCurrency(period.totalCredit)}</b></div>
          <div class="tile closing"><span>Closing (${balanceWord(period.closingBalance)})</span><b>${amount(period.closingBalance)}${drCr(period.closingBalance)}</b></div>
        </div>
        ${emptyTable}
      </div>
      <footer class="foot page-no"></footer>
    </section>
  </div>
  <template id="next-page">
    <section class="page">
      <header class="next-head"><b>${esc(customer.name)}</b><span>${esc(duration)}</span></header>
      <div class="main">${emptyTable}</div>
      <footer class="foot page-no"></footer>
    </section>
  </template>
  <div id="holding">
    <table><tbody id="rows">${carry}${body}${totals}</tbody></table>
    ${notes ? `<div id="notes">${notes}</div>` : ''}
  </div>
</body>
</html>`;
}

/**
 * Pours the rows into A5 pages inside the loaded document and numbers them when there is more than
 * one. Measuring the real rows is the only way to know where a page ends: items and notes wrap to
 * different heights. Returns the number of pages.
 */
export function paginateStatement(doc: Document) {
  const pages = doc.getElementById('pages') as HTMLElement;
  const template = doc.getElementById('next-page') as HTMLTemplateElement;
  const notes = doc.getElementById('notes');
  let page = pages.querySelector('.page') as HTMLElement;
  let body = page.querySelector('.body') as HTMLElement;
  let tbody = body.querySelector('tbody') as HTMLElement;

  const overflowing = () => body.scrollHeight > body.clientHeight + 1;
  const nextPage = () => {
    page = (template.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;
    pages.appendChild(page);
    body = page.querySelector('.body') as HTMLElement;
    tbody = body.querySelector('tbody') as HTMLElement;
  };

  for (const row of Array.from(doc.querySelectorAll('#rows > tr'))) {
    tbody.appendChild(row);
    // A row taller than a whole page stays where it is, so this can never loop on a fresh page.
    if (overflowing() && tbody.children.length > 1) {
      nextPage();
      tbody.appendChild(row);
    }
  }

  if (notes) {
    body.appendChild(notes);
    if (overflowing()) {
      nextPage();
      (body.querySelector('table') as HTMLElement).remove();
      body.appendChild(notes);
    }
  }

  const all = Array.from(pages.querySelectorAll('.page-no'));
  if (all.length > 1) all.forEach((label, index) => { label.textContent = `Page ${index + 1} of ${all.length}`; });
  return all.length;
}

/** "Bashir-Ahmed-statement-2026-10-01_2026-10-31.pdf" */
export function statementFilename(customerName: string, from: string, to: string) {
  const safe = customerName.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'customer';
  const span = from && to ? `${from}_${to}` : from || to || 'all-time';
  return `${safe}-statement-${span}.pdf`;
}

/**
 * Saves the laid-out pages as an A5 PDF. Each page is drawn from the document itself, so the file
 * looks exactly like the preview and any language in a name renders, which a PDF built from
 * embedded fonts would not do for Urdu script. The libraries load on the first save.
 */
export async function saveStatementPdf(doc: Document, filename: string, onProgress: (done: number, total: number) => void) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const pages = Array.from(doc.querySelectorAll<HTMLElement>('#pages > .page'));
  const pdf = new jsPDF({ unit: 'mm', format: 'a5', compress: true });
  // html2canvas measures font baselines with a 1px image in the app's own page, whatever document it
  // is drawing, and Tailwind's reset makes that image a block: all text then lands about 5px too low.
  const baselineFix = document.createElement('style');
  baselineFix.textContent = 'body > div > img[width="1"]{display:inline}';
  document.head.appendChild(baselineFix);
  try {
    for (const [index, page] of pages.entries()) {
      onProgress(index, pages.length);
      // Let the progress text paint between pages; a long ledger takes a while.
      await new Promise(resolve => setTimeout(resolve));
      const canvas = await html2canvas(page, {
        // A5 text is small, so this draws finer than a screen to stay sharp on paper.
        scale: 3,
        backgroundColor: '#ffffff',
        logging: false,
        // Each capture copies the document; only the page being drawn is needed in the copy.
        ignoreElements: el => el.classList.contains('page') && el !== page,
      });
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 148, (148 * canvas.height) / canvas.width, undefined, 'FAST');
      canvas.width = 0;
    }
  } finally {
    baselineFix.remove();
  }
  onProgress(pages.length, pages.length);
  pdf.save(filename);
}
