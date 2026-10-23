export type CashTab = 'head' | 'days' | 'audit' | 'drawers';

export const CASH_TABS: CashTab[] = ['head', 'days', 'audit', 'drawers'];

export const isCashTab = (value: unknown): value is CashTab => CASH_TABS.includes(value as CashTab);
