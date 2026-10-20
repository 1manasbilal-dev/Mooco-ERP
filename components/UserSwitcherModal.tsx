import React, { useState, useEffect, useRef } from 'react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import {
  X, Lock, KeyRound, User, AlertCircle,
  LogIn, Delete, ChevronLeft, Users, Keyboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { AppUser } from '../types';

const MotionDiv = motion.div as any;

const UserSwitcherModal: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentUser, users, roles, isUserSwitcherOpen, isTerminalLocked,
    setIsUserSwitcherOpen, loginWithCredentials, switchUserByIdAndPin
  } = useDairy();
  // An idle-locked terminal only opens with a PIN.
  const canDismiss = !!currentUser && !isTerminalLocked;
  const { showToast } = useToast();

  const [mode, setMode] = useState<'select' | 'pin' | 'form'>('select');
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
  const [username, setUsername] = useState<string>('');
  const [pin, setPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);

  const usernameInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const activeUsers = users.filter(u => u.is_active !== false);
  const roleName = (user: AppUser) => roles.find(r => r.id === user.role_id)?.name || 'Staff';

  // Reset & focus on open. Fast path: user tiles when the directory is loaded.
  useEffect(() => {
    if (isUserSwitcherOpen) {
      setMode(activeUsers.length > 0 ? 'select' : 'form');
      setSelectedUser(null);
      setUsername(currentUser?.username || '');
      setPin('');
      setErrorMsg('');
      setTimeout(() => {
        if (activeUsers.length === 0) usernameInputRef.current?.focus();
      }, 100);
    }
  }, [isUserSwitcherOpen, currentUser, users]);

  const finishLogin = (user: AppUser) => {
    showToast(`Welcome, ${user.name}!`, 'success');
    setIsUserSwitcherOpen(false);
    setPin('');
    setSelectedUser(null);
    if (user.role_id === 'role_cashier') {
      // Delay so the previous page's ProtectedRoute redirect (fired by the
      // currentUser change) commits first — then Cash Control wins the race.
      setTimeout(() => navigate('/cash-control'), 120);
    }
  };

  const failLogin = (message?: string) => {
    setErrorMsg(message || 'Ghalat PIN code!');
    setPin('');
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate([80, 50, 80]); } catch (v) {}
    }
  };

  const handleUserTileSelect = (user: AppUser) => {
    if (isAuthenticating) return;
    setSelectedUser(user);
    setPin('');
    setErrorMsg('');
    setMode('pin');
  };

  const verifySelectedUserPin = async (user: AppUser, code: string) => {
    setIsAuthenticating(true);
    setErrorMsg('');
    try {
      const result = await switchUserByIdAndPin(user.id, code);
      if (result.success && result.user) finishLogin(result.user);
      else failLogin(result.message);
    } catch (err: any) {
      failLogin(err?.message || 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLoginSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

    setIsAuthenticating(true);
    setErrorMsg('');

    try {
      const result = await loginWithCredentials(username, pin);
      if (result.success && result.user) finishLogin(result.user);
      else failLogin(result.message);
    } catch (err: any) {
      failLogin(err?.message || 'Authentication failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleDigitPadPress = (digit: string) => {
    if (pin.length >= 10 || isAuthenticating) return;
    setErrorMsg('');
    const nextPin = pin + digit;
    setPin(nextPin);
    // Standard PINs are 4 digits (Settings enforces this), so auto-submit;
    // longer PINs can still be typed and submitted manually.
    if (nextPin.length === 4) {
      setTimeout(() => {
        if (mode === 'pin' && selectedUser) verifySelectedUserPin(selectedUser, nextPin);
      }, 100);
    }
  };

  // Physical keyboard support for counter terminals: digits type the PIN,
  // Backspace deletes, Enter submits, Escape goes back to the user list.
  useEffect(() => {
    if (!isUserSwitcherOpen || mode !== 'pin' || !selectedUser) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!isAuthenticating && pin.length >= 4) verifySelectedUserPin(selectedUser, pin);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (!isAuthenticating) { setErrorMsg(''); setPin(prev => prev.slice(0, -1)); }
      } else if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        handleDigitPadPress(event.key);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setMode('select'); setSelectedUser(null); setPin(''); setErrorMsg('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isUserSwitcherOpen, mode, selectedUser, pin, isAuthenticating]);

  if (!isUserSwitcherOpen) return null;

  const headerSubtitle = mode === 'select'
    ? 'Choose your operator'
    : mode === 'pin'
      ? `${selectedUser?.name} — enter PIN`
      : 'Username & Password / 4-Digit PIN';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        {/* Backdrop */}
        <MotionDiv
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
          onClick={() => {
            // Only allow closing if there's already an active logged-in user
            if (canDismiss) setIsUserSwitcherOpen(false);
          }}
        />

        {/* Modal Card */}
        <MotionDiv
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 z-10 flex flex-col"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-lime-500 to-lime-600 text-white flex items-center justify-center shadow-md shadow-lime-500/20">
                <Lock size={20} />
              </div>
              <div>
                <h3 className="font-black text-base text-slate-900 dark:text-white leading-tight flex items-center gap-2">
                  {mode === 'pin' && (
                    <button
                      type="button"
                      onClick={() => { setMode('select'); setSelectedUser(null); setPin(''); setErrorMsg(''); }}
                      className="p-1 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Back to operator list"
                    >
                      <ChevronLeft size={18} />
                    </button>
                  )}
                  <span>Operator Login & Lock</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{headerSubtitle}</p>
              </div>
            </div>

            {canDismiss && (
              <button
                type="button"
                onClick={() => setIsUserSwitcherOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                title="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* ---- Step 1: operator tiles ---- */}
          {mode === 'select' && (
            <div className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2.5">
                  <AlertCircle size={16} className="shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 max-h-[46vh] overflow-y-auto pr-1">
                {activeUsers.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleUserTileSelect(user)}
                    disabled={isAuthenticating}
                    className="group flex flex-col items-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-lime-400 hover:bg-lime-50 dark:hover:bg-lime-950/30 px-3 py-4 transition-all active:scale-95 cursor-pointer disabled:opacity-60"
                  >
                    {user.avatar ? (
                      String(user.avatar).startsWith('http') ? (
                        <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                      ) : (
                        <span className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center text-2xl">{user.avatar}</span>
                      )
                    ) : (
                      <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 dark:from-lime-600 dark:to-emerald-700 text-white flex items-center justify-center text-lg font-black shadow-sm">
                        {user.name.trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight text-center">{user.name}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-lime-700 dark:text-lime-400 bg-lime-100/70 dark:bg-lime-950/50 rounded-full px-2 py-0.5">{roleName(user)}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => { setMode('form'); setErrorMsg(''); setTimeout(() => usernameInputRef.current?.focus(), 100); }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-400 transition-colors cursor-pointer"
              >
                <Keyboard size={15} /> Login with username
              </button>

              <div className="text-center pt-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium flex items-center justify-center gap-1.5">
                  <Users size={12} /> Tap a tile, then enter your 4-digit PIN.
                </span>
              </div>
            </div>
          )}

          {/* ---- Step 2a: PIN pad for selected user ---- */}
          {mode === 'pin' && selectedUser && (
            <div className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2.5">
                  <AlertCircle size={16} className="shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex flex-col items-center gap-3">
                {selectedUser.avatar ? (
                  String(selectedUser.avatar).startsWith('http') ? (
                    <img src={selectedUser.avatar} alt={selectedUser.name} className="w-14 h-14 rounded-2xl object-cover shadow-sm" />
                  ) : (
                    <span className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-700 shadow-sm flex items-center justify-center text-2xl">{selectedUser.avatar}</span>
                  )
                ) : (
                  <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 dark:from-lime-600 dark:to-emerald-700 text-white flex items-center justify-center text-xl font-black shadow-sm">
                    {selectedUser.name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="text-center">
                  <p className="font-black text-slate-900 dark:text-white">{selectedUser.name}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{roleName(selectedUser)}</p>
                </div>
                {/* PIN dots */}
                <div className="flex items-center gap-2.5 my-1">
                  {[0, 1, 2, 3].map(i => (
                    <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${pin.length > i ? 'bg-lime-500 border-lime-500 scale-110' : 'border-slate-300 dark:border-slate-600'}`} />
                  ))}
                  {pin.length > 4 && <span className="text-xs font-black text-lime-600">+{pin.length - 4}</span>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDigitPadPress(d)}
                    className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-lime-50 dark:hover:bg-lime-950/40 text-slate-800 dark:text-slate-100 hover:text-lime-700 dark:hover:text-lime-300 border border-slate-200 dark:border-slate-700 hover:border-lime-300 font-bold text-base transition-all active:scale-95 cursor-pointer select-none"
                  >
                    {d}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setErrorMsg(''); setPin(''); }}
                  className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 font-bold text-xs transition-all active:scale-95 cursor-pointer"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => handleDigitPadPress('0')}
                  className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-lime-50 dark:hover:bg-lime-950/40 text-slate-800 dark:text-slate-100 hover:text-lime-700 dark:hover:text-lime-300 border border-slate-200 dark:border-slate-700 hover:border-lime-300 font-bold text-base transition-all active:scale-95 cursor-pointer select-none"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => { setErrorMsg(''); setPin(prev => prev.slice(0, -1)); }}
                  className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 border border-slate-200 dark:border-slate-700 font-bold text-xs transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                >
                  <Delete size={18} />
                </button>
              </div>

              <button
                type="button"
                disabled={isAuthenticating || !pin}
                onClick={() => verifySelectedUserPin(selectedUser, pin)}
                className="w-full py-3 rounded-xl bg-lime-600 hover:bg-lime-500 text-white font-bold text-sm shadow-md shadow-lime-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 active:scale-98"
              >
                {isAuthenticating ? (
                  <span>Authenticating...</span>
                ) : (
                  <>
                    <LogIn size={18} />
                    <span>Sign In & Unlock Terminal</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* ---- Step 2b: classic username + PIN form (fallback) ---- */}
          {mode === 'form' && (
            <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
              {activeUsers.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setMode('select'); setErrorMsg(''); setPin(''); }}
                  className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={15} /> Operator list
                </button>
              )}

              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2.5 animate-in shake duration-200">
                  <AlertCircle size={16} className="shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Username Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <User size={16} />
                  </div>
                  <input
                    ref={usernameInputRef}
                    type="text"
                    placeholder="e.g. admin or ali"
                    value={username}
                    onChange={e => {
                      setErrorMsg('');
                      setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''));
                    }}
                    autoCapitalize="none"
                    autoCorrect="off"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 transition-all shadow-xs"
                  />
                </div>
              </div>

              {/* Password / PIN Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Password / 4-Digit PIN
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <KeyRound size={16} />
                  </div>
                  <input
                    ref={pinInputRef}
                    type="password"
                    maxLength={10}
                    placeholder="••••"
                    value={pin}
                    onChange={e => {
                      setErrorMsg('');
                      setPin(e.target.value);
                    }}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono tracking-widest text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 transition-all shadow-xs"
                  />
                </div>
              </div>

              {/* On-Screen Fast 0-9 Keypad for Counter Touch Terminals */}
              <div className="pt-2">
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDigitPadPress(d)}
                      className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-lime-50 dark:hover:bg-lime-950/40 text-slate-800 dark:text-slate-100 hover:text-lime-700 dark:hover:text-lime-300 border border-slate-200 dark:border-slate-700 hover:border-lime-300 font-bold text-base transition-all active:scale-95 cursor-pointer select-none"
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setPin('');
                    }}
                    className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 font-bold text-xs transition-all active:scale-95 cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDigitPadPress('0')}
                    className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-lime-50 dark:hover:bg-lime-950/40 text-slate-800 dark:text-slate-100 hover:text-lime-700 dark:hover:text-lime-300 border border-slate-200 dark:border-slate-700 hover:border-lime-300 font-bold text-base transition-all active:scale-95 cursor-pointer select-none"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setPin(prev => prev.slice(0, -1));
                    }}
                    className="py-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 dark:border-slate-700 font-bold text-xs transition-all active:scale-95 flex items-center justify-center cursor-pointer"
                  >
                    <Delete size={18} />
                  </button>
                </div>
              </div>

              {/* Submit Action Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full py-3 rounded-xl bg-lime-600 hover:bg-lime-500 text-white font-bold text-sm shadow-md shadow-lime-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 active:scale-98"
                >
                  {isAuthenticating ? (
                    <span>Authenticating...</span>
                  ) : (
                    <>
                      <LogIn size={18} />
                      <span>Sign In & Unlock Terminal</span>
                    </>
                  )}
                </button>
              </div>

              <div className="text-center pt-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                  Sign in with your operator credentials. Access is controlled by the admin.
                </span>
              </div>

            </form>
          )}
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};

export default UserSwitcherModal;
