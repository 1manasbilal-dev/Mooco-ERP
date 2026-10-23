import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronLeft, Delete, Keyboard, KeyRound, Lock, LogIn, User, X } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import type { AppUser } from '../types';
import { cn } from '../lib/cn';
import { Button, IconButton } from './ui/Button';
import { Field, Input } from './ui/Field';
import { useStableCallback } from './shell/useStableCallback';

type LoginResult = { success: boolean; message?: string; user?: AppUser };

/** Lock screen / operator switcher, wired to the session. Mounted only while it is open. */
const UserSwitcherModal: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentUser, users, roles, isUserSwitcherOpen, isTerminalLocked,
    setIsUserSwitcherOpen, loginWithCredentials, switchUserByIdAndPin
  } = useDairy();
  const { showToast } = useToast();
  const activeUsers = useMemo(() => users.filter(u => u.is_active !== false), [users]);
  const roleNames = useMemo(() => Object.fromEntries(roles.map(role => [role.id, role.name])), [roles]);

  const onSuccess = useStableCallback((user: AppUser) => {
    showToast(`Welcome, ${user.name}!`, 'success');
    setIsUserSwitcherOpen(false);
    if (user.role_id === 'role_cashier') {
      // Delay so the previous page's ProtectedRoute redirect (fired by the
      // currentUser change) commits first — then Cash Control wins the race.
      setTimeout(() => navigate('/cash-control'), 120);
    }
  });
  const onClose = useStableCallback(() => setIsUserSwitcherOpen(false));
  const verifyPin = useStableCallback((userId: string, pin: string) => switchUserByIdAndPin(userId, pin));
  const verifyCredentials = useStableCallback((username: string, pin: string) => loginWithCredentials(username, pin));

  if (!isUserSwitcherOpen) return null;
  return (
    <LockScreen
      users={activeUsers}
      roleNames={roleNames}
      defaultUsername={currentUser?.username || ''}
      // An idle-locked terminal only opens with a PIN.
      canDismiss={!!currentUser && !isTerminalLocked}
      locked={isTerminalLocked}
      onClose={onClose}
      onSuccess={onSuccess}
      verifyPin={verifyPin}
      verifyCredentials={verifyCredentials}
    />
  );
};

export interface LockScreenProps {
  users: AppUser[];
  roleNames: Record<string, string>;
  defaultUsername: string;
  /** A signed-in operator switching users may close the screen; a locked or signed-out terminal may not. */
  canDismiss: boolean;
  locked: boolean;
  onClose: () => void;
  onSuccess: (user: AppUser) => void;
  verifyPin: (userId: string, pin: string) => Promise<LoginResult>;
  verifyCredentials: (username: string, pin: string) => Promise<LoginResult>;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** The lock screen itself; also rendered by the dev gallery with sample users. */
export const LockScreen: React.FC<LockScreenProps> = ({
  users, roleNames, defaultUsername, canDismiss, locked, onClose, onSuccess, verifyPin, verifyCredentials,
}) => {
  const [mode, setModeState] = useState<'select' | 'pin' | 'form'>(() => (users.length > 0 ? 'select' : 'form'));
  const [selectedUser, setSelectedUserState] = useState<AppUser | null>(null);
  const [username, setUsername] = useState(defaultUsername);
  const [pin, setPinState] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isAuthenticating, setIsAuthenticatingState] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const titleId = useId();
  const subtitleId = useId();

  const cardRef = useRef<HTMLDivElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  // The physical-keyboard listener is registered once and reads the latest state from these refs.
  const modeRef = useRef(mode);
  const selectedRef = useRef(selectedUser);
  const pinRef = useRef(pin);
  const authRef = useRef(isAuthenticating);
  const canDismissRef = useRef(canDismiss);
  canDismissRef.current = canDismiss;
  const hasUsersRef = useRef(users.length > 0);
  hasUsersRef.current = users.length > 0;

  const setMode = (next: 'select' | 'pin' | 'form') => { modeRef.current = next; setModeState(next); };
  const setSelectedUser = (user: AppUser | null) => { selectedRef.current = user; setSelectedUserState(user); };
  const setPin = (next: string) => { pinRef.current = next; setPinState(next); };
  const setAuthenticating = (busy: boolean) => { authRef.current = busy; setIsAuthenticatingState(busy); };

  const roleName = (user: AppUser) => roleNames[user.role_id] || 'Staff';

  const backToList = () => { setMode('select'); setSelectedUser(null); setPin(''); setErrorMsg(''); };

