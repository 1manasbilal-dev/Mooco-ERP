const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function run() {
  const { data: sales, error } = await supabase.from('sales')
    .select('id, bill_number, date, created_at, total, payment_mode, shift_session_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error:', error);
    return;
  }

  const today = '2026-09-23';
  const todaySales = sales.filter(s => s.date && s.date.startsWith(today));
  console.log('Today sales count:', todaySales.length);

  const olderShiftSales = todaySales.filter(s => s.shift_session_id !== 'shift_2026-09-23_e5f2586c-f5f');
  console.log('Sales today NOT in active shift:', olderShiftSales.length);
  console.log('Sample:', olderShiftSales.slice(0, 3));

  // Check the active shift start time
  const { data: shifts } = await supabase.from('cash_shifts').select('*').eq('id', 'shift_2026-09-23_e5f2586c-f5f');
  console.log('Active shift:', shifts[0]);
}

run();
