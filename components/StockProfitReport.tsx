import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Layers, Calculator } from 'lucide-react';
import { MOOCO_THEME } from '../theme';
import { StockProfitReport as ProfitReport } from '../lib/stockProfit';

interface Props {
  report: ProfitReport | null; loading: boolean; error: string | null;
  start: string; end: string; loadedAt?: string; search: string; onRefresh: () => void;
}
const currency = (amount: number) => `Rs ${amount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantity = (amount: number) => amount.toLocaleString('en-PK', { maximumFractionDigits: 3 });
export default function StockProfitReport({ report, loading, error, start, end, loadedAt, search, onRefresh }: Props) {
  if (loading) return <div className={`${MOOCO_THEME.card.panel} flex items-center gap-3`} role="status"><RefreshCw size={18} className="animate-spin" /><span>Loading complete stock and transaction history…</span></div>;
  if (error || !report) return <div className={`${MOOCO_THEME.card.panel} space-y-3`} role="alert"><p className="font-bold">Profit report could not load</p><p className="text-sm">{error || 'Full history is required to calculate profit.'}</p><button className={MOOCO_THEME.button.primary} onClick={onRefresh}>Retry loading</button></div>;
  const rows = report.rows.filter(row => `${row.name} ${row.location}`.toLowerCase().includes(search.toLowerCase()));
  const reconciled = report.issues.length === 0;
  const metrics = [
    { label: 'Net sales', value: report.netSales, note: 'Cash + credit + delivery, after returns' },
    { label: 'Opening stock at cost', value: report.openingStock, note: `Stock before ${start}` },
    { label: 'Closing stock at cost', value: report.closingStock, note: `Stock at the end of ${end}` },
    { label: reconciled ? 'Net profit / loss' : 'Provisional net profit / loss', value: report.netProfit, note: `Net margin ${report.margin.toFixed(2)}%`, profit: true },
  ];
  const bridge: [string, number, string][] = [
    ['Opening stock', report.openingStock, '+'],
    ['Purchases in selected range', report.grossPurchases, '+'],
    ['Supplier returns in selected range', report.purchaseReturns, '−'],
    ['Additional production conversion cost', report.conversionCost, '+'],
    ['Stock corrections at cost', report.stockAdjustments, '±'],
    ['Closing stock', report.closingStock, '−'],
    ['Consumed stock cost (includes wastage)', report.consumedCost, '='],
    ['Net sales', report.netSales, '+'],
    ['Consumed stock cost', report.consumedCost, '−'],
    ['Gross profit / loss', report.grossProfit, '='],
    ['Operating expenses (paid + unpaid)', report.expenses, '−'],
    ['Net profit / loss', report.netProfit, '='],
  ];
  return <section className="space-y-5 stock-profit-report" data-testid="stock-profit-report">
    <div className={`${MOOCO_THEME.card.panel} flex flex-wrap items-center justify-between gap-3 print:hidden`}>
      <div className="flex items-start gap-2.5">
        {reconciled ? <CheckCircle2 size={20} className="text-lime-600 shrink-0" /> : <AlertCircle size={20} className="text-amber-600 shrink-0" />}
        <div><p className="font-bold text-sm">{reconciled ? 'Recorded stock and costs reconcile' : `${report.issues.length} data check${report.issues.length === 1 ? '' : 's'} need review`}</p><p className="text-xs text-slate-500 mt-1">{loadedAt ? `Loaded ${new Date(loadedAt).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} · ` : ''}Weighted average cost · Pakistan business dates</p>{!reconciled && <a href="#stock-profit-checks" className="inline-block mt-2 text-xs font-bold text-lime-700 dark:text-lime-400 underline">View data checks</a>}</div>
      </div>
      <button type="button" className={MOOCO_THEME.button.secondary} onClick={onRefresh}><RefreshCw size={14} /> Refresh history</button>
    </div>
    {!report.validRange ? <p role="alert" className="font-bold text-red-600">Select a start date on or before the end date.</p> : <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {metrics.map(metric => <div key={metric.label} className={MOOCO_THEME.card.stat}>
          <p className="text-[11px] font-bold uppercase text-slate-500">{metric.label}</p>
          <p data-testid={metric.profit ? 'stock-profit-net' : undefined} className={`text-xl font-black mt-2 tabular-nums ${metric.profit ? (metric.value < 0 ? 'text-red-600' : 'text-emerald-700') : 'text-slate-900 dark:text-white'}`}>{currency(metric.value)}</p>
          <p className="text-xs text-slate-500 mt-2">{metric.note}</p>
        </div>)}
      </div>
      <div className={`${MOOCO_THEME.card.panel} space-y-2`}>
        <p className="flex gap-2 items-center text-sm font-bold"><Calculator size={17} /> Profit formula</p>
        <p className="text-sm leading-relaxed">Net profit = net sales − (opening stock + net purchases + additional conversion cost + stock corrections − closing stock) − operating expenses.</p>
        <p className="text-xs text-slate-500 leading-relaxed">Stock uses purchase cost, including raw milk, loose products, packs, delivery stock and work in progress. Production transfers carry the same cost forward. Wastage is included once in consumed cost. Customer collections, supplier payments, advances and cash transfers do not create profit.</p>
        <p className="text-xs text-slate-500 leading-relaxed">Historical ranges use stock at the selected end date. For today, closing stock is the balance recorded so far. Reconcile physical stock and record all costs before treating the result as final.</p>
      </div>
      <div className={MOOCO_THEME.table.container}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800"><h2 className="font-bold text-sm">Profit calculation · {start} to {end}</h2></div>
        <table className="w-full text-sm"><thead className={MOOCO_THEME.table.thead}><tr><th className="p-3 text-left">Calculation</th><th className="p-3 text-right">PKR</th></tr></thead><tbody>
          {bridge.map(([label, amount, sign], index) => <tr key={`${index}:${label}`} className={`${MOOCO_THEME.table.tr} ${sign === '=' ? 'font-black bg-slate-50 dark:bg-slate-800/50' : ''}`}><td className="px-4 py-3"><span className="inline-block w-6 text-slate-400">{sign}</span>{label}</td><td className={`px-4 py-3 text-right tabular-nums ${index === 11 ? (amount < 0 ? 'text-red-600' : 'text-emerald-700') : ''}`}>{currency(amount)}</td></tr>)}
        </tbody></table>
      </div>
      <div className={MOOCO_THEME.table.container}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800"><h2 className="font-bold text-sm flex gap-2 items-center"><Layers size={17} /> Opening & closing stock audit</h2><p className="text-xs text-slate-500 mt-1">Search filters this table only; profit totals always include all products.</p></div>
        <div className="overflow-x-auto"><table className="w-full text-xs min-w-[850px]"><thead className={MOOCO_THEME.table.thead}><tr>{['Product / location', 'Unit', 'Opening qty', 'Opening avg cost', 'Opening value', 'Closing qty', 'Closing avg cost', 'Closing value'].map(label => <th key={label} className={`px-3 py-3 ${label === 'Product / location' ? 'text-left' : 'text-right'}`}>{label}</th>)}</tr></thead><tbody>
          {report.rows.map(row => <tr key={row.id} className={`${MOOCO_THEME.table.tr} ${rows.some(visible => visible.id === row.id) ? '' : 'hidden print:table-row'}`}><td className="px-3 py-3 font-semibold">{row.name}<span className="block text-slate-500 font-normal mt-1">{row.location}</span></td><td className="px-3 py-3 text-right">{row.unit}</td>{[row.openingQty, row.openingRate, row.openingValue, row.closingQty, row.closingRate, row.closingValue].map((amount, i) => <td key={i} className="px-3 py-3 text-right tabular-nums">{i === 0 || i === 3 ? quantity(amount) : currency(amount)}</td>)}</tr>)}
          {!rows.length && <tr className="print:hidden"><td colSpan={8} className="p-6 text-center text-slate-500">No stock balances match this range and search.</td></tr>}
        </tbody><tfoot><tr className="font-black border-t border-slate-200 dark:border-slate-700"><td colSpan={4} className="p-3">All stock at cost</td><td className="p-3 text-right">{currency(report.openingStock)}</td><td colSpan={2}></td><td className="p-3 text-right">{currency(report.closingStock)}</td></tr></tfoot></table></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`${MOOCO_THEME.card.base} p-4 space-y-3`}><h2 className="text-sm font-bold">Sales & stock loss</h2>{[['POS invoices', report.posSales], ['Completed delivery sales', report.supplySales], ['Sales returns / refunds', -report.salesReturns], ['Recorded stock loss (already in cost)', report.stockLoss]].map(([label, amount]) => <div key={String(label)} className="flex justify-between gap-2 text-sm"><span className="text-slate-500">{label}</span><span className="font-bold tabular-nums">{currency(Number(amount))}</span></div>)}</div>
        <div className={`${MOOCO_THEME.card.base} p-4 space-y-3`}><h2 className="text-sm font-bold">Operating expenses</h2>{report.expenseCategories.map(category => <div key={category.name} className="flex justify-between gap-2 text-sm"><span className="text-slate-500">{category.name}</span><span className="font-bold tabular-nums">{currency(category.amount)}</span></div>)}{!report.expenseCategories.length && <p className="text-sm text-slate-500">No recorded expenses in this range.</p>}</div>
      </div>
    </>}
    {report.issues.length > 0 && <div id="stock-profit-checks" className={`${MOOCO_THEME.card.base} p-4 space-y-3 scroll-mt-4`} role="note"><h2 className="font-bold text-sm flex gap-2 items-center"><AlertCircle size={17} className="text-amber-600" /> Review before finalising profit</h2><p className="text-xs text-slate-500">The calculation is provisional until these records are corrected. Missing costs are never presented as confirmed profit.</p><ul className="space-y-2 text-xs list-disc pl-5">{report.issues.map((issue, index) => <li key={index}>{issue.item && <strong>{issue.item}: </strong>}{issue.message}</li>)}</ul></div>}
  </section>;
}
