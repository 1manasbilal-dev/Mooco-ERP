import { describe, expect, it } from 'vitest';
import { ALL_ACTION_KEYS, ALL_PERMISSION_MODULES, PERMISSION_GROUPS, actionKey, expandPermissions } from '../permissions';

describe('permission catalogue', () => {
  it('has unique module ids and unique action keys', () => {
    const ids = ALL_PERMISSION_MODULES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ALL_ACTION_KEYS).size).toBe(ALL_ACTION_KEYS.length);
    expect(ALL_ACTION_KEYS).toContain('cash_control:reopen');
    expect(ALL_ACTION_KEYS).toContain('user_management:manage');
  });

  it('builds action keys as module:action', () => {
    expect(actionKey('pos', 'create')).toBe('pos:create');
    expect(PERMISSION_GROUPS.every(g => g.modules.length > 0)).toBe(true);
  });
});

describe('expandPermissions', () => {
  it('expands a whole-module grant into every action of that module only', () => {
    const perms = expandPermissions(['pos']);
    expect([...perms].sort()).toEqual(['pos:create', 'pos:discount', 'pos:view']);
    expect(perms.has('cash_control:approve')).toBe(false);
  });

  it('keeps single actions as they are', () => {
    expect([...expandPermissions(['sales_history:view', 'customers:payment'])]).toEqual(['sales_history:view', 'customers:payment']);
  });

  it('maps the legacy retail_stock grant to viewing cash control only', () => {
    const perms = expandPermissions(['retail_stock']);
    expect([...perms]).toEqual(['cash_control:view']);
    expect(perms.has('cash_control:approve')).toBe(false);
    expect(perms.has('cash_control:reopen')).toBe(false);
  });

  it('never turns a single action into the full module', () => {
    const perms = expandPermissions(['cash_control:view']);
    expect(perms.has('cash_control:reopen')).toBe(false);
    expect(perms.has('user_management:manage')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(expandPermissions([]).size).toBe(0);
  });
});
