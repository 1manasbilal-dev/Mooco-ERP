import React from 'react';
import { Button } from './Button';

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
    <div className="flex flex-wrap items-center justify-center gap-2 py-3 text-xs font-medium text-fg-subtle print:hidden">
      <span className="tabular-nums">{hiddenCount} aur entries baqi hain</span>
      <Button variant="secondary" size="sm" onClick={onShowMore}>Aur dikhayein</Button>
      {onShowAll && <Button variant="ghost" size="sm" onClick={onShowAll} className="text-brand-fg hover:bg-brand-soft hover:text-brand-fg">Sab dikhayein</Button>}
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
