import { useCallback, useMemo } from 'react';
import { useDairy } from '../../context/DairyContext';
import { useManagerApproval } from '../ui/ManagerApproval';
import type { CashVariance } from '../../types';
import { formatCurrency } from '../../lib/formatters';

/**
 * Separation of duties for cash differences: a manager may not sign off a difference in their own
 * drawer custody. Another manager or the Owner confirms with their PIN; the Owner is exempt, as on
 * the shift-close screen. Render `approvalDialog` once.
 */
export function useVarianceGuard() {
  const { currentUser, shiftSessions } = useDairy();
  const { requestApproval, approvalDialog } = useManagerApproval();
  const shiftOwner = useMemo(() => new Map(shiftSessions.map(shift => [shift.id, shift.user_id])), [shiftSessions]);

  /** The note to record (with the second approver's name when one was needed), or null if cancelled. */
  const confirmNote = useCallback(async (variance: CashVariance, note: string): Promise<string | null> => {
    const custodian = (variance.shift_id ? shiftOwner.get(variance.shift_id) : undefined) || variance.reported_by;
    const ownDifference = Boolean(currentUser && custodian && custodian === currentUser.id);
    if (!ownDifference || currentUser?.role_id === 'role_super_admin') return note;
    const approver = await requestApproval({
      permission: 'cash_control:approve',
      title: "You can't approve your own difference",
      reason: `${variance.variance_type}: ${formatCurrency(variance.variance)} — another manager's or the Owner's PIN is needed.`,
    });
    return approver ? `${note} (approved by ${approver} via PIN)` : null;
  }, [currentUser, shiftOwner, requestApproval]);

  return { confirmNote, approvalDialog };
}
