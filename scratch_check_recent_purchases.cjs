const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkMujtabaPurchases() {
  const { data: pur } = await supabase.from('purchases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(40);
  
  console.log('Recent 25 purchases:');
  (pur || []).slice(0, 25).forEach(p => {
    console.log(`[${p.created_at}] Date: ${p.date} | Shift: ${p.shift} | SuppID: ${p.supplier_id} | Type: ${p.milk_type} | Qty: ${p.quantity} | Status: ${p.status} | Details:`, JSON.stringify(p.details));
  });
}

checkMujtabaPurchases();