  const failLogin = (message?: string) => {
    setErrorMsg(message || 'Ghalat PIN code!');
    setPin('');
    setFailCount(count => count + 1);
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([80, 50, 80]); } catch {}
    }
  };

  const verifySelectedUserPin = async (user: AppUser, code: string) => {
    if (authRef.current) return;
    setAuthenticating(true);
    setErrorMsg('');
    try {
      const result = await verifyPin(user.id, code);
      if (result.success && result.user) onSuccess(result.user);
      else failLogin(result.message);
    } catch (err: any) {
      failLogin(err?.message || 'Authentication failed');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (authRef.current) return;
    if (!username.trim()) {
      setErrorMsg('Username enter karein');
      usernameInputRef.current?.focus();
      return;
    }
    if (!pin.trim()) {
      setErrorMsg('Password / PIN code enter karein');
      pinInputRef.current?.focus();
      return;
    }
    setAuthenticating(true);
    setErrorMsg('');
    try {
      const result = await verifyCredentials(username, pin);
      if (result.success && result.user) onSuccess(result.user);
      else failLogin(result.message);
    } catch (err: any) {
      failLogin(err?.message || 'Authentication failed');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleDigitPadPress = (digit: string) => {
    const current = pinRef.current;
    if (current.length >= 10 || authRef.current) return;
    setErrorMsg('');
    const nextPin = current + digit;
    setPin(nextPin);
    // Standard PINs are 4 digits (Settings enforces this), so auto-submit;
    // longer PINs can still be typed and submitted manually.
    const user = selectedRef.current;
    if (nextPin.length === 4 && modeRef.current === 'pin' && user) {
      setTimeout(() => {
        if (modeRef.current === 'pin' && selectedRef.current === user && pinRef.current === nextPin) void verifySelectedUserPin(user, nextPin);
      }, 100);
    }
  };
  const deleteDigit = () => { if (!authRef.current) { setErrorMsg(''); setPin(pinRef.current.slice(0, -1)); } };
  const clearPin = () => { setErrorMsg(''); setPin(''); };

  const handleUserTileSelect = (user: AppUser) => {
    if (authRef.current) return;
    setSelectedUser(user);
    setPin('');
    setErrorMsg('');
    setMode('pin');
  };

  // The user directory can arrive after the screen opened (first boot): offer the quick tiles then,
  // unless someone already started typing. A background refresh no longer resets a half-typed PIN.
  useEffect(() => {
    if (users.length > 0 && modeRef.current === 'form' && !pinRef.current && !authRef.current && !usernameInputRef.current?.matches(':focus')) {
      setMode('select');
    }
  }, [users.length]);

  // While the lock screen is up, the workspace behind it cannot be focused or
  // clicked (Tab + Enter would otherwise reach POS buttons on a locked terminal).
  // Dialogs portalled to <body> (a modal or confirm left open when the idle lock fired)
  // are frozen too; the lock screen itself sits above every layer.
  useEffect(() => {
    const targets = [
      document.querySelector<HTMLElement>('.mooco-app'),
      ...Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.id !== 'root' && el.tagName !== 'SCRIPT'),
    ].filter((el): el is HTMLElement => Boolean(el) && !el!.contains(cardRef.current));
    const previous = targets.map(el => el.inert);
    targets.forEach(el => { el.inert = true; });
    return () => { targets.forEach((el, index) => { el.inert = previous[index]; }); };
  }, []);

  useEffect(() => {
    if (canDismiss) return;
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [canDismiss]);

  // Put focus where the next key belongs whenever the step changes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current;
      if (!card) return;
      if (mode === 'form') (usernameInputRef.current?.value ? pinInputRef.current : usernameInputRef.current)?.focus({ preventScroll: true });
      else if (mode === 'select') (card.querySelector<HTMLElement>('[data-user-tile]') || card).focus({ preventScroll: true });
      else card.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  // Physical keyboard support for counter terminals: digits type the PIN, Backspace deletes,
  // Enter submits, Escape goes back. Runs in the capture phase so the page behind the lock
  // screen never sees the keys (POS F9 checkout, F8 hold, Ctrl+K palette would otherwise still work).
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (event: KeyboardEvent) => {
    const card = cardRef.current;
    const target = event.target as Node | null;
    if (!(target && card?.contains(target))) event.stopPropagation();

    if (event.key === 'Tab' && card) {
      const focusable = (Array.from(card.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !focusable.includes(active);
      if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (modeRef.current !== 'select' && hasUsersRef.current) backToList();
      else if (canDismissRef.current) onClose();
      return;
    }
    if (modeRef.current !== 'pin' || !selectedRef.current) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!authRef.current && pinRef.current.length >= 4) void verifySelectedUserPin(selectedRef.current, pinRef.current);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      deleteDigit();
    } else if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      handleDigitPadPress(event.key);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const title = canDismiss ? 'Switch operator' : locked ? 'Terminal locked' : 'Sign in to Mooco';
  const subtitle = mode === 'select'
    ? 'Choose your operator'
    : mode === 'pin'
      ? `${selectedUser?.name} — enter PIN`
      : 'Username & Password / 4-Digit PIN';
  const errorAlert = errorMsg && (
    <div role="alert" className="flex items-center gap-2.5 rounded-control bg-danger-soft p-3 text-[13px] font-semibold text-danger-fg ring-1 ring-inset ring-danger/20">
      <AlertCircle size={16} className="shrink-0" aria-hidden="true" />
      <span>{errorMsg}</span>
    </div>
  );

  return (
    <div
      data-lock-screen
      data-app-modal="true"
      className={cn(
        'fixed inset-0 z-[250] flex flex-col items-center justify-start overflow-y-auto px-4 py-6 sm:justify-center',
        canDismiss ? 'bg-[rgb(2_6_23/0.55)] animate-in fade-in duration-150' : 'bg-canvas',
      )}
      onMouseDown={event => { if (event.target === event.currentTarget && canDismiss) onClose(); }}
    >
      {!canDismiss && (
        <>
          {/* A soft brand glow; static, so it costs nothing after first paint. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(55%_60%_at_50%_0%,rgb(var(--brand-accent)/0.14),transparent)]" />
          <div className="relative mb-5 flex w-full max-w-[420px] items-end justify-between gap-3 px-1">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-[11px] bg-brand text-base font-extrabold text-brand-on shadow-e1-lit" aria-hidden="true">M</span>
              <div className="leading-tight">
                <p className="text-[15px] font-extrabold tracking-tight text-fg">Mooco</p>
                <p className="text-[11px] font-semibold text-fg-subtle">Dairy ERP</p>
              </div>
            </div>
            <div className="text-right leading-tight">
              <p className="text-2xl font-bold tabular-nums tracking-tight text-fg">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
              <p className="text-[11px] font-medium text-fg-subtle">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
          </div>
        </>
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        className="relative z-10 flex w-full max-w-[420px] flex-col rounded-card border border-line bg-surface shadow-e3 outline-none animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          {mode !== 'select' && users.length > 0 ? (
            <IconButton variant="ghost" size="sm" aria-label="Back to operator list" icon={<ChevronLeft />} onClick={backToList} className="-ml-1.5" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-fg ring-1 ring-inset ring-brand/15" aria-hidden="true"><Lock size={17} /></span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold leading-tight tracking-tight text-fg">{title}</h2>
            <p id={subtitleId} className="mt-0.5 truncate text-xs text-fg-subtle">{subtitle}</p>
          </div>
          {canDismiss && <IconButton variant="ghost" size="sm" aria-label="Close" icon={<X />} onClick={onClose} className="-mr-1.5" />}
        </div>

        {mode === 'select' && (
          <div className="space-y-4 p-5">
            {errorAlert}
            <div className="grid max-h-[46vh] grid-cols-2 gap-2.5 overflow-y-auto p-0.5">
              {users.map(user => (
                <button
                  key={user.id}
                  type="button"
                  data-user-tile
                  onClick={() => handleUserTileSelect(user)}
                  disabled={isAuthenticating}
                  className="group flex min-w-0 cursor-pointer flex-col items-center gap-2 rounded-card border border-line bg-surface px-3 pb-3.5 pt-4 text-center transition-[background-color,border-color,transform] duration-150 hover:border-brand-accent/50 hover:bg-brand-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[.98] disabled:opacity-60"
                >
                  <UserAvatar user={user} size="md" />
                  <span className="w-full truncate text-sm font-bold text-fg">{user.name}</span>
                  <span className="max-w-full truncate rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fg-subtle ring-1 ring-inset ring-line">{roleName(user)}</span>
                </button>
              ))}
            </div>
            <Button variant="secondary" fullWidth leftIcon={<Keyboard />} onClick={() => { setMode('form'); setErrorMsg(''); setPin(''); }}>
              Login with username
            </Button>
            <p className="text-center text-xs text-fg-faint">Tap a tile, then enter your 4-digit PIN.</p>
          </div>
        )}

        {mode === 'pin' && selectedUser && (
          <div className="space-y-5 p-5">
            <div className="flex flex-col items-center gap-2.5">
              <UserAvatar user={selectedUser} size="lg" />
              <div className="text-center">
                <p className="font-bold text-fg">{selectedUser.name}</p>
                <p className="text-xs font-medium text-fg-subtle">{roleName(selectedUser)}</p>
              </div>
              <div
                key={failCount}
                className={cn('flex h-6 items-center gap-3', failCount > 0 && errorMsg && 'lock-shake')}
                role="status"
                aria-label={`${pin.length} digits entered`}
              >
                {[0, 1, 2, 3].map(i => (
                  <span
                    key={i}
                    className={cn(
                      'size-3.5 rounded-full transition-[background-color,transform,box-shadow] duration-150',
                      pin.length > i ? 'scale-110 bg-brand-accent' : 'ring-2 ring-inset ring-line-strong',
                      errorMsg && pin.length === 0 && 'ring-danger/60',
                    )}
                  />
                ))}
                {pin.length > 4 && <span className="text-xs font-bold tabular-nums text-brand-fg">+{pin.length - 4}</span>}
              </div>
              <p role="alert" className="min-h-5 text-center text-[13px] font-semibold text-danger-fg">{errorMsg}</p>
            </div>

            <Keypad onDigit={handleDigitPadPress} onClear={clearPin} onBackspace={deleteDigit} />

            <Button
              size="lg"
              fullWidth
              loading={isAuthenticating}
              disabled={!pin}
              leftIcon={<LogIn />}
              onClick={() => void verifySelectedUserPin(selectedUser, pinRef.current)}
            >
              {isAuthenticating ? 'Authenticating...' : 'Sign In & Unlock Terminal'}
            </Button>
          </div>
        )}

        {/* Fallback: username + PIN form */}
        {mode === 'form' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4 p-5">
            {errorAlert}
            <Field label="Username">
              {control => (
                <Input
                  {...control}
                  ref={usernameInputRef}
                  leftIcon={<User />}
                  placeholder="e.g. admin or ali"
                  value={username}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setErrorMsg('');
                    setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''));
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="username"
                />
              )}
            </Field>
            <Field label="Password / 4-Digit PIN">
              {control => (
                <Input
                  {...control}
                  ref={pinInputRef}
                  type="password"
                  leftIcon={<KeyRound />}
                  maxLength={10}
                  placeholder="••••"
                  value={pin}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setErrorMsg('');
                    setPin(e.target.value);
                  }}
                  autoComplete="current-password"
                  className="font-mono tracking-widest"
                />
              )}
            </Field>

            {/* On-screen keypad for touch terminals */}
            <Keypad onDigit={handleDigitPadPress} onClear={clearPin} onBackspace={deleteDigit} />

            <Button type="submit" size="lg" fullWidth loading={isAuthenticating} leftIcon={<LogIn />}>
              {isAuthenticating ? 'Authenticating...' : 'Sign In & Unlock Terminal'}
            </Button>
            <p className="text-center text-xs text-fg-faint">Sign in with your operator credentials. Access is controlled by the admin.</p>
          </form>
        )}
      </div>
    </div>
  );
};

