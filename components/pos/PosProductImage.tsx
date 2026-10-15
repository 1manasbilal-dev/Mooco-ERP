import React, { useState } from 'react';
import { Package } from 'lucide-react';

export interface PosProductImageProps {
  name: string;
  imageUrl?: string;
  className?: string;
  isAvailable?: boolean;
  children?: React.ReactNode;
}

export const PosProductImage: React.FC<PosProductImageProps> = ({ 
  name, 
  imageUrl, 
  className = '', 
  isAvailable = true,
  children 
}) => {
  const [failedSrc, setFailedSrc] = useState<string>();
  const activeSrc = imageUrl || undefined;

  return (
    <div className={`relative w-full aspect-square overflow-hidden rounded-xl bg-slate-50 dark:bg-slate-800/80 mb-2.5 shrink-0 flex items-center justify-center border border-slate-100 dark:border-slate-800/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      {activeSrc && failedSrc !== activeSrc ? (
        <img
          src={activeSrc}
          alt={name}
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(activeSrc)}
          className={`w-full h-full object-cover mix-blend-multiply dark:mix-blend-normal transition-transform duration-300 ease-out group-hover:scale-105 ${
            !isAvailable ? 'grayscale-[35%] opacity-75' : ''
          }`}
        />
      ) : (
        <div aria-hidden="true" className="flex flex-col h-full w-full items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500 p-2 bg-gradient-to-b from-slate-50 to-slate-100/80 dark:from-slate-800 dark:to-slate-800/50">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-700/60 shadow-xs flex items-center justify-center text-slate-400 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
            <Package size={22} strokeWidth={1.5} />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {name.trim().slice(0, 3)}
          </span>
        </div>
      )}
      {children}
    </div>
  );
};
