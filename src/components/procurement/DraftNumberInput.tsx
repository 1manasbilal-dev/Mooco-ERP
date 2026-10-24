import React, { forwardRef, useState } from 'react';
import { cleanNumber } from '../../lib/formatters';
import { evaluateMathExpression } from '../../lib/mathEvaluator';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  /** Called with every valid number typed, and with the result of "12*50" on Enter or blur. */
  onCommit: (value: number) => void;
  /** Decimals shown when the field is not being edited. */
  decimals?: number;
};

/**
 * A number cell that keeps what is being typed ("", "1.", "12*50") instead of snapping back to the
 * stored number on every key, the way `value={number}` inputs do. Shows the stored number again on blur.
 */
export const DraftNumberInput = forwardRef<HTMLInputElement, Props>(function DraftNumberInput(
  { value, onCommit, decimals = 3, onBlur, onKeyDown, onFocus, ...rest },
  ref,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(cleanNumber(value, decimals)) : '');

  const settle = (text: string) => {
    const result = evaluateMathExpression(text);
    if (result && result.result >= 0) onCommit(cleanNumber(result.result, decimals));
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...rest}
      value={shown}
      onFocus={event => { setDraft(shown); event.target.select(); onFocus?.(event); }}
      onChange={event => {
        const text = event.target.value;
        setDraft(text);
        const result = evaluateMathExpression(text);
        if (result && !result.isExpression && result.result >= 0) onCommit(result.result);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && draft !== null) {
          settle(draft);
          const result = evaluateMathExpression(draft);
          if (result?.isExpression) setDraft(String(cleanNumber(result.result, decimals)));
        }
        onKeyDown?.(event);
      }}
      onBlur={event => {
        if (draft !== null) settle(draft);
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
});
