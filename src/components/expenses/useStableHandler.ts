import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but always runs the latest `handler`.
 * Lets memoised rows take handlers from a parent that re-creates them every render.
 */
export function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
