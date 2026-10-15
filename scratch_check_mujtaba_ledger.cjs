const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkMujtabaLedger() {
  const { data: supp } = await supabase.from('suppliers').select('*').ilike('name', '%Mujtaba%');
  console.log('Suppliers:', supp);

  const suppIds = (supp || []).map(s => s.id);
  const { data: pur } = await supabase.from('purchases').select('*').in('supplier_id', suppIds).order('created_at', { ascending: false }).limit(20);
  console.log('\nMujtaba Purchases:');
  pur.forEach(p => {
    console.log(`[${p.created_at}] Date: ${p.date} | Shift: ${p.shift} | Supp: ${p.details?.supplier_name} | Qty: ${p.quantity} | Rate: ${p.rate} | Total: ${p.total_amount} | Status: ${p.status}`);
  });
}

checkMujtabaLedger();
