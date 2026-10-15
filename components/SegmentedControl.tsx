import React from 'react';

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
  fullWidth = true
}) => {
  const sizeClasses = {
    sm: 'py-1 px-2 text-[11px]',
    md: 'py-1.5 px-3 text-xs',
    lg: 'py-2 px-3.5 text-sm font-bold'
  };

  return (
    <div className={`p-1 bg-slate-100 rounded-xl border border-slate-200 flex gap-1 ${fullWidth ? 'w-full' : 'inline-flex'} ${className}`}>
      {options.map(option => {
        const isSelected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all shadow-2xs ${
              sizeClasses[size]
            } ${
              isSelected
                ? 'bg-white text-lime-900 font-bold shadow-xs ring-1 ring-lime-600/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            {option.icon && (
              <span className={`shrink-0 ${isSelected ? 'text-lime-700' : 'text-slate-400'}`}>
                {option.icon}
              </span>
            )}
            <span className="truncate">{option.label}</span>
            {option.badge && (
              <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full font-bold ml-0.5">
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
