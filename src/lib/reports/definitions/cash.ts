import type { ReportDefinition, ReportRow } from '../types';
import { accountName, COLOR, groupSum, inRange, n, r2, sum } from '../helpers';
import type { ShiftSession } from '../../../types';

const EPS = 0.009;
const signedTone = (value: number) => (Math.abs(value) > EPS ? 'bad' as const : undefined);

const shiftDate = (s: ShiftSession) => s.business_date || s.date;
const shiftCounted = (s: ShiftSession) => s.closing_counted_cash ?? s.actual_physical_cash;
const shiftDifference = (s: ShiftSession) => {
  const stored = s.closing_variance ?? s.cash_difference;
  if (stored !== undefined && stored !== null) return r2(n(stored));
  const counted = shiftCounted(s);
  return counted !== undefined && counted !== null && s.expected_drawer_cash !== undefined ? r2(n(counted) - n(s.expected_drawer_cash)) : 0;
};

export const cashReports: ReportDefinition[] = [
  {
    id: 'shift_summary',
    title: 'Shift Report',
    subtitle: 'Every shift with sales, expected cash, counted cash and difference',
    category: 'cash',
    icon: 'Timer',
    keywords: ['shift', 'drawer', 'closing', 'cashier', 'galla'],
    filters: ['cashierId'],
    build: (data, f) => {
      const shifts = data.shiftSessions.filter(s => inRange(shiftDate(s), f) && (!f.cashierId || s.user_id === f.cashierId));
      const rows: ReportRow[] = shifts.map(s => {
        const diff = shiftDifference(s);
        const counted = shiftCounted(s);
        return {
          date: shiftDate(s), cashier: s.user_name || 'Unknown', drawer: s.drawer_name || s.account_name || (s.account_id ? accountName(data, s.account_id) : '—'),
          shift: s.shift_name, opened: s.started_at || s.start_time, closed: s.closed_at || s.end_time || '', status: s.status,
          float: r2(n(s.opening_float)), bills: n(s.bills_count),
          gross: r2(n(s.gross_sales)), cash: r2(n(s.cash_sales)), online: r2(n(s.online_sales)), credit: r2(n(s.credit_sales)),
          recovered: r2(n(s.khata_cash_recovered)), expenses: r2(n(s.drawer_expenses_paid) + n(s.spot_purchases_paid)),
          // Not counted yet (open shift): blank, not Rs 0, which read as a full shortage.
          expected: s.expected_drawer_cash !== undefined && s.expected_drawer_cash !== null ? r2(n(s.expected_drawer_cash)) : null, counted: counted !== undefined && counted !== null ? r2(n(counted)) : null,
          difference: diff, reason: s.difference_reason || '',
          _tone: signedTone(diff),
        };
      });
      const diffs = rows.map(r => n(r.difference));
      const short = r2(diffs.filter(d => d < 0).reduce((s, d) => s - d, 0));
      const excess = r2(diffs.filter(d => d > 0).reduce((s, d) => s + d, 0));
      const byCashier = groupSum(rows, r => String(r.cashier), r => n(r.difference));
      const open = shifts.filter(s => !['Closed', 'Force Closed'].includes(s.status)).length;
      return {
        kpis: [
          { key: 'shifts', label: 'Shifts', value: rows.length, format: 'number', hint: open ? `${open} still open` : undefined },
          { key: 'gross', label: 'Sales', value: sum(rows, r => n(r.gross)), format: 'money', tone: 'good' },
          { key: 'cash', label: 'Cash sales', value: sum(rows, r => n(r.cash)), format: 'money' },
          { key: 'expected', label: 'Expected cash', value: sum(rows, r => n(r.expected)), format: 'money' },
          { key: 'short', label: 'Short', value: short, format: 'money', inverse: true, tone: short > EPS ? 'bad' : 'neutral' },
          { key: 'excess', label: 'Excess', value: excess, format: 'money', tone: excess > EPS ? 'warn' : 'neutral' },
        ],
        charts: [{
          id: 'diff', title: 'Cash difference by cashier', type: 'bar', xKey: 'name', format: 'money', wide: true,
          data: byCashier, series: [{ key: 'value', label: 'Difference', color: COLOR.returns }],
        }],
        tables: [{
          id: 'shifts', showTotals: true, sort: { key: 'opened', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Business date', format: 'date' },
            { key: 'cashier', label: 'Cashier' },
            { key: 'drawer', label: 'Drawer' },
            { key: 'shift', label: 'Shift' },
            { key: 'opened', label: 'Opened', format: 'datetime' },
            { key: 'closed', label: 'Closed', format: 'datetime', hidden: true },
            {
              key: 'status', label: 'Status', format: 'badge', tones: {
                Active: 'info', Closed: 'good', 'Force Closed': 'bad', 'Pending Review': 'warn', Closing: 'warn', 'Pending Acceptance': 'neutral',
              },
            },
            { key: 'float', label: 'Opening float', format: 'money', total: true },
            { key: 'bills', label: 'Bills', format: 'number', total: true, hidden: true },
            { key: 'gross', label: 'Sales', format: 'money', total: true },
            { key: 'cash', label: 'Cash', format: 'money', total: true },
            { key: 'online', label: 'Online', format: 'money', total: true },
            { key: 'credit', label: 'Credit', format: 'money', total: true },
            { key: 'recovered', label: 'Khata recovered', format: 'money', total: true, hidden: true },
            { key: 'expenses', label: 'Paid out', format: 'money', total: true, hidden: true },
            { key: 'expected', label: 'Expected cash', format: 'money', total: true },
            { key: 'counted', label: 'Counted', format: 'money', total: true },
            { key: 'difference', label: 'Difference', format: 'money', total: true, signed: true },
            { key: 'reason', label: 'Reason', wrap: true, hidden: true },
          ],
          rows,
          emptyText: 'No shifts in these dates.',
        }],
        notes: open ? [{ tone: 'info', text: `${open} shift(s) are not closed yet, so their sales and counted cash may be incomplete.` }] : undefined,
      };
    },
  },
  {
    id: 'cash_variances',
    title: 'Cash Shortage / Excess',
    subtitle: 'Every cash difference found at handover, closing or remittance',
    category: 'cash',
    icon: 'AlertTriangle',
    keywords: ['short', 'excess', 'variance', 'kami', 'ziyada'],
    build: (data, f) => {
      const rows: ReportRow[] = data.cashVariances.filter(v => inRange(v.created_at, f)).map(v => {
        const variance = v.variance !== undefined && v.variance !== null ? r2(n(v.variance)) : r2(n(v.counted_amount) - n(v.expected_amount));
        return {
          date: v.created_at, type: v.variance_type, expected: r2(n(v.expected_amount)), counted: r2(n(v.counted_amount)),
          variance, result: variance < -EPS ? 'Short' : variance > EPS ? 'Excess' : 'Matched',
          reason: v.reason || '', status: v.status, reported: v.reported_by || '', resolved: v.resolved_by || '',
          notes: v.resolution_notes || '',
          _tone: v.status === 'Open' ? 'warn' : undefined,
        };
      });
      const short = r2(rows.filter(r => n(r.variance) < 0).reduce((s, r) => s - n(r.variance), 0));
      const excess = r2(rows.filter(r => n(r.variance) > 0).reduce((s, r) => s + n(r.variance), 0));
      const openRows = rows.filter(r => r.status === 'Open');
      return {
        kpis: [
          { key: 'short', label: 'Total short', value: short, format: 'money', inverse: true, tone: short > EPS ? 'bad' : 'neutral' },
          { key: 'excess', label: 'Total excess', value: excess, format: 'money', tone: excess > EPS ? 'warn' : 'neutral' },
          { key: 'net', label: 'Net difference', value: r2(excess - short), format: 'money', tone: excess - short < -EPS ? 'bad' : 'neutral' },
          { key: 'open', label: 'Open cases', value: openRows.length, format: 'number', tone: openRows.length ? 'warn' : 'good', hint: openRows.length ? `Rs ${Math.round(sum(openRows, r => Math.abs(n(r.variance)))).toLocaleString('en-PK')} unresolved` : undefined },
        ],
        charts: [{
          id: 'types', title: 'Difference by type', type: 'bar', xKey: 'name', format: 'money',
          data: groupSum(rows, r => String(r.type), r => n(r.variance)), series: [{ key: 'value', label: 'Difference', color: COLOR.returns }],
        }],
        tables: [{
          id: 'variances', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Date / time', format: 'datetime' },
            { key: 'type', label: 'Type' },
            { key: 'expected', label: 'Expected', format: 'money', total: true },
            { key: 'counted', label: 'Counted', format: 'money', total: true },
            { key: 'variance', label: 'Difference', format: 'money', total: true, signed: true },
            { key: 'result', label: 'Result', format: 'badge', tones: { Short: 'bad', Excess: 'warn', Matched: 'good' } },
            { key: 'reason', label: 'Reason', wrap: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Open: 'warn', Approved: 'good', Adjusted: 'info', Rejected: 'bad' } },
            { key: 'reported', label: 'Reported by' },
            { key: 'resolved', label: 'Resolved by', hidden: true },
            { key: 'notes', label: 'Resolution', wrap: true, hidden: true },
          ],
          rows,
          emptyText: 'No cash differences in these dates.',
        }],
      };
    },
  },
  {
    id: 'cash_remittances',
    title: 'Cash Handed to Head',
    subtitle: 'Cash sent from drawers to the head cashier, counted and accepted',
    category: 'cash',
    icon: 'HandCoins',
    keywords: ['remittance', 'cash drop', 'handover', 'jama'],
    filters: ['cashierId'],
    build: (data, f) => {
      const list = data.cashRemittances.filter(r => inRange(r.declared_at, f) && (!f.cashierId || r.cashier_id === f.cashierId));
      const rows: ReportRow[] = list.map(r => {
        const hasCount = r.counted_amount !== undefined && r.counted_amount !== null;
        const variance = r.variance !== undefined && r.variance !== null ? r2(n(r.variance)) : hasCount ? r2(n(r.counted_amount) - n(r.declared_amount)) : 0;
        return {
          date: r.declared_at, cashier: r.cashier_name || 'Unknown', bag: r.bag_reference || '',
          declared: r2(n(r.declared_amount)), counted: hasCount ? r2(n(r.counted_amount)) : null, variance,
          status: r.status, acceptedBy: r.accepted_by_user_name || '', acceptedAt: r.accepted_at || '',
          account: r.destination_account_id ? accountName(data, r.destination_account_id) : '', notes: r.notes || '',
          _tone: r.status === 'Disputed' || r.status === 'Rejected' ? 'bad' : r.status === 'Pending' ? 'warn' : signedTone(variance),
        };
      });
      const pending = rows.filter(r => r.status === 'Pending');
      return {
        kpis: [
          { key: 'count', label: 'Remittances', value: rows.length, format: 'number' },
          { key: 'declared', label: 'Declared', value: sum(rows, r => n(r.declared)), format: 'money' },
          { key: 'counted', label: 'Counted', value: sum(rows, r => n(r.counted)), format: 'money', tone: 'good' },
          { key: 'variance', label: 'Difference', value: sum(rows, r => n(r.variance)), format: 'money', tone: Math.abs(sum(rows, r => n(r.variance))) > EPS ? 'bad' : 'neutral' },
          { key: 'pending', label: 'Pending', value: sum(pending, r => n(r.declared)), format: 'money', tone: pending.length ? 'warn' : 'good', hint: `${pending.length} not accepted` },
        ],
        charts: [{
          id: 'cashiers', title: 'Declared by cashier', type: 'bar', xKey: 'name', format: 'money', wide: true,
          data: groupSum(rows, r => String(r.cashier), r => n(r.declared)), series: [{ key: 'value', label: 'Declared', color: COLOR.cash }],
        }],
        tables: [{
          id: 'remittances', showTotals: true, sort: { key: 'date', dir: 'desc' },
          columns: [
            { key: 'date', label: 'Declared at', format: 'datetime' },
            { key: 'cashier', label: 'Cashier' },
            { key: 'bag', label: 'Bag / ref', hidden: true },
            { key: 'declared', label: 'Declared', format: 'money', total: true },
            { key: 'counted', label: 'Counted', format: 'money', total: true },
            { key: 'variance', label: 'Difference', format: 'money', total: true, signed: true },
            { key: 'status', label: 'Status', format: 'badge', tones: { Pending: 'warn', Accepted: 'good', Disputed: 'bad', Resolved: 'info', Rejected: 'bad' } },
            { key: 'acceptedBy', label: 'Accepted by' },
            { key: 'acceptedAt', label: 'Accepted at', format: 'datetime', hidden: true },
            { key: 'account', label: 'Into account', hidden: true },
            { key: 'notes', label: 'Notes', wrap: true, hidden: true },
          ],
          rows,
          emptyText: 'No cash was handed over in these dates.',
        }],
      };
    },
  },
];
