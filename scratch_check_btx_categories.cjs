const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkBtxCategories() {
  const { data: btx } = await supabase.from('bank_transactions').select('type, category, amount, description, shift_session_id').limit(100);
  const categories = {};
  (btx || []).forEach(b => {
    const key = `${b.type} | ${b.category}`;
    categories[key] = (categories[key] || 0) + 1;
  });
  console.log('Bank transactions categories breakdown:', categories);
}

checkBtxCategories();
