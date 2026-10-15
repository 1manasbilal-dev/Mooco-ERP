const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkPurchases() {
  const pIds = [
    'b0254a67-8ccd-4756-a6ed-9b559f2ec335',
    '2b94b866-15b8-46a0-8816-e7594cae7d57',
    'b464e784-ebb5-4bfc-995b-c4484cac9199',
    'fa638c75-91a3-4700-ab14-f6d1aa5a6774',
    'c7fdf542-270a-41fd-8c4b-bf8cd8971b3b',
    'f7b1c3ae-e00d-439b-94fb-d415a12c2df6'
  ];

  const { data: purList } = await supabase.from('purchases').select('*').in('id', pIds);
  console.log('Purchases details:');
  (purList || []).forEach(p => {
    console.log(`ID: ${p.id} | Date: ${p.date} | Shift: ${p.shift} | Qty: ${p.quantity} | Total: ${p.total_amount} | created_at: ${p.created_at}`);
  });

  const { data: allocList } = await supabase.from('allocations').select('*').in('purchase_id', pIds);
  console.log('\nAllocations details:');
  (allocList || []).forEach(a => {
    console.log(`ID: ${a.id} | PurID: ${a.purchase_id} | Date: ${a.date} | Orig: ${a.original_quantity} | Rem: ${a.remaining_quantity} | Alloc: ${a.allocated_quantity} | Dest: ${a.destination} | Details:`, JSON.stringify(a.details));
  });
}

checkPurchases();
