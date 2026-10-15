const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function check123L() {
  const { data: p } = await supabase.from('purchases').select('*').ilike('details->>supplier_name', '%Mujtaba%').gte('created_at', '2026-10-07T15:20:00Z');
  console.log('Purchases around 15:23:');
  p.forEach(x => console.log(x.id, x.quantity, x.shift, x.date));

  const pIds = p.map(x => x.id);
  const { data: a } = await supabase.from('allocations').select('*').in('purchase_id', pIds);
  console.log('Allocations:');
  a.forEach(x => console.log(x.id, x.purchase_id, x.original_quantity, x.allocated_quantity, x.remaining_quantity, x.destination, x.details));
}

check123L();
