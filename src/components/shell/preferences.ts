import { useCallback, useEffect, useRef, useState } from 'react';

// Per-device shell preferences. index.html applies both before first paint; these hooks keep them in sync afterwards.

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'app_theme';
const ZOOM_KEY = 'app_zoom_scale';
/** Browser / PWA chrome colour: the canvas token for each theme (src/styles/tokens.css). */
const THEME_COLOR: Record<ThemeMode, string> = { light: '#f5f7fa', dark: '#080b12' };

export const ZOOM_MIN = 80;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 10;

const readStorage = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStorage = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch {}
};

const systemTheme = (): ThemeMode => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const readTheme = (): ThemeMode => {
  const saved = readStorage(THEME_KEY);
  return saved === 'dark' || saved === 'light' ? saved : systemTheme();
};

const applyTheme = (mode: ThemeMode) => {
  const root = document.documentElement;
  // Swap colours in one frame: without this every element with a colour transition animates at once.
  root.classList.add('theme-switching');
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[mode];
  // Apply the new colours now (forced style pass), then let transitions run again.
  // A timer, not requestAnimationFrame: rAF never fires while the tab is in the background.
  void window.getComputedStyle(document.body).backgroundColor;
  window.setTimeout(() => root.classList.remove('theme-switching'), 0);
};

/** Light / dark mode: saved choice first, otherwise the system setting (followed live until the user picks one). */
export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readTheme);
  const themeRef = useRef(themeMode);
  themeRef.current = themeMode;

  useEffect(() => { applyTheme(themeMode); }, [themeMode]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => { if (!readStorage(THEME_KEY)) setThemeMode(systemTheme()); };
    // Another window of the app changed the theme.
    const onStorage = (event: StorageEvent) => { if (event.key === THEME_KEY) setThemeMode(readTheme()); };
    query.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      query.removeEventListener('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = themeRef.current === 'light' ? 'dark' : 'light';
    writeStorage(THEME_KEY, next);
    setThemeMode(next);
  }, []);

  return { themeMode, toggleTheme };
}

const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));

const readZoom = () => {
  const saved = Number(readStorage(ZOOM_KEY));
  // Older builds allowed up to 250%; bring those back into the range the control can reach.
  return Number.isFinite(saved) && saved > 0 ? clampZoom(saved) : 100;
};

/** Screen size (root font size) for this device: a POS touch screen and an office laptop want different sizes. */
export function useZoom() {
  const [zoom, setZoomState] = useState(readZoom);

  useEffect(() => {
    document.documentElement.style.fontSize = zoom === 100 ? '' : `${(zoom / 100) * 16}px`;
    if (zoom === 100) {
      try { localStorage.removeItem(ZOOM_KEY); } catch {}
    } else {
      writeStorage(ZOOM_KEY, String(zoom));
    }
  }, [zoom]);

  const setZoom = useCallback((value: number) => setZoomState(clampZoom(value)), []);
  return { zoom, setZoom };
}
