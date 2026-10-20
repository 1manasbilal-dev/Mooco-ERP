import { useEffect, useRef } from 'react';
import { useDairy } from '../context/DairyContext';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Locks the terminal after the owner's idle limit (Settings → Security). Unlocking needs a PIN,
 * which is checked online, so an offline terminal is never locked out of its own counter.
 */
export function useIdleLock() {
  const { settings, currentUser, isUserSwitcherOpen, lockTerminalNow } = useDairy();
  const minutes = Number(settings.security?.autoLockMinutes) || 0;
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!minutes || !currentUser) return;
    lastActivity.current = Date.now();
    const markActive = () => { lastActivity.current = Date.now(); };
    ACTIVITY_EVENTS.forEach(name => window.addEventListener(name, markActive, { passive: true }));
    const timer = window.setInterval(() => {
      if (isUserSwitcherOpen || !navigator.onLine) return;
      if (Date.now() - lastActivity.current >= minutes * 60_000) lockTerminalNow();
    }, 15_000);
    return () => {
      ACTIVITY_EVENTS.forEach(name => window.removeEventListener(name, markActive));
      window.clearInterval(timer);
    };
  }, [minutes, currentUser?.id, isUserSwitcherOpen]);
}
