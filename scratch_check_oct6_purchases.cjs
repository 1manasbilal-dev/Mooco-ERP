const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkPurchasesToday() {
  const { data: pur } = await supabase.from('purchases')
    .select('*')
    .gte('created_at', '2026-10-06T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Purchases since 2026-10-06: ${pur?.length}`);
  (pur || []).forEach(p => {
    console.log(`Created: ${p.created_at} | Date: ${p.date} | Shift: ${p.shift} | Supp: ${p.details?.supplier_name} | Type: ${p.milk_type} | Qty: ${p.quantity} | Total: ${p.total_amount} | Status: ${p.status}`);
  });
}

checkPurchasesToday();
