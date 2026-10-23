import { useCallback, useRef } from 'react';

/**
 * A function whose identity never changes but always calls the latest `fn`.
 * Lets memoised shell pieces take callbacks from the (frequently changing) data context
 * without re-rendering every time a sale or a sync updates it.
 */
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
