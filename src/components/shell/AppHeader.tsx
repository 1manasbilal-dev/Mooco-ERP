import React, { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Home, Lock, LogOut, Menu, Minus, Moon, PanelLeftClose, PanelLeftOpen, Plus, Search, ShieldCheck, Sun } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useSidebarPreference } from '../../hooks/useSidebarPreference';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/Button';
import { Kbd } from '../ui/Field';
import { useStableCallback } from './useStableCallback';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, useZoom, type ThemeMode } from './preferences';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
export const PALETTE_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

export interface AppHeaderProps {
  title: string;
  section?: string;
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onOpenPalette: () => void;
  onHome: () => void;
  /** Sync state pill; the app passes the live SyncStatusBadge, the gallery a sample. */
  status?: React.ReactNode;
  /** The user menu; the app passes the context-connected one, the gallery a sample. */
  userMenu?: React.ReactNode;
}

/** Top bar: navigation toggle, where you are, sync state, quick search, theme and the user menu. */
export const AppHeader = memo(({ title, section, isSidebarOpen, onOpenSidebar, themeMode, onToggleTheme, onOpenPalette, onHome, status, userMenu }: AppHeaderProps) => {
  const [compactSidebar, setCompactSidebar] = useSidebarPreference();
  const isDark = themeMode === 'dark';

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-4 md:h-16 lg:px-6">
      <IconButton
        className="md:hidden"
        aria-label="Open navigation menu"
        aria-expanded={isSidebarOpen}
        aria-controls="mooco-sidebar"
        icon={<Menu />}
        onClick={onOpenSidebar}
      />
      <IconButton
        className="-ml-2 hidden md:inline-flex"
        size="sm"
        aria-label={compactSidebar ? 'Pin sidebar expanded' : 'Use compact sidebar'}
        icon={compactSidebar ? <PanelLeftOpen /> : <PanelLeftClose />}
        onClick={() => setCompactSidebar(!compactSidebar)}
      />

      <div className="flex min-w-0 flex-1 flex-col justify-center md:border-l md:border-line md:pl-3">
        <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-[11px] font-medium leading-4 text-fg-subtle sm:flex">
          <button type="button" onClick={onHome} className="flex shrink-0 cursor-pointer items-center gap-1 rounded transition-colors hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Home size={12} aria-hidden="true" />
            <span>Mooco ERP</span>
          </button>
          {section && (
            <>
              <ChevronRight size={12} className="shrink-0 text-fg-faint" aria-hidden="true" />
              <span className="truncate">{section}</span>
            </>
          )}
        </nav>
        <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight text-fg sm:text-base lg:text-[17px]">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 md:gap-2">
        {status}

        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Quick search"
          aria-keyshortcuts={IS_MAC ? 'Meta+K' : 'Control+K'}
          title={`Quick search (${PALETTE_SHORTCUT})`}
          className={cn(
            'group flex h-10 cursor-pointer items-center gap-2 rounded-control text-fg-subtle transition-[background-color,border-color,color] duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'w-10 justify-center hover:bg-surface-2 hover:text-fg',
            'lg:w-56 lg:justify-start lg:bg-surface-2 lg:px-3 lg:ring-1 lg:ring-inset lg:ring-line lg:hover:ring-line-strong xl:w-64',
          )}
        >
          <Search size={17} className="shrink-0" aria-hidden="true" />
          <span className="hidden flex-1 truncate text-left text-[13px] font-medium lg:inline">Search pages, khata…</span>
          <Kbd className="hidden bg-surface lg:inline-flex">{PALETTE_SHORTCUT}</Kbd>
        </button>

        <IconButton
          className="hidden sm:inline-flex"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-pressed={isDark}
          icon={isDark ? <Sun /> : <Moon />}
          onClick={onToggleTheme}
        />

        {userMenu}
      </div>
    </header>
  );
});
AppHeader.displayName = 'AppHeader';

const initialsOf = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map(word => word[0]).join('') : name.slice(0, 2)).toUpperCase() || 'OW';
};

