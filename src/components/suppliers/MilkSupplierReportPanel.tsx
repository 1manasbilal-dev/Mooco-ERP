import { memo } from 'react';
import { Milk } from 'lucide-react';
import {
  MilkGroupMode,
  MilkReportSection,
  MilkSupplierReport,
  formatMilkQty,
  formatMilkRate
} from '../../lib/milkSupplierReport';
import { formatLedgerDate } from '../../lib/supplierStatement';
import { formatQty } from '../../lib/formatters';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { Badge, Card, EmptyState, LoadMoreRow, Money, SegmentedControl, Select, TBody, TD, TH, THead, TR, Table } from '../ui';
import type { SegmentOption } from '../ui';

const GROUPS: SegmentOption<MilkGroupMode>[] = [
  { value: 'milk', label: 'By milk' },
  { value: 'shift', label: 'By shift' },
  { value: 'day', label: 'By day' }
];

const SectionCard = memo(function SectionCard({ section, report, resetKey }: {
  section: MilkReportSection;
  report: MilkSupplierReport;
  resetKey: unknown;
}) {
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(section.lines, 60, resetKey);
  const showDate = report.mode !== 'day';
  const showShift = report.mode !== 'shift';
  const showMilk = report.mode !== 'milk';
  const columns = 4 + Number(showDate) + Number(showShift) + Number(showMilk) + Number(report.showFat) + Number(report.showSnf);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-fg">{section.title}</p>
          <p className="text-[11px] font-medium text-fg-subtle">
            {section.slips} slip{section.slips === 1 ? '' : 's'}
            {section.fat > 0 ? ` · Fat ${formatMilkQty(section.fat)}` : ''}
            {` · ${formatMilkRate(section.rate)}/L`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[13px] font-bold tabular-nums text-fg">{formatQty(section.litres)} L</p>
          <Money amount={section.amount} className="text-xs font-semibold text-fg-muted" />
        </div>
      </div>
      <Table className="min-w-[560px]">
        <THead>
          <tr>
            {showDate && <TH>Date</TH>}
            {showShift && <TH>Shift</TH>}
            {showMilk && <TH>Milk</TH>}
            <TH numeric>Litres</TH>
            {report.showFat && <TH numeric>Fat</TH>}
            {report.showSnf && <TH numeric>SNF</TH>}
            <TH numeric>Rate</TH>
            <TH numeric>Amount</TH>
          </tr>
        </THead>
        <TBody>
          {visibleItems.map(line => (
            <TR key={line.id}>
              {showDate && <TD className="whitespace-nowrap py-2 text-[13px] font-semibold tabular-nums text-fg-muted">{formatLedgerDate(line.date)}</TD>}
              {showShift && <TD className="py-2 text-[13px] text-fg-muted">{line.shift}</TD>}
              {showMilk && <TD className="py-2 text-[13px] font-medium">{line.milkType}</TD>}
              <TD numeric className="py-2">{formatMilkQty(line.litres)}</TD>
              {report.showFat && <TD numeric className="py-2 font-medium text-fg-muted">{line.fat > 0 ? formatMilkQty(line.fat) : '—'}</TD>}
              {report.showSnf && <TD numeric className="py-2 font-medium text-fg-muted">{line.snf > 0 ? formatMilkQty(line.snf) : '—'}</TD>}
              <TD numeric className="py-2 font-medium text-fg-muted">{formatMilkRate(line.rate)}</TD>
              <TD numeric className="py-2"><Money amount={line.amount} /></TD>
            </TR>
          ))}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={columns} />
        </TBody>
      </Table>
    </Card>
  );
});

export function MilkSupplierReportPanel(props: {
  report: MilkSupplierReport;
  groupBy: MilkGroupMode;
  milkType: string;
  shift: string;
  onGroupBy: (mode: MilkGroupMode) => void;
  onMilkType: (value: string) => void;
  onShift: (value: string) => void;
  /** Supplier / range key; a change shows the first page again. */
  resetKey?: unknown;
}) {
  const { report } = props;
  const resetKey = `${String(props.resetKey ?? '')}|${report.mode}|${report.filterLabel}`;
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(report.sections, 12, resetKey);

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <SegmentedControl aria-label="Milk report grouping" size="sm" value={props.groupBy} onChange={props.onGroupBy} options={GROUPS} />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          Milk
          <Select value={props.milkType} onChange={event => props.onMilkType(event.target.value)} className="h-8 w-auto text-xs">
            <option value="all">All milk</option>
            {props.milkType !== 'all' && !report.milkOptions.includes(props.milkType) && (
              <option value={props.milkType}>{props.milkType}</option>
            )}
            {report.milkOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          Shift
          <Select value={props.shift} onChange={event => props.onShift(event.target.value)} className="h-8 w-auto text-xs">
            <option value="all">All shifts</option>
            {props.shift !== 'all' && !report.shiftOptions.some(option => option.toLowerCase() === props.shift.toLowerCase()) && (
              <option value={props.shift}>{props.shift}</option>
            )}
            {report.shiftOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </label>
        <span className="text-xs text-fg-subtle sm:ml-auto">{report.filterLabel}</span>
      </Card>

      {(report.milkBreakdown.length > 0 || report.shiftBreakdown.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {report.milkBreakdown.map(bucket => (
            <Badge key={`m-${bucket.label}`} tone="info" className="tabular-nums">
              {bucket.label} {formatQty(bucket.litres)} L
            </Badge>
          ))}
          {report.shiftBreakdown.map(bucket => (
            <Badge key={`s-${bucket.label}`} className="tabular-nums">
              {bucket.label} {formatQty(bucket.litres)} L
            </Badge>
          ))}
        </div>
      )}

      {report.slipCount === 0 ? (
        <Card>
          <EmptyState
            icon={<Milk />}
            title={report.rangeCount > 0 ? 'No milk matches this filter' : 'No milk in this period'}
            description={report.rangeCount > 0 ? 'Choose All milk / All shifts to see every collection.' : 'Change the dates, or record milk for this supplier.'}
          />
        </Card>
      ) : (
        <>
          {visibleItems.map(section => <SectionCard key={section.id} section={section} report={report} resetKey={resetKey} />)}
          <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
        </>
      )}
    </div>
  );
}

export default MilkSupplierReportPanel;
