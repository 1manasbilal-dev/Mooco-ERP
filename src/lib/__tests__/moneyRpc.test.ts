import { describe, expect, it } from 'vitest';
import { isLostResponse, moneyRpcMessage, requestIdFor, settleRequest } from '../moneyRpc';

describe('money RPC request ids', () => {
  it('reuses the id after a lost response and forgets it after a real answer', () => {
    let n = 0;
    const make = () => `id_${++n}`;
    const first = requestIdFor('return:1', make);
    settleRequest('return:1', { message: 'TypeError: Failed to fetch', code: '' });
    expect(requestIdFor('return:1', make)).toBe(first);
    settleRequest('return:1', { message: 'Bill not found on the server.', code: 'P0001' });
    expect(requestIdFor('return:1', make)).not.toBe(first);
    settleRequest('return:1', null);
    expect(requestIdFor('return:1', make)).toBe('id_3');
  });

  it('keeps separate actions apart', () => {
    const a = requestIdFor('a', () => 'x');
    const b = requestIdFor('b', () => 'y');
    expect([a, b]).toEqual(['x', 'y']);
  });
});

describe('isLostResponse', () => {
  it('treats transport failures as unknown outcome and server answers as definite', () => {
    expect(isLostResponse({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isLostResponse({ name: 'AbortError', message: 'The operation was aborted' })).toBe(true);
    expect(isLostResponse({ message: 'timeout', code: '57014' })).toBe(false);
    expect(isLostResponse({ message: "You don't have permission.", code: '42501' })).toBe(false);
    expect(isLostResponse(null)).toBe(false);
  });
});

describe('moneyRpcMessage', () => {
  it('passes the server reason through', () => {
    expect(moneyRpcMessage({ message: 'Only 3 qty of Milk can be returned.', code: 'P0001' })).toBe('Only 3 qty of Milk can be returned.');
  });

  it('explains a missing database update, a lost session, RLS and a lost response', () => {
    expect(moneyRpcMessage({ code: 'PGRST202', message: 'Could not find the function' })).toMatch(/database update/);
    expect(moneyRpcMessage({ code: 'MOOCO401', message: '' })).toMatch(/sign in/);
    expect(moneyRpcMessage({ code: 'P0001', message: 'Login zaroori hai.' })).toMatch(/^Login required/);
    expect(moneyRpcMessage({ code: 'P0001', message: 'Login required.' })).toMatch(/^Login required/);
    expect(moneyRpcMessage({ code: '42501', message: 'new row violates row-level security policy for table "app_roles"' })).toBe("You don't have permission to do this.");
    expect(moneyRpcMessage({ message: 'Failed to fetch', code: '' })).toMatch(/won't be posted twice/);
    expect(moneyRpcMessage({})).toMatch(/try again/);
  });
});
