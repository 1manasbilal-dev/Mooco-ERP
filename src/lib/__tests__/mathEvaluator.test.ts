import { describe, expect, it } from 'vitest';
import { evaluateMathExpression } from '../mathEvaluator';

const value = (input: string) => evaluateMathExpression(input)?.result;

describe('evaluateMathExpression', () => {
  it('reads plain numbers, with thousand separators and spaces', () => {
    expect(evaluateMathExpression('5000')).toEqual({ result: 5000, isExpression: false });
    expect(evaluateMathExpression('5,000')).toEqual({ result: 5000, isExpression: false });
    expect(evaluateMathExpression(' 12.5 ')).toEqual({ result: 12.5, isExpression: false });
    expect(evaluateMathExpression('.5')).toEqual({ result: 0.5, isExpression: false });
    expect(evaluateMathExpression(250)).toEqual({ result: 250, isExpression: false });
  });

  it('rejects number syntaxes a cashier never means', () => {
    expect(evaluateMathExpression('0b11')).toBeNull();
    expect(evaluateMathExpression('0o7')).toBeNull();
    expect(evaluateMathExpression('1e5')).toBeNull();
    expect(evaluateMathExpression('Infinity')).toBeNull();
    expect(evaluateMathExpression('1.2.3')).toBeNull();
    expect(evaluateMathExpression('.')).toBeNull();
    expect(evaluateMathExpression('abc')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(evaluateMathExpression('')).toBeNull();
    expect(evaluateMathExpression('   ')).toBeNull();
    expect(evaluateMathExpression(null)).toBeNull();
    expect(evaluateMathExpression(undefined)).toBeNull();
  });

  it('follows operator precedence and parentheses', () => {
    expect(evaluateMathExpression('5000+3260')).toEqual({ result: 8260, isExpression: true });
    expect(value('2+3*4')).toBe(14);
    expect(value('(2+3)*4')).toBe(20);
    expect(value('10-4-3')).toBe(3);
    expect(value('100/4/5')).toBe(5);
    expect(value('2x150')).toBe(300);
    expect(value('2X150')).toBe(300);
    expect(value('2×150')).toBe(300);
    expect(value('300÷4')).toBe(75);
    expect(value('1,500 + 2,500')).toBe(4000);
  });

  it('handles unary signs', () => {
    expect(value('-5')).toBe(-5);
    expect(evaluateMathExpression('-5')?.isExpression).toBe(true);
    expect(value('2*-3')).toBe(-6);
    expect(value('2--3')).toBe(5);
    expect(value('(-2)*3')).toBe(-6);
    expect(value('+5+1')).toBe(6);
  });

  it('ignores one trailing operator while typing', () => {
    expect(value('500+')).toBe(500);
    expect(value('500*')).toBe(500);
  });

  it('rejects malformed expressions and division by zero', () => {
    expect(evaluateMathExpression('5/0')).toBeNull();
    expect(evaluateMathExpression('5/(2-2)')).toBeNull();
    expect(evaluateMathExpression('(5+3')).toBeNull();
    expect(evaluateMathExpression('5+3)')).toBeNull();
    expect(evaluateMathExpression('5(3)')).toBeNull();
    expect(evaluateMathExpression('--5')).toBeNull();
    expect(evaluateMathExpression('+')).toBeNull();
    expect(evaluateMathExpression('-(2+3)')).toBeNull();
    expect(evaluateMathExpression('5+.')).toBeNull();
  });

  it('never executes code', () => {
    expect(evaluateMathExpression('alert(1)')).toBeNull();
    expect(evaluateMathExpression('constructor.constructor("return 1")()')).toBeNull();
    expect(evaluateMathExpression('1+process.exit()')).toBeNull();
    expect(evaluateMathExpression('2**10')).toBeNull();
  });

  it('cleans float noise to four decimals without negative zero', () => {
    expect(value('0.1+0.2')).toBe(0.3);
    expect(value('10/3')).toBe(3.3333);
    expect(value('1.00005*1')).toBe(1.0001);
    expect(Object.is(value('0.00001-0.00002'), 0)).toBe(true);
  });

  it('rejects results that overflow', () => {
    expect(evaluateMathExpression(`${'9'.repeat(200)}*${'9'.repeat(200)}`)).toBeNull();
  });
});
