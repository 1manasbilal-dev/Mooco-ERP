import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Windowed rendering for long lists such as ledgers: only the first `pageSize`
 * rows are rendered, and more are added as the sentinel scrolls into view.
 * Printing always gets every row, so printed ledgers stay complete.
 *
 * Pass a `resetKey` (customer id, filter, ...) to jump back to the first page.
 */
export function useProgressiveList<T>(items: T[], pageSize = 60, resetKey?: unknown) {
  const [limit, setLimit] = useState(pageSize);
  const [observed, setObserved] = useState<Element | null>(null);
  const lastKeyRef = useRef(resetKey);

  if (lastKeyRef.current !== resetKey) {
    lastKeyRef.current = resetKey;
    if (limit !== pageSize) setLimit(pageSize);
  }

  const hasMore = items.length > limit;
  const showMore = useCallback(() => setLimit(current => current + pageSize), [pageSize]);
  const showAll = useCallback(() => setLimit(Number.MAX_SAFE_INTEGER), []);

  useEffect(() => {
    if (!observed || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) showMore();
    }, { rootMargin: '800px 0px' });
    observer.observe(observed);
    return () => observer.disconnect();
  }, [observed, hasMore, showMore]);

  useEffect(() => {
    if (!hasMore) return;
    const expandForPrint = () => flushSync(showAll);
    window.addEventListener('beforeprint', expandForPrint);
    return () => window.removeEventListener('beforeprint', expandForPrint);
  }, [hasMore, showAll]);

  return {
    visibleItems: hasMore ? items.slice(0, limit) : items,
    hasMore,
    hiddenCount: Math.max(0, items.length - limit),
    /** Attach to an element placed right after the last rendered row. */
    sentinelRef: setObserved as (element: Element | null) => void,
    showMore,
    showAll,
  };
}
