import React, { memo } from 'react';
import { ChevronRight, FileText, Lock, PlusCircle, Power, Trash2 } from 'lucide-react';
import { Badge, IconButton, Money, Skeleton, TBody, TD, TH, THead, TR, Table, TableContainer } from '../ui';
import { cn } from '../../lib/cn';
import { useMediaQuery, BREAKPOINTS } from '../../hooks/useMediaQuery';
import { balanceSide, type COANode, type FlatCoaRow } from './coa';

export interface CoaRowActions {
  onToggle: (id: string) => void;
  onAddSub: (node: COANode) => void;
  onToggleActive: (node: COANode) => void;
  onDelete: (node: COANode) => void;
}

interface CoaRowProps extends CoaRowActions, FlatCoaRow {
  canManage: boolean;
  busy: boolean;
  /** Indent per tree level, in px (smaller on phones). */
  indentStep: number;
}

/** Groups and manual accounts can take sub-accounts; system leaf accounts cannot. */
export const canAddChild = (node: COANode) => node.isGroup || !node.isSystem || node.id === 'inc_sales_group';

const CoaRow = memo(function CoaRow({ node, level, hasChildren, expanded, canManage, busy, indentStep, onToggle, onAddSub, onToggleActive, onDelete }: CoaRowProps) {
  const isRoot = level === 0;
  const inactive = node.isActive === false;
  const side = balanceSide(node.type, node.balance);
  const Icon = node.icon || FileText;
  const balance = (
    <>
      <Money amount={Math.abs(node.balance)} className={inactive ? 'text-fg-subtle' : 'text-fg'} />
      <span className={cn('ml-1.5 inline-block w-5 text-left text-[10px] font-bold', side === 'Cr' ? 'text-info-fg' : 'text-fg-subtle')}>
        {side ?? ''}
      </span>
    </>
  );

  const badges = (
    <>
      {!node.isSystem && !node.isGroup && <Badge tone="info" className="h-5 px-2 text-[10px]">Manual</Badge>}
      {inactive && <Badge tone="neutral" className="h-5 px-2 text-[10px]">Inactive</Badge>}
    </>
  );

  return (
    <TR className={cn(isRoot && 'bg-surface-2/70', !isRoot && 'hover:bg-surface-2/50')}>
      <TD className={cn('w-full max-w-0 sm:min-w-[15rem]', isRoot ? 'py-2.5' : 'py-2')}>
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${level * indentStep}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')} aria-hidden="true" />
            </button>
          ) : (
            <span className="w-6 shrink-0" aria-hidden="true" />
          )}
          {node.code && (
            <span
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ring-1 ring-inset',
                isRoot ? 'bg-brand-soft text-brand-fg ring-brand/20' : 'hidden bg-surface-2 text-fg-subtle ring-line sm:inline',
              )}
            >
              {node.code}
            </span>
          )}
          {!isRoot && !node.isGroup && (
            <Icon className={cn('size-4 shrink-0', node.isSystem ? 'text-fg-faint' : 'text-info-fg')} aria-hidden="true" />
          )}
          <span
            className={cn(
              'min-w-0 truncate',
              isRoot ? 'text-xs font-bold uppercase tracking-wider text-fg'
              : node.isGroup || level === 1 ? 'text-sm font-semibold text-fg'
              : 'text-sm text-fg-muted',
              inactive && 'text-fg-subtle line-through decoration-fg-faint/60',
            )}
            title={node.sourceModule ? `${node.name} · ${node.sourceModule}` : node.name}
          >
            {node.name}
          </span>
          <span className="hidden shrink-0 gap-1.5 sm:flex">{badges}</span>
        </div>
        {/* Phones: balance and badges sit under the name so name, balance and actions all fit on screen. */}
        <div
          className={cn('mt-0.5 flex items-center gap-1.5 whitespace-nowrap sm:hidden', isRoot ? 'text-sm font-bold' : 'text-[13px] font-semibold')}
          style={{ paddingLeft: `${level * indentStep + 32}px` }}
        >
          <span>{balance}</span>
          {badges}
        </div>
      </TD>
      <TD numeric className={cn('hidden whitespace-nowrap sm:table-cell', isRoot ? 'text-[15px] font-bold' : 'text-sm')}>
        {balance}
      </TD>
      {canManage && (
        <TD className="w-[7.5rem] py-1.5">
          {!isRoot && (
            <div className="flex items-center justify-end gap-0.5">
              {canAddChild(node) && (
                <IconButton size="sm" aria-label="Add sub-account" icon={<PlusCircle />} onClick={() => onAddSub(node)} className="hover:text-success-fg" />
              )}
              {!node.isSystem && (
                <IconButton
                  size="sm"
                  aria-label={inactive ? 'Make Active' : 'Make Inactive'}
                  icon={<Power />}
                  disabled={busy}
                  onClick={() => onToggleActive(node)}
                  className={inactive ? 'bg-warning-soft text-warning-fg' : 'hover:text-warning-fg'}
                />
              )}
              {node.isSystem ? (
                <span title="System control account: the app keeps its balance itself" className="flex size-8 items-center justify-center text-fg-faint">
                  <Lock className="size-3.5" aria-label="System account" />
                </span>
              ) : (
                <IconButton
                  size="sm"
                  aria-label="Delete account"
                  icon={<Trash2 />}
                  disabled={busy}
                  onClick={() => onDelete(node)}
                  className="hover:bg-danger-soft hover:text-danger-fg"
                />
              )}
            </div>
          )}
        </TD>
      )}
    </TR>
  );
});

interface CoaTableProps extends CoaRowActions {
  rows: FlatCoaRow[];
  canManage: boolean;
  busyId: string | null;
  loading?: boolean;
  empty: React.ReactNode;
}

/** Chart of accounts as an indented tree table. Rows are memoised, so expanding one group re-renders only the rows that change. */
export function CoaTable({ rows, canManage, busyId, loading, empty, ...actions }: CoaTableProps) {
  const indentStep = useMediaQuery(BREAKPOINTS.sm) ? 18 : 10;
  if (loading) {
    return (
      <TableContainer aria-busy="true">
        <div className="divide-y divide-line">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="h-4 w-10" />
              <Skeleton className={cn('h-4', i % 3 === 0 ? 'w-40' : 'w-56')} />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      </TableContainer>
    );
  }
  if (rows.length === 0) return <TableContainer>{empty}</TableContainer>;

  return (
    <TableContainer>
      <Table>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH numeric className="hidden w-44 sm:table-cell">Balance</TH>
            {canManage && <TH className="w-[7.5rem] text-right"><span className="sr-only sm:not-sr-only">Actions</span></TH>}
          </tr>
        </THead>
        <TBody>
          {rows.map(row => (
            <CoaRow key={row.node.id} {...row} canManage={canManage} busy={busyId === row.node.id} indentStep={indentStep} {...actions} />
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}
