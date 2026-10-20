import { buildXlsx, downloadBlob, XlsxCell, XlsxSheet } from './xlsx';
import { cellText, formatValue, isNumericFormat, tableTotals } from './format';
import type { ReportColumn, ReportDefinition, ReportFilters, ReportResult, ReportRow, ReportTable } from './types';

export interface ExportInput {
  report: ReportDefinition;
  result: ReportResult;
  filters: ReportFilters;
  rangeLabel: string;
  company: { companyName?: string; address?: string; phone?: string; email?: string; taxId?: string };
  generatedBy?: string;
  /** Per table: the rows as the viewer sees them (searched and sorted) and their visible columns. */
  views?: Record<string, { rows: ReportRow[]; columns: ReportColumn[] }>;
}

const viewOf = (input: ExportInput, table: ReportTable) => input.views?.[table.id] || { rows: table.rows, columns: table.columns.filter(c => !c.hidden) };

const fileBase = (input: ExportInput) =>
  `${input.report.title.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}_${input.filters.from}_to_${input.filters.to}`;

const generatedAt = () => new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());

/* ------------------------------------------------------------------ xlsx */

const cellStyle = (column: ReportColumn, strong?: boolean): XlsxCell['style'] => {
  if (column.format === 'money') return strong ? 'strongMoney' : 'money';
  if (column.format === 'qty') return strong ? 'strongQty' : 'qty';
  if (column.format === 'number') return strong ? 'strongQty' : 'number';
  if (column.format === 'percent') return 'percent';
  return strong ? 'strong' : 'text';
};

const xlsxValue = (row: ReportRow, column: ReportColumn): string | number => {
  const value = row[column.key];
  if (isNumericFormat(column.format)) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
  return cellText(row, column);
};

export function exportXlsx(input: ExportInput) {
  const { report, result } = input;
  const sheets: XlsxSheet[] = [];
  const summary: XlsxCell[][] = [
    [{ value: input.company.companyName || 'Mooco Dairy', style: 'title' }],
    [{ value: report.title, style: 'strong' }],
    [{ value: input.rangeLabel, style: 'muted' }],
    [{ value: `Generated ${generatedAt()}${input.generatedBy ? ` by ${input.generatedBy}` : ''}`, style: 'muted' }],
    [],
  ];
  if (result.kpis?.length) {
    summary.push([{ value: 'Key figures', style: 'header' }, { value: '', style: 'header' }]);
    result.kpis.forEach(k => summary.push([{ value: k.label }, { value: k.value, style: k.format === 'money' ? 'money' : k.format === 'percent' ? 'percent' : 'number' }]));
    summary.push([]);
  }
  result.statements?.forEach(statement => {
    summary.push([{ value: statement.title, style: 'header' }, { value: '', style: 'header' }]);
    statement.lines.forEach(line => summary.push([
      { value: `${'   '.repeat(line.indent || 0)}${line.label}`, style: line.strong ? 'strong' : 'text' },
      { value: line.value, style: line.strong ? (line.format === 'percent' ? 'percent' : 'strongMoney') : line.format === 'percent' ? 'percent' : line.format === 'qty' ? 'qty' : 'money' },
    ]));
    summary.push([]);
  });
  result.notes?.forEach(note => summary.push([{ value: `Note: ${note.text}`, style: 'muted' }]));
  result.insights?.forEach(text => summary.push([{ value: `• ${text}`, style: 'muted' }]));
  sheets.push({ name: 'Summary', rows: summary, widths: [46, 20] });

  result.tables?.forEach(table => {
    const { rows, columns } = viewOf(input, table);
    const header: XlsxCell[] = columns.map(c => ({ value: c.label + (c.unit ? ` (${c.unit})` : ''), style: 'header' }));
    const body: XlsxCell[][] = rows.map(row => columns.map(c => ({ value: xlsxValue(row, c), style: cellStyle(c, Boolean(row._strong)) })));
    const extra: XlsxCell[][] = [];
    if (table.showTotals && rows.length) {
      const totals = tableTotals(table, rows);
      extra.push(columns.map((c, i) => ({ value: c.total ? Number(totals[c.key]) : i === 0 ? 'Total' : '', style: cellStyle(c, true) })));
    }
    table.footer?.forEach(row => extra.push(columns.map(c => ({ value: xlsxValue(row, c), style: cellStyle(c, true) }))));
    const widths = columns.map((c, i) => Math.max(c.label.length + 2, ...body.slice(0, 300).map(cells => String(cells[i]?.value ?? '').length + 2), isNumericFormat(c.format) ? 12 : 8));
    const titleRows: XlsxCell[][] = table.title ? [[{ value: table.title, style: 'strong' }]] : [];
    sheets.push({ name: table.title || report.title, rows: [...titleRows, header, ...body, ...extra], widths, freezeRow: titleRows.length + 1 });
  });
  downloadBlob(buildXlsx(sheets), `${fileBase(input)}.xlsx`);
}

