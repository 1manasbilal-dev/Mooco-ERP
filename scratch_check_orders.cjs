const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkOrders() {
  const { data, error } = await supabase.from('customer_orders').select('*').limit(20);
  if (error) {
    console.log('Error customer_orders:', error.message);
  } else {
    console.log('Total customer_orders:', data?.length);
    (data || []).forEach(o => console.log(o.id, o.order_number, o.status, o.due_date, JSON.stringify(o.items)));
  }
}

checkOrders();
