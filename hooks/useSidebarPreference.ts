import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'app_sidebar_auto_collapse';
const CHANGE_EVENT = 'mooco-sidebar-preference';
const readPreference = () => localStorage.getItem(STORAGE_KEY) === 'true';

/** Keep the sidebar control and the existing Settings preference in sync. */
export function useSidebarPreference() {
  const [compact, setCompact] = useState(readPreference);
  useEffect(() => {
    const update = () => setCompact(readPreference());
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) update(); };
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const updatePreference = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(value));
    setCompact(value);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [compact, updatePreference] as const;
}
