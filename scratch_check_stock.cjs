const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function inspectCowMilk() {
  console.log('=== 1. ITEMS (matching milk / cow) ===');
  const { data: items, error: itemsErr } = await supabase.from('items').select('*');
  if (itemsErr) console.error('items error:', itemsErr);
  const cowItems = (items || []).filter(i => 
    (i.name && (i.name.toLowerCase().includes('cow') || i.name.toLowerCase().includes('milk') || i.name.toLowerCase().includes('doodh')))
  );
  console.log('Cow/Milk items count:', cowItems.length);
  cowItems.forEach(i => {
    console.log(`Item: [${i.id}] "${i.name}", code: ${i.code}, stock: ${i.stock}, unit: ${i.unit}, type: ${JSON.stringify(i.item_type)}, variant_stocks: ${JSON.stringify(i.variant_stocks)}`);
  });

  console.log('\n=== 2. INVENTORY (all rows) ===');
  const { data: inv, error: invErr } = await supabase.from('inventory').select('*');
  if (invErr) console.error('inventory error:', invErr);
  console.log('Total inventory rows:', inv?.length);
  const milkInv = (inv || []).filter(i => 
    (i.name && (i.name.toLowerCase().includes('cow') || i.name.toLowerCase().includes('milk') || i.name.toLowerCase().includes('doodh')))
  );
  milkInv.forEach(i => {
    console.log(`Inv: [${i.id}] item_id: ${i.item_id}, name: "${i.name}", qty: ${i.quantity}, stock_type: ${i.stock_type}, unit: ${i.unit}, updated_at: ${i.updated_at}`);
  });

  console.log('\n=== 3. INVENTORY LOGS (recent 30 for cow/milk) ===');
  const { data: logs, error: logsErr } = await supabase.from('inventory_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (logsErr) console.error('logs error:', logsErr);
  const cowLogs = (logs || []).filter(l => 
    (l.item_name && (l.item_name.toLowerCase().includes('cow') || l.item_name.toLowerCase().includes('milk'))) ||
    (l.reason && l.reason.toLowerCase().includes('cow'))
  );
  console.log(`Found ${cowLogs.length} recent logs for Cow/Milk:`);
  cowLogs.slice(0, 30).forEach(l => {
    console.log(`[${l.created_at}] item: "${l.item_name}", change: ${l.quantity_change}, prev: ${l.previous_quantity}, new: ${l.new_quantity}, reason: "${l.reason}", ref: ${l.reference_id}`);
  });

  console.log('\n=== 4. MILK COLLECTIONS / INTAKE (recent 20) ===');
  const { data: collections, error: colErr } = await supabase.from('milk_collections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);
  if (colErr) {
    console.log('milk_collections query err (table might have diff name):', colErr.message);
  } else {
    console.log('Collections count:', collections?.length);
    const cowCollections = (collections || []).filter(c => 
      c.milk_type?.toLowerCase().includes('cow') || c.shift || true
    );
    cowCollections.slice(0, 15).forEach(c => {
      console.log(`Collection: date: ${c.date}, time: ${c.shift_time || c.shift}, type: ${c.milk_type}, liters: ${c.liters || c.gross_liters || c.quantity}, supplier_id: ${c.supplier_id}`);
    });
  }

  console.log('\n=== 5. SALES with Cow Milk (recent 20) ===');
  const { data: sales, error: salesErr } = await supabase.from('sales')
    .select('id, bill_number, date, created_at, items, total')
    .order('created_at', { ascending: false })
    .limit(50);
  if (salesErr) console.error('sales error:', salesErr);
  const cowSales = (sales || []).filter(s => {
    if (typeof s.items === 'string') {
      return s.items.toLowerCase().includes('cow');
    } else if (Array.isArray(s.items)) {
      return s.items.some(it => (it.name || '').toLowerCase().includes('cow'));
    }
    return false;
  });
  console.log('Sales containing cow milk in last 50 sales:', cowSales.length);
  cowSales.slice(0, 10).forEach(s => {
    console.log(`Sale [${s.bill_number}] date: ${s.date}: items: ${JSON.stringify(s.items)}`);
  });
}

inspectCowMilk();
