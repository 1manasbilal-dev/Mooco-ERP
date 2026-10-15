const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function check() {
  const { data: accounts } = await supabase.from('financial_accounts').select('*');
  console.log('--- FINANCIAL ACCOUNTS ---');
  console.table((accounts || []).map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance, isDrawer: a.isDrawer, is_drawer: a.is_drawer, data: a.data })));

  const { data: drawers } = await supabase.from('cash_drawers').select('*');
  console.log('--- CASH DRAWERS ---');
  console.table(drawers);

  const { data: handovers } = await supabase.from('drawer_handovers').select('*');
  console.log('--- HANDOVERS ---');
  console.table(handovers);

  const { data: shifts } = await supabase.from('cash_shifts').select('*').order('started_at', { ascending: false }).limit(5);
  console.log('--- RECENT SHIFTS ---');
  console.table(shifts);
}

check().catch(console.error);
