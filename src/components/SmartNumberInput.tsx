import React, { useState, useEffect, useRef } from 'react';
import { evaluateMathExpression } from '../lib/mathEvaluator';

export interface SmartNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string | number;
  onChange: (value: string) => void;
  onEvaluate?: (result: number) => void;
  prefixText?: string;
  allowNegative?: boolean;
  wrapperClassName?: string;
}

export const SmartNumberInput: React.FC<SmartNumberInputProps> = ({
  value,
  onChange,
  onEvaluate,
  prefixText,
  allowNegative = false,
  wrapperClassName = 'w-full',
  className = '',
  placeholder,
  disabled,
  readOnly,
  onKeyDown,
  onBlur,
  onFocus,
  ...rest
}) => {
  const [internalText, setInternalText] = useState<string>(value !== undefined && value !== null ? String(value) : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  // Sync from the external value unless the user is typing or holding an unevaluated expression
  useEffect(() => {
    const stringVal = value !== undefined && value !== null ? String(value) : '';
    if (isFocusedRef.current) {
      const evalRes = evaluateMathExpression(internalText);
      if (evalRes?.isExpression) return;
      if (internalText === stringVal) return;
      // Keep "1,000" on screen while the parent holds 1000.
      if (evalRes && stringVal !== '' && evalRes.result === Number(stringVal)) return;
      if (Number(internalText) === Number(stringVal) && !isNaN(Number(internalText)) && !isNaN(Number(stringVal))) {
        return;
      }
    }
    setInternalText(stringVal);
  }, [value]);

  const evalResult = evaluateMathExpression(internalText);
  const showBadge = Boolean(evalResult?.isExpression && evalResult?.result !== undefined);

  const applyEvaluation = () => {
    if (evalResult?.isExpression && evalResult.result !== undefined) {
      let finalNum = evalResult.result;
      if (!allowNegative && finalNum < 0) finalNum = 0;
      const finalStr = String(finalNum);
      setInternalText(finalStr);
      onChange(finalStr);
      if (onEvaluate) onEvaluate(finalNum);
      return true;
    }
    return false;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setInternalText(val);

    const evalRes = evaluateMathExpression(val);
    if (!evalRes?.isExpression) {
      // "1,000" goes up as 1000: parents read it with parseFloat (gives 1) or Number (gives NaN).
      onChange(evalRes && /[,\s]/.test(val) ? String(evalRes.result) : val);
    }

    // Preserve cursor position across parent re-renders
    if (cursor !== null) {
      requestAnimationFrame(() => {
        if (inputRef.current && document.activeElement === inputRef.current) {
          inputRef.current.setSelectionRange(cursor, cursor);
        }
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (applyEvaluation()) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    if (onKeyDown) onKeyDown(e);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    applyEvaluation();
    if (onBlur) onBlur(e);
  };

  return (
    <div className={`relative flex items-center ${wrapperClassName}`}>
      {prefixText && (
        <span className="pointer-events-none absolute left-3 z-10 select-none text-xs font-bold text-fg-faint">
          {prefixText}
        </span>
      )}

      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        value={internalText}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`${className} ${prefixText ? 'pl-9' : ''} ${showBadge ? 'pr-24' : ''}`}
        {...rest}
      />

      {showBadge && evalResult && (
        <button
          type="button"
          tabIndex={-1}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            applyEvaluation();
            inputRef.current?.focus();
          }}
          className="absolute right-2 z-10 flex cursor-pointer items-center gap-1 rounded-lg bg-brand px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-brand-on shadow-e1 transition-[background-color,transform] duration-100 hover:bg-brand-hover active:scale-95 animate-in fade-in zoom-in-95"
          title="Click or press Enter to calculate"
          aria-label={`Calculate: ${evalResult.result.toLocaleString('en-PK')}`}
        >
          <span className="text-[10px] font-bold opacity-80" aria-hidden="true">=</span>
          <span>{evalResult.result.toLocaleString('en-PK')}</span>
          <span className="font-sans text-[9px] font-bold opacity-75" aria-hidden="true">↵</span>
        </button>
      )}
    </div>
  );
};
