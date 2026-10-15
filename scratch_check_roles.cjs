const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://kawpusbgmsfbhlmrpfjo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthd3B1c2JnbXNmYmhsbXJwZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzkzNDgsImV4cCI6MjA5NTcxNTM0OH0.C7e5Kq4IGKfW2os8MZ-4I1rtFAhdAWstFx36nhpUrCE'
);

async function checkRoles() {
  const { data: roles } = await supabase.from('app_roles').select('*');
  console.log('Roles:', JSON.stringify(roles, null, 2));

  const { data: users } = await supabase.from('app_users').select('id, name, username, role_id');
  console.log('Users:', JSON.stringify(users, null, 2));
}

checkRoles();
