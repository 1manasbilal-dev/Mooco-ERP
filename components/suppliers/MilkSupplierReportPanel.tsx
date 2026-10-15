import React from 'react';
import { Milk } from 'lucide-react';
import {
  MilkGroupMode,
  MilkSupplierReport,
  formatMilkQty,
  formatMilkRate
} from '../../lib/milkSupplierReport';
import { formatLedgerDate, formatMoney } from '../../lib/supplierStatement';

const GROUPS: { id: MilkGroupMode; label: string }[] = [
  { id: 'milk', label: 'By milk' },
  { id: 'shift', label: 'By shift' },
  { id: 'day', label: 'By day' }
];

export function MilkSupplierReportPanel(props: {
  report: MilkSupplierReport;
  groupBy: MilkGroupMode;
  milkType: string;
  shift: string;
  onGroupBy: (mode: MilkGroupMode) => void;
  onMilkType: (value: string) => void;
  onShift: (value: string) => void;
}) {
  const { report } = props;
  const showDate = report.mode !== 'day';
  const showShift = report.mode !== 'shift';
  const showMilk = report.mode !== 'milk';

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-2xs space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          {GROUPS.map(group => (
            <button
              key={group.id}
              type="button"
              onClick={() => props.onGroupBy(group.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                props.groupBy === group.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
            Milk
            <select
              value={props.milkType}
              onChange={event => props.onMilkType(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
            >
              <option value="all">All milk</option>
              {props.milkType !== 'all' && !report.milkOptions.includes(props.milkType) && (
                <option value={props.milkType}>{props.milkType}</option>
              )}
              {report.milkOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
            Shift
            <select
              value={props.shift}
              onChange={event => props.onShift(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-800"
            >
              <option value="all">All shifts</option>
              {props.shift !== 'all' && !report.shiftOptions.some(option => option.toLowerCase() === props.shift.toLowerCase()) && (
                <option value={props.shift}>{props.shift}</option>
              )}
              {report.shiftOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <span className="text-[11px] font-semibold text-slate-400">{report.filterLabel}</span>
        </div>
      </div>

      {(report.milkBreakdown.length > 0 || report.shiftBreakdown.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {report.milkBreakdown.map(bucket => (
            <span key={`m-${bucket.label}`} className="px-2 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-100 text-[11px] font-bold">
              {bucket.label} {formatMilkQty(bucket.litres)} L
            </span>
          ))}
          {report.shiftBreakdown.map(bucket => (
            <span key={`s-${bucket.label}`} className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold">
              {bucket.label} {formatMilkQty(bucket.litres)} L
            </span>
          ))}
        </div>
      )}

      {report.slipCount === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-2xs">
          <Milk size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="font-bold text-sm text-slate-700">
            {report.rangeCount > 0 ? 'No milk for this filter' : 'No milk in this period'}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {report.rangeCount > 0 ? 'Choose All milk or All shifts to see every collection.' : 'Change the dates, or record milk for this supplier.'}
          </p>
        </div>
      ) : (
        report.sections.map(section => (
          <div key={section.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-800 truncate">{section.title}</p>
                <p className="text-[10px] font-semibold text-slate-400">
                  {section.slips} slip{section.slips === 1 ? '' : 's'}
                  {section.fat > 0 ? ` · Fat ${formatMilkQty(section.fat)}` : ''}
                  {` · ${formatMilkRate(section.rate)}/L`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-black text-slate-900">{formatMilkQty(section.litres)} L</p>
                <p className="text-[11px] font-bold text-amber-700">{formatMoney(section.amount)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[640px]">
                <thead className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    {showDate && <th className="px-3 py-2">Date</th>}
                    {showShift && <th className="px-3 py-2">Shift</th>}
                    {showMilk && <th className="px-3 py-2">Milk</th>}
                    <th className="px-3 py-2 text-right">Litres</th>
                    {report.showFat && <th className="px-3 py-2 text-right">Fat</th>}
                    {report.showSnf && <th className="px-3 py-2 text-right">SNF</th>}
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {section.lines.map(line => (
                    <tr key={line.id}>
                      {showDate && <td className="px-3 py-2 font-mono font-bold text-slate-600 whitespace-nowrap">{formatLedgerDate(line.date)}</td>}
                      {showShift && <td className="px-3 py-2 font-semibold text-slate-700">{line.shift}</td>}
                      {showMilk && <td className="px-3 py-2 font-semibold text-slate-800">{line.milkType}</td>}
                      <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{formatMilkQty(line.litres)}</td>
                      {report.showFat && <td className="px-3 py-2 text-right font-mono text-slate-500">{line.fat > 0 ? formatMilkQty(line.fat) : '—'}</td>}
                      {report.showSnf && <td className="px-3 py-2 text-right font-mono text-slate-500">{line.snf > 0 ? formatMilkQty(line.snf) : '—'}</td>}
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{formatMilkRate(line.rate)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-amber-700">{formatMoney(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
