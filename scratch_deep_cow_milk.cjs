const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function deepAnalyzeCowMilk() {
  console.log('====================================================');
  console.log('1. ITEM RECORD FOR COW MILK');
  console.log('====================================================');
  const { data: itemRows } = await supabase.from('items').select('*').ilike('name', '%cow%');
  console.log(JSON.stringify(itemRows, null, 2));

  console.log('\n====================================================');
  console.log('2. INVENTORY LOGS FOR COW MILK OR COW ITEM ID');
  console.log('====================================================');
  const { data: logs } = await supabase.from('inventory_logs')
    .select('*')
    .order('date', { ascending: false });
  const cowLogs = (logs || []).filter(l => 
    (l.item_name && l.item_name.toLowerCase().includes('cow')) ||
    (l.item_id && l.item_id.toLowerCase().includes('cow')) ||
    (l.reason && l.reason.toLowerCase().includes('cow')) ||
    (l.notes && l.notes.toLowerCase().includes('cow'))
  );
  console.log(`Total inventory logs: ${logs?.length}, Cow logs: ${cowLogs.length}`);
  cowLogs.forEach(l => {
    console.log(`Date: ${l.date} | Item: ${l.item_name} (${l.item_id}) | Diff: ${l.difference} | Old: ${l.old_quantity} -> New: ${l.new_quantity} | Reason: "${l.reason}" | Notes: "${l.notes}" | Details:`, JSON.stringify(l.details));
  });

  console.log('\n====================================================');
  console.log('3. PURCHASES (MILK INTAKE) FOR COW MILK');
  console.log('====================================================');
  const { data: purchases } = await supabase.from('purchases')
    .select('*')
    .order('date', { ascending: false });
  const cowPurchases = (purchases || []).filter(p => 
    (p.milk_type && p.milk_type.toLowerCase().includes('cow'))
  );
  console.log(`Total purchases: ${purchases?.length}, Cow purchases: ${cowPurchases.length}`);
  let totalCowPurchased = 0;
  cowPurchases.forEach(p => {
    totalCowPurchased += Number(p.quantity || 0);
    console.log(`Purchase ID: ${p.id} | Date: ${p.date} | Shift: ${p.shift} | Qty: ${p.quantity} L | Rate: ${p.rate} | Amount: ${p.total_amount} | Status: ${p.status} | Details:`, JSON.stringify(p.details));
  });
  console.log(`-> Total Cow Purchased Liters: ${totalCowPurchased}`);

  console.log('\n====================================================');
  console.log('4. ALLOCATIONS FOR COW MILK');
  console.log('====================================================');
  const { data: allocations } = await supabase.from('allocations')
    .select('*')
    .order('date', { ascending: false });
  const cowAllocations = (allocations || []).filter(a => 
    (a.milk_type && a.milk_type.toLowerCase().includes('cow'))
  );
  console.log(`Total allocations: ${allocations?.length}, Cow allocations: ${cowAllocations.length}`);
  cowAllocations.forEach(a => {
    console.log(`Alloc ID: ${a.id} | Date: ${a.date} | PurchaseId: ${a.purchase_id} | Orig: ${a.original_quantity} | Rem: ${a.remaining_quantity} | Dest: ${a.destination} | DestDetails:`, JSON.stringify(a.destination_details), `| Status: ${a.status}`);
  });

  console.log('\n====================================================');
  console.log('5. SALES OF COW MILK');
  console.log('====================================================');
  const { data: sales } = await supabase.from('sales')
    .select('id, bill_number, date, status, items, total')
    .order('date', { ascending: false });
  let totalCowSold = 0;
  const cowSales = [];
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
          totalCowSold += qty;
          cowSales.push({ bill: s.bill_number, date: s.date, status: s.status, qty, price: it.price || it.rate, total: s.total });
        }
      });
    }
  });
  console.log(`Total Cow Sold Liters: ${totalCowSold} across ${cowSales.length} sales`);
  cowSales.slice(0, 15).forEach(cs => {
    console.log(`Bill: ${cs.bill} | Date: ${cs.date} | Qty: ${cs.qty} L | Status: ${cs.status}`);
  });

  console.log('\n====================================================');
  console.log('6. PRODUCTION BATCHES (USING COW MILK OR PRODUCING COW PRODUCTS)');
  console.log('====================================================');
  const { data: batches } = await supabase.from('production_batches')
    .select('*')
    .order('start_date', { ascending: false });
  console.log(`Total batches: ${batches?.length}`);
  (batches || []).forEach(b => {
    const str = JSON.stringify(b).toLowerCase();
    if (str.includes('cow')) {
      console.log(`Batch: ${b.batch_number} | Product: ${b.product_name} | In: ${b.quantity_input} | OutEst: ${b.quantity_output_estimated} | OutAct: ${b.quantity_output_actual} | Status: ${b.status} | Details:`, JSON.stringify(b.details), `| Logs:`, JSON.stringify(b.logs));
    }
  });
}

deepAnalyzeCowMilk();
