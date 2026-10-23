import { useEffect, useState, type RefObject } from 'react';

/**
 * The current time, refreshed on each new minute while the dashboard is on screen.
 * Without it "Today" stayed on the old day after midnight until some record changed,
 * and the same-time comparison and greeting never moved on.
 */
export function useDashboardClock(rootRef: RefObject<HTMLElement | null>): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Kept-alive pages stay mounted while hidden; WorkspacePane marks them data-active="false".
    const pane = rootRef.current?.closest('[data-active]') ?? null;
    const onScreen = () => document.visibilityState === 'visible' && pane?.getAttribute('data-active') !== 'false';
    const refresh = () => { if (onScreen()) setNow(new Date()); };

    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => { refresh(); schedule(); }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    document.addEventListener('visibilitychange', refresh);
    // A page shown again after a while catches up at once instead of on the next minute.
    const observer = pane ? new MutationObserver(refresh) : null;
    if (pane) observer?.observe(pane, { attributes: true, attributeFilter: ['data-active'] });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      observer?.disconnect();
    };
  }, [rootRef]);

  return now;
}
