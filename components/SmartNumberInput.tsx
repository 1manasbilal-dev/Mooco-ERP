import React, { useState, useEffect, useRef } from 'react';
import { evaluateMathExpression } from '../lib/mathEvaluator';
import { Calculator, Check } from 'lucide-react';

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

  // Sync when external value changes and not currently holding an active user expression or focused typing
  useEffect(() => {
    const stringVal = value !== undefined && value !== null ? String(value) : '';
    if (isFocusedRef.current) {
      const evalRes = evaluateMathExpression(internalText);
      if (evalRes?.isExpression) return;
      if (internalText === stringVal) return;
      if (Number(internalText) === Number(stringVal) && !isNaN(Number(internalText)) && !isNaN(Number(stringVal))) {
        return;
      }
    }
    setInternalText(stringVal);
  }, [value]);

  // Live evaluation of the current input
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
      onChange(val);
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
        <span className="absolute left-3 text-xs font-black text-slate-400 select-none pointer-events-none z-10">
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

      {/* Floating calculation preview badge */}
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
          className="absolute right-2 px-2 py-0.5 rounded-lg bg-lime-500 hover:bg-lime-400 active:scale-95 text-slate-950 font-mono font-black text-[11px] flex items-center gap-1 shadow-xs transition-all cursor-pointer z-10 animate-in fade-in zoom-in-95 duration-100"
          title="Click or press Enter to calculate"
        >
          <span className="text-[10px] text-slate-800 font-bold">=</span>
          <span>{evalResult.result.toLocaleString('en-PK')}</span>
          <span className="text-[9px] opacity-75 font-sans font-bold">↵</span>
        </button>
      )}
    </div>
  );
};
