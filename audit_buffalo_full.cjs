const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function fullAudit() {
  console.log('================ 1. ALL INVENTORY LOGS FOR BUFFALO MILK ================');
  const { data: logs, error: lErr } = await supabase.from('inventory_logs')
    .select('*')
    .or('item_id.eq.item_buffalo_milk,item_name.ilike.%buffalo%')
    .order('created_at', { ascending: true });
  console.log(`Found ${logs?.length || 0} logs for buffalo milk:`);
  (logs || []).forEach(l => {
    console.log(`[${l.created_at || l.date}] Type: ${l.type}, Change: ${l.change_amount || l.quantity}, Prev: ${l.previous_stock}, New: ${l.new_stock}, Reason: "${l.reason}"`);
  });

  console.log('\n================ 2. ALL PURCHASES FOR BUFFALO MILK (OCTOBER) ================');
  const { data: purchases } = await supabase.from('purchases')
    .select('*')
    .ilike('milk_type', '%buffalo%')
    .gte('date', '2026-10-01')
    .order('date', { ascending: true });
  console.log(`Found ${purchases?.length || 0} purchases for buffalo milk in October:`);
  (purchases || []).forEach(p => {
    console.log(`[${p.date}] ID: ${p.id}, Supplier: ${p.supplier_name || p.supplier_id}, Shift: ${p.shift}, Qty: ${p.quantity} L, Rate: ${p.rate}, Total: ${p.total_amount}`);
  });

  console.log('\n================ 3. ALL ALLOCATIONS FOR BUFFALO MILK (OCTOBER) ================');
  const { data: allocs } = await supabase.from('allocations')
    .select('*')
    .ilike('milk_type', '%buffalo%')
    .gte('date', '2026-10-01')
    .order('date', { ascending: true });
  console.log(`Found ${allocs?.length || 0} allocations for buffalo milk in October:`);
  (allocs || []).forEach(a => {
    console.log(`[${a.date}] ID: ${a.id}, Orig: ${a.original_quantity}, Alloc: ${a.allocated_quantity}, Rem: ${a.remaining_quantity}`);
    console.log(`   History:`, JSON.stringify(a.details?.allocation_history || a.details));
  });

  console.log('\n================ 4. ALL SALES OF BUFFALO MILK (OCTOBER 7, 8, 9) ================');
  const { data: sales } = await supabase.from('sales')
    .select('*')
    .gte('date', '2026-10-07')
    .lte('date', '2026-10-09')
    .order('date', { ascending: true });
  
  let buffaloSales = [];
  (sales || []).forEach(s => {
    (s.items || []).forEach(it => {
      const name = (it.name || it.item_name || '').toLowerCase();
      const id = (it.id || it.item_id || '');
      if (id === 'item_buffalo_milk' || name.includes('buffalo')) {
        buffaloSales.push({
          bill_date: s.date,
          invoice_no: s.invoice_no,
          created_at: s.created_at,
          item_id: id,
          item_name: it.name,
          qty: it.qty,
          price: it.price,
          total: it.total
        });
      }
    });
  });
  console.log(`Found ${buffaloSales.length} sales lines of Buffalo Milk on Oct 7-9:`);
  buffaloSales.forEach(bs => {
    console.log(`[Date: ${bs.bill_date} / At: ${bs.created_at}] Bill #${bs.invoice_no}: ${bs.qty} L @ ${bs.price} = ${bs.total} (Item: ${bs.item_name})`);
  });

  console.log('\n================ 5. ALL PRODUCTION BATCHES (OCTOBER 7, 8, 9) ================');
  const { data: batches } = await supabase.from('production_batches')
    .select('*')
    .gte('start_date', '2026-10-07')
    .order('start_date', { ascending: true });
  console.log(`Found ${batches?.length || 0} production batches on Oct 7-9:`);
  (batches || []).forEach(b => {
    console.log(`[${b.start_date}] Product: ${b.product_name}, Output: ${b.output_quantity}, Raw milk used: ${b.raw_milk_used}, Milk type: ${b.milk_type}, Details:`, JSON.stringify(b.details));
  });

  console.log('\n================ 6. ALL INVENTORY LOGS ON OCT 7, 8, 9 (ALL ITEMS) ================');
  const { data: allLogs } = await supabase.from('inventory_logs')
    .select('*')
    .gte('created_at', '2026-10-07T00:00:00')
    .order('created_at', { ascending: true });
  console.log(`Found ${allLogs?.length || 0} inventory logs on Oct 7-9:`);
  (allLogs || []).forEach(l => {
    console.log(`[${l.created_at}] Item: "${l.item_name}" (${l.item_id}), Change: ${l.change_amount}, Prev: ${l.previous_stock}, New: ${l.new_stock}, Reason: "${l.reason}"`);
  });
}

fullAudit().catch(console.error);
