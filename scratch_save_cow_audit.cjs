const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function run() {
  const { data: itemRows } = await supabase.from('items').select('*').eq('id', 'item_cow_milk');
  const cowItem = itemRows && itemRows[0];

  const { data: logs } = await supabase.from('inventory_logs')
    .select('*')
    .or('item_id.eq.item_cow_milk,item_name.ilike.%cow%')
    .order('date', { ascending: false });

  const { data: purchases } = await supabase.from('purchases')
    .select('*')
    .ilike('milk_type', '%cow%')
    .order('date', { ascending: false });

  const { data: allocations } = await supabase.from('allocations')
    .select('*')
    .ilike('milk_type', '%cow%')
    .order('date', { ascending: false });

  const { data: sales } = await supabase.from('sales')
    .select('id, bill_number, date, status, items, total')
    .order('date', { ascending: false });

  let cowSales = [];
  let totalSoldQty = 0;
  (sales || []).forEach(s => {
    let items = s.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) {}
    }
    if (Array.isArray(items)) {
      items.forEach(it => {
        const name = (it.name || '').toLowerCase();
        const itemId = (it.item_id || it.id || '').toLowerCase();
        if (name.includes('cow milk') || itemId === 'item_cow_milk') {
          const qty = Number(it.quantity || it.qty || 0);
          totalSoldQty += qty;
          cowSales.push({ bill: s.bill_number, date: s.date, status: s.status, qty, price: it.price || it.rate, total: s.total });
        }
      });
    }
  });

  const report = {
    cowItem,
    logsSummary: {
      count: logs?.length,
      logs: logs
    },
    purchasesSummary: {
      count: purchases?.length,
      totalQty: purchases?.reduce((sum, p) => sum + Number(p.quantity || 0), 0),
      purchases
    },
    allocationsSummary: {
      count: allocations?.length,
      allocations
    },
    salesSummary: {
      count: cowSales.length,
      totalSoldQty,
      cowSales
    }
  };

  fs.writeFileSync('cow_milk_audit.json', JSON.stringify(report, null, 2));
  console.log('Saved cow_milk_audit.json');
  console.log('Current item_cow_milk stock in DB:', cowItem?.stock);
  console.log('Total purchased Cow Milk (liters):', report.purchasesSummary.totalQty);
  console.log('Total sold Cow Milk (liters):', totalSoldQty);
  console.log('Number of inventory logs for cow milk:', logs?.length);
  console.log('Allocations count:', allocations?.length);
}

run();
