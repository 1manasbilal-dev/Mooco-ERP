import React, { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTabs } from '../context/TabContext';
import { Skeleton } from '../components/ui';

// Each Procurement tab only loads the code it shows: the milk slip screen does not ship
// the supplies bill (and its swipe/drag code), and the other way round.
const MilkCollection = lazy(() => import('../components/procurement/MilkCollection'));
const SuppliesPurchase = lazy(() => import('../components/procurement/SuppliesPurchase'));

function ProcurementSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-16 w-full max-w-xl" />
      <Skeleton className="h-[54px] rounded-card md:hidden" />
      <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-card" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-[460px] rounded-card lg:col-span-8" />
        <Skeleton className="h-[300px] rounded-card lg:col-span-4" />
      </div>
    </div>
  );
}

/** Milk Collection (`view="milk"`) and Supplies & Materials (`view="supplies"`). */
const Purchase: React.FC<{ view?: 'milk' | 'supplies' }> = ({ view = 'milk' }) => {
  const { openTab, activeTabId } = useTabs();
  const location = useLocation();
  const ownTab = view === 'supplies' ? 'purchase-supplies' : 'purchase';

  // Older links used ?tab=milk|material on one screen. Send them to the matching submodule.
  useEffect(() => {
    if (activeTabId !== ownTab) return;
    const tab = new URLSearchParams(location.search).get('tab');
    if (view === 'milk' && tab === 'material') openTab('purchase-supplies');
    else if (view === 'supplies' && tab === 'milk') openTab('purchase');
  }, [location.search, view, openTab, activeTabId, ownTab]);

  return (
    <Suspense fallback={<ProcurementSkeleton />}>
      {view === 'supplies' ? <SuppliesPurchase /> : <MilkCollection />}
    </Suspense>
  );
};

export default Purchase;