/** Header user menu wired to the signed-in operator. */
export const HeaderUserMenu: React.FC<{ themeMode: ThemeMode; onToggleTheme: () => void }> = ({ themeMode, onToggleTheme }) => {
  const { currentUser, currentRole, logoutUser, lockTerminalNow, setIsUserSwitcherOpen } = useDairy();
  const onLock = useStableCallback(() => {
    // A real lock: the screen only opens again with a PIN (not with the close button).
    // Offline the PIN cannot be checked, so (like the idle lock) it stays a switcher.
    if (navigator.onLine) lockTerminalNow();
    else setIsUserSwitcherOpen(true);
  });
  const onLogout = useStableCallback(() => logoutUser());
  return (
    <HeaderUserMenuView
      userName={currentUser?.name?.trim() || 'Admin'}
      roleName={currentRole?.name || 'Super Admin'}
      themeMode={themeMode}
      onToggleTheme={onToggleTheme}
      onLock={onLock}
      onLogout={onLogout}
    />
  );
};

export interface HeaderUserMenuViewProps {
  userName: string;
  roleName: string;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onLock: () => void;
  onLogout: () => void;
}

const MENU_ITEM = 'flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 focus-visible:text-fg focus-visible:outline-none [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-subtle';

export const HeaderUserMenuView = memo(({ userName, roleName, themeMode, onToggleTheme, onLock, onLogout }: HeaderUserMenuViewProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const { zoom, setZoom } = useZoom();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initials = initialsOf(userName);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setIsOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') { setIsOpen(false); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`User menu for ${userName}`}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-control p-1 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-surface-2 lg:pr-2"
      >
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-brand-soft text-xs font-bold text-brand-fg ring-1 ring-inset ring-brand/15" aria-hidden="true">{initials}</span>
        <span className="hidden min-w-0 max-w-[120px] text-left lg:block">
          <span className="block truncate text-[13px] font-semibold leading-tight text-fg">{userName}</span>
          <span className="block truncate text-[11px] font-medium leading-tight text-fg-subtle">{roleName}</span>
        </span>
        <ChevronDown size={14} className={cn('hidden text-fg-faint transition-transform duration-150 lg:block', isOpen && 'rotate-180')} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="User options"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-card border border-line bg-surface p-1.5 shadow-e2 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-2" role="presentation">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-xs font-bold text-brand-fg" aria-hidden="true">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-fg">{userName}</p>
              <p className="flex items-center gap-1 truncate text-xs text-fg-subtle"><ShieldCheck size={12} aria-hidden="true" />{roleName}</p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" role="separator" />

          <div className="flex h-10 items-center justify-between gap-2 px-2.5 text-[13px] font-medium text-fg-muted" role="group" aria-label="Screen size">
            <span>Screen size</span>
            <div className="flex items-center gap-1">
              <IconButton size="sm" variant="secondary" role="menuitem" aria-label="Screen chhoti karein" icon={<Minus />} disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(zoom - ZOOM_STEP)} className="size-7" />
              <button
                type="button"
                role="menuitem"
                onClick={() => setZoom(100)}
                title="Reset to 100%"
                className="h-7 w-12 cursor-pointer rounded-md text-center text-xs font-semibold tabular-nums text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {zoom}%
              </button>
              <IconButton size="sm" variant="secondary" role="menuitem" aria-label="Screen bari karein" icon={<Plus />} disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom + ZOOM_STEP)} className="size-7" />
            </div>
          </div>
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={onToggleTheme}>
            {themeMode === 'dark' ? <Sun /> : <Moon />}
            <span className="flex-1">{themeMode === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </button>
          <div className="my-1 h-px bg-line" role="separator" />

          <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => { setIsOpen(false); onLock(); }}>
            <Lock />
            <span>Switch User / Lock</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={cn(MENU_ITEM, 'text-danger-fg hover:bg-danger-soft hover:text-danger-fg focus-visible:bg-danger-soft focus-visible:text-danger-fg [&>svg]:text-danger-fg')}
            onClick={() => { setIsOpen(false); onLogout(); }}
          >
            <LogOut />
            <span>Logout / Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
});
HeaderUserMenuView.displayName = 'HeaderUserMenuView';