/* ------------------------------------------------------------------- csv */

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function exportCsv(input: ExportInput) {
  const lines: string[] = [csvCell(input.report.title), csvCell(input.rangeLabel), ''];
  input.result.kpis?.forEach(k => lines.push([csvCell(k.label), csvCell(k.value)].join(',')));
  input.result.tables?.forEach(table => {
    const { rows, columns } = viewOf(input, table);
    lines.push('');
    if (table.title) lines.push(csvCell(table.title));
    lines.push(columns.map(c => csvCell(c.label)).join(','));
    rows.forEach(row => lines.push(columns.map(c => csvCell(isNumericFormat(c.format) ? Number(row[c.key]) || 0 : cellText(row, c))).join(',')));
    if (table.showTotals && rows.length) {
      const totals = tableTotals(table, rows);
      lines.push(columns.map((c, i) => csvCell(c.total ? totals[c.key] : i === 0 ? 'Total' : '')).join(','));
    }
  });
  downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileBase(input)}.csv`);
}

/* ---------------------------------------------------------------- clipboard */

/** Tab separated, so it pastes straight into Excel or Google Sheets cells. */
export function tableAsTsv(table: ReportTable, view?: { rows: ReportRow[]; columns: ReportColumn[] }) {
  const { rows, columns } = view || { rows: table.rows, columns: table.columns.filter(c => !c.hidden) };
  const clean = (v: unknown) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
  return [
    columns.map(c => clean(c.label)).join('\t'),
    ...rows.map(row => columns.map(c => clean(isNumericFormat(c.format) ? Number(row[c.key]) || 0 : cellText(row, c))).join('\t')),
  ].join('\n');
}

/* ----------------------------------------------------------------- print */

const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function reportHtml(input: ExportInput): string {
  const { report, result, company } = input;
  const kpis = (result.kpis || []).map(k => `<div class="kpi"><div class="kl">${html(k.label)}</div><div class="kv">${html(formatValue(k.value, k.format || 'number', k.unit))}</div>${k.hint ? `<div class="kh">${html(k.hint)}</div>` : ''}</div>`).join('');
  const statements = (result.statements || []).map(s => `<section class="stmt"><h3>${html(s.title)}</h3><table>${s.lines.map(l =>
    `<tr class="${l.strong ? 'strong' : ''}"><td style="padding-left:${8 + (l.indent || 0) * 16}px">${html(l.label)}${l.note ? `<span class="note"> · ${html(l.note)}</span>` : ''}</td><td class="num ${l.value < 0 ? 'neg' : ''}">${html(formatValue(l.value, l.format || 'money'))}</td></tr>`).join('')}</table></section>`).join('');
  const tables = (result.tables || []).map(table => {
    const { rows, columns } = viewOf(input, table);
    const totals = table.showTotals && rows.length ? tableTotals(table, rows) : null;
    const head = columns.map(c => `<th class="${isNumericFormat(c.format) ? 'num' : ''}">${html(c.label)}</th>`).join('');
    const bodyRow = (row: ReportRow, cls = '') => `<tr class="${cls} ${row._strong ? 'strong' : ''} ${row._tone ? `t-${row._tone}` : ''}">${columns.map(c => {
      const v = row[c.key];
      const neg = c.signed && Number(v) < 0;
      return `<td class="${isNumericFormat(c.format) ? 'num' : ''} ${neg ? 'neg' : ''}">${html(cellText(row, c))}</td>`;
    }).join('')}</tr>`;
    return `<section><h3>${html(table.title || '')}</h3>${table.subtitle ? `<p class="sub">${html(table.subtitle)}</p>` : ''}<table class="grid"><thead><tr>${head}</tr></thead><tbody>${
      rows.length ? rows.map(r => bodyRow(r)).join('') : `<tr><td colspan="${columns.length}" class="empty">${html(table.emptyText || 'No records in this period')}</td></tr>`
    }</tbody>${totals || table.footer?.length ? `<tfoot>${totals ? bodyRow(totals, 'strong') : ''}${(table.footer || []).map(r => bodyRow(r, 'strong')).join('')}</tfoot>` : ''}</table></section>`;
  }).join('');
  const notes = [...(result.notes || []).map(n => n.text), ...(result.insights || [])].map(t => `<li>${html(t)}</li>`).join('');
  const wide = (result.tables || []).some(t => viewOf(input, t).columns.length > 8);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${html(report.title)}</title><style>
    @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }
    * { box-sizing: border-box; } body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #4d7c0f; padding-bottom: 10px; margin-bottom: 14px; }
    header h1 { margin: 0; font-size: 20px; color: #365314; } header .co { color: #475569; font-size: 10px; margin-top: 2px; }
    header .rt { text-align: right; } header h2 { margin: 0; font-size: 15px; } header .range { color: #475569; margin-top: 2px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 14px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; } .kl { color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
    .kv { font-size: 14px; font-weight: 700; margin-top: 2px; } .kh { color: #64748b; font-size: 9px; }
    section { margin-bottom: 14px; page-break-inside: auto; } h3 { font-size: 12px; margin: 0 0 4px; color: #1e293b; } .sub { margin: 0 0 4px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; } .grid th { background: #4d7c0f; color: #fff; text-align: left; padding: 5px 6px; font-size: 10px; }
    .grid td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; } .grid tbody tr:nth-child(even) td { background: #f8fafc; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; } .neg { color: #dc2626; }
    tr.strong td { font-weight: 700; background: #f1f5f9 !important; border-top: 1px solid #94a3b8; }
    .t-bad td { color: #b91c1c; } .t-warn td { background: #fffbeb !important; }
    .stmt table td { padding: 4px 8px; border-bottom: 1px dashed #e2e8f0; } .stmt { max-width: 640px; } .note { color: #64748b; font-size: 9px; }
    .empty { text-align: center; color: #94a3b8; padding: 14px; } ul.notes { color: #475569; padding-left: 16px; }
    footer { margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 6px; color: #94a3b8; font-size: 9px; display: flex; justify-content: space-between; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
  </style></head><body>
    <header><div><h1>${html(company.companyName || 'Mooco Dairy')}</h1><div class="co">${html([company.address, company.phone, company.email].filter(Boolean).join(' · '))}${company.taxId ? ` · NTN ${html(company.taxId)}` : ''}</div></div>
    <div class="rt"><h2>${html(report.title)}</h2><div class="range">${html(input.rangeLabel)}</div></div></header>
    ${kpis ? `<div class="kpis">${kpis}</div>` : ''}${statements}${tables}${notes ? `<ul class="notes">${notes}</ul>` : ''}
    <footer><span>Generated ${html(generatedAt())}${input.generatedBy ? ` by ${html(input.generatedBy)}` : ''}</span><span>Mooco ERP · Reports</span></footer>
  </body></html>`;
}