const KEY_CLASS =
  'flex h-14 cursor-pointer select-none items-center justify-center rounded-control bg-surface-2 text-xl font-semibold tabular-nums text-fg ring-1 ring-inset ring-line/70 ' +
  'transition-[background-color,transform] duration-100 hover:bg-surface-3 active:scale-[.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const Keypad: React.FC<{ onDigit: (digit: string) => void; onClear: () => void; onBackspace: () => void }> = ({ onDigit, onClear, onBackspace }) => (
  <div className="grid grid-cols-3 gap-2" role="group" aria-label="PIN keypad">
    {DIGITS.map(digit => (
      <button key={digit} type="button" className={KEY_CLASS} onClick={() => onDigit(digit)}>{digit}</button>
    ))}
    <button type="button" className={cn(KEY_CLASS, 'text-[13px] font-semibold text-fg-subtle')} onClick={onClear}>Clear</button>
    <button type="button" className={KEY_CLASS} onClick={() => onDigit('0')}>0</button>
    <button type="button" className={cn(KEY_CLASS, 'text-fg-subtle hover:text-danger-fg')} onClick={onBackspace} aria-label="Delete last digit"><Delete size={20} /></button>
  </div>
);

const UserAvatar: React.FC<{ user: AppUser; size: 'md' | 'lg' }> = ({ user, size }) => {
  const box = size === 'lg' ? 'size-16 rounded-[20px] text-2xl' : 'size-12 rounded-2xl text-lg';
  if (user.avatar && String(user.avatar).startsWith('http')) {
    return <img src={user.avatar} alt="" className={cn(box, 'object-cover shadow-e1')} />;
  }
  if (user.avatar) {
    return <span className={cn(box, 'flex items-center justify-center bg-surface-2 ring-1 ring-inset ring-line')} aria-hidden="true">{user.avatar}</span>;
  }
  return (
    <span className={cn(box, 'flex items-center justify-center bg-brand-soft font-extrabold text-brand-fg ring-1 ring-inset ring-brand/15')} aria-hidden="true">
      {user.name.trim().charAt(0).toUpperCase()}
    </span>
  );
};

export default UserSwitcherModal;
