const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkTodayBatches() {
  const { data: batches } = await supabase.from('production_batches')
    .select('*')
    .gte('created_at', '2026-10-07T00:00:00Z');
  
  console.log(`Batches created on Oct 7: ${batches?.length}`);
  (batches || []).forEach(b => {
    console.log(`[${b.created_at}] Batch: ${b.batch_number} | Product: ${b.product_name} | Qty In: ${b.quantity_input} | Status: ${b.status} | Details:`, JSON.stringify(b.details));
  });
}

checkTodayBatches();