export function printReport(input: ExportInput): boolean {
  const popup = window.open('', '_blank', 'width=1100,height=800');
  if (!popup) return false;
  popup.document.open();
  popup.document.write(reportHtml(input));
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 400);
  return true;
}

/* ---------------------------------------------------------------- share */

export function shareText(input: ExportInput): string {
  const lines = [`*${input.company.companyName || 'Mooco Dairy'}*`, `*${input.report.title}*`, input.rangeLabel, ''];
  input.result.kpis?.forEach(k => lines.push(`${k.label}: *${formatValue(k.value, k.format || 'number', k.unit)}*`));
  input.result.statements?.forEach(s => {
    lines.push('', `_${s.title}_`);
    s.lines.filter(l => l.strong).forEach(l => lines.push(`${l.label}: *${formatValue(l.value, l.format || 'money')}*`));
  });
  const first = input.result.tables?.[0];
  if (first?.rows.length && first.rows.length <= 60) {
    const { rows, columns } = viewOf(input, first);
    const shown = columns.slice(0, 3);
    lines.push('', `_${first.title || 'Details'}_`);
    rows.slice(0, 10).forEach(row => lines.push(`• ${shown.map(c => cellText(row, c)).join(' — ')}`));
    if (rows.length > 10) lines.push(`…and ${rows.length - 10} more`);
  }
  input.result.insights?.forEach(t => lines.push(`💡 ${t}`));
  return lines.join('\n');
}
