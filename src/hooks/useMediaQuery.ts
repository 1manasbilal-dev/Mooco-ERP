import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind breakpoints, kept in one place so JS and CSS agree. */
export const BREAKPOINTS = {
  sm: '(min-width: 640px)',
  md: '(min-width: 768px)',
  lg: '(min-width: 1024px)',
} as const;

const getQueryList = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/**
 * Live result of a CSS media query. Use it to render only the layout for the
 * current screen instead of rendering mobile and desktop markup and hiding one.
 */
export const useMediaQuery = (query: string): boolean => {
  // One subscription per query: an inline subscribe made React unsubscribe and resubscribe the
  // listener on every render of the component.
  const subscribe = useCallback((onChange: () => void) => {
    const list = getQueryList(query);
    list?.addEventListener('change', onChange);
    return () => list?.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => getQueryList(query)?.matches ?? true,
    () => true,
  );
};
