/**
 * Safely parses and calculates expressions with +, -, *, /, x, X, and parentheses.
 * Does not use eval().
 */
import { cleanNumber } from './formatters';

export interface MathEvalResult {
  result: number;
  isExpression: boolean;
}

export function evaluateMathExpression(input: string | number | null | undefined): MathEvalResult | null {
  if (input === null || input === undefined) return null;
  const str = String(input).trim();
  if (!str) return null;

  // Clean input: normalize operators, remove thousand commas, and strip whitespace
  const expr = str
    .replace(/[xX×]/g, '*')
    .replace(/[÷\\]/g, '/')
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  if (!expr) return null;

  const hasOperator = /[+\-*/]/.test(expr);
  if (!hasOperator) {
    // Plain decimal digits only: Number() would also read "0b11" as 3, "0o7" as 7 and "1e5" as 100000.
    if (!/^(\d+\.?\d*|\.\d+)$/.test(expr)) return null;
    const num = Number(expr);
    return !Number.isFinite(num) ? null : { result: num, isExpression: false };
  }

  if (!/^[0-9.+\-*/()]+$/.test(expr)) {
    return null;
  }

  const tokens: (number | string)[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];

    if ('+-*/()'.includes(ch)) {
      // '-' or '+' is unary at the start or right after another operator or '('
      if ((ch === '-' || ch === '+') && (i === 0 || '+-*/('.includes(expr[i - 1]))) {
        let numStr = ch;
        i++;
        while (i < expr.length && /[0-9.]/.test(expr[i])) {
          numStr += expr[i];
          i++;
        }
        if (numStr === '-' || numStr === '+') return null; // Trailing operator
        // Number(), not parseFloat(): "1.2.3" is a typo, not 1.2.
        const n = Number(numStr);
        if (isNaN(n)) return null;
        tokens.push(n);
        continue;
      }
      tokens.push(ch);
      i++;
    } else if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        numStr += expr[i];
        i++;
      }
      const n = Number(numStr);
      if (isNaN(n)) return null;
      tokens.push(n);
    } else {
      return null;
    }
  }

  if (tokens.length === 0) return null;

  // Allow a trailing operator while the user is still typing (e.g. "500+")
  const lastToken = tokens[tokens.length - 1];
  if (typeof lastToken === 'string' && '+-*/'.includes(lastToken)) {
    tokens.pop();
    if (tokens.length === 0) return null;
  }

  // Shunting-yard algorithm to convert infix tokens to postfix (RPN)
  const outputQueue: (number | string)[] = [];
  const operatorStack: string[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

  for (const token of tokens) {
    if (typeof token === 'number') {
      outputQueue.push(token);
    } else if (typeof token === 'string' && '+-*/'.includes(token)) {
      while (
        operatorStack.length > 0 &&
        operatorStack[operatorStack.length - 1] !== '(' &&
        precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
      ) {
        outputQueue.push(operatorStack.pop()!);
      }
      operatorStack.push(token);
    } else if (token === '(') {
      operatorStack.push(token);
    } else if (token === ')') {
      while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
        outputQueue.push(operatorStack.pop()!);
      }
      if (operatorStack.length === 0) return null; // Mismatched parentheses
      operatorStack.pop();
    }
  }

  while (operatorStack.length > 0) {
    const op = operatorStack.pop()!;
    if (op === '(' || op === ')') return null; // Mismatched parentheses
    outputQueue.push(op);
  }

  const evalStack: number[] = [];
  for (const token of outputQueue) {
    if (typeof token === 'number') {
      evalStack.push(token);
    } else if (typeof token === 'string' && '+-*/'.includes(token)) {
      if (evalStack.length < 2) return null;
      const b = evalStack.pop()!;
      const a = evalStack.pop()!;
      let res: number;
      switch (token) {
        case '+': res = a + b; break;
        case '-': res = a - b; break;
        case '*': res = a * b; break;
        case '/':
          if (b === 0) return null;
          res = a / b;
          break;
        default:
          return null;
      }
      evalStack.push(res);
    }
  }

  if (evalStack.length !== 1 || !isFinite(evalStack[0])) return null;

  // Clean IEEE 754 floating point precision issues (e.g. 0.1 + 0.2 = 0.30000000000000004)
  const finalResult = cleanNumber(evalStack[0], 4);

  return {
    result: finalResult,
    isExpression: true
  };
}
