import React, { useEffect, useState } from 'react';
import { useTabs } from '../../context/TabContext';
import { useToast } from '../../context/ToastContext';

// Browser-only diagnostic page; tests substitute it for business pages.
const moduleId = new URL(import.meta.url).searchParams.get('module') || 'dashboard';
export default function WorkspaceProbe() {
  const { openTab, closeTab } = useTabs();
  const { showToast } = useToast();
  const [draft, setDraft] = useState('');
  const [identity] = useState(() => Math.random().toString(36));
  const counters = (window as any).__workspaceCounters ||= { renders: {}, effects: {} };
  counters.renders[moduleId] = (counters.renders[moduleId] || 0) + 1;
  useEffect(() => {
    counters.effects[moduleId] = (counters.effects[moduleId] || 0) + 1;
    return () => { counters.effects[moduleId] -= 1; };
  }, []);
  return <section data-probe={moduleId} data-identity={identity}>
    <h2>{moduleId} test workspace</h2>
    <input aria-label="Unsaved draft" value={draft} onChange={event => setDraft(event.target.value)} />
    <button onClick={() => openTab('purchase')}>Visit purchase</button>
    <button onClick={() => openTab('dashboard')}>Visit dashboard</button>
    <button onClick={() => closeTab('purchase')}>Close purchase</button>
    <button onClick={() => showToast('Performance test notification', 'info', 10000)}>Test notification</button>
    <div style={{ height: 2000 }}>Scrollable form workspace</div>
  </section>;
}
