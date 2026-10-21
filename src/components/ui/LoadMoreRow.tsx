import React from 'react';

interface LoadMoreRowProps {
  /** From useProgressiveList: loads the next page when it scrolls into view. */
  sentinelRef: (element: Element | null) => void;
  hiddenCount: number;
  onShowMore: () => void;
  onShowAll?: () => void;
  /** Render as a table row (inside <tbody>) with this many columns. */
  colSpan?: number;
}

/** Sentinel + fallback buttons shown after the last rendered row of a long list. */
export const LoadMoreRow: React.FC<LoadMoreRowProps> = ({ sentinelRef, hiddenCount, onShowMore, onShowAll, colSpan }) => {
  if (hiddenCount <= 0) return null;

  const content = (
    <div className="flex flex-wrap items-center justify-center gap-2 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 print:hidden">
      <span>{hiddenCount} aur entries baqi hain</span>
      <button
        type="button"
        onClick={onShowMore}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Aur dikhayein
      </button>
      {onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className="rounded-lg px-3 py-1.5 font-bold text-lime-700 hover:bg-lime-50 dark:text-lime-400 dark:hover:bg-lime-950/40"
        >
          Sab dikhayein
        </button>
      )}
    </div>
  );

  if (colSpan) {
    return (
      <tr ref={sentinelRef} className="print:hidden">
        <td colSpan={colSpan}>{content}</td>
      </tr>
    );
  }
  return <div ref={sentinelRef}>{content}</div>;
};
