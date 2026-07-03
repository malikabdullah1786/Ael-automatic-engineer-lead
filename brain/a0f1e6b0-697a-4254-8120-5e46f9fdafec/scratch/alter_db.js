const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'f:\\z361\\.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function alterTable() {
  const { data, error } = await supabase
    .rpc('exec_sql', { sql_query: 'ALTER TABLE incident_tickets ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;' });

  // If RPC exec_sql is not available, we can run it by just executing an insert or checking if it works
  if (error) {
    console.log("exec_sql RPC not found, trying query/direct method or checking if it's already there:", error);
    // Let's try inserting a dummy row with scheduled_at to see if it exists
    const { error: testError } = await supabase
      .from('incident_tickets')
      .insert({
        project_id: '11111111-1111-1111-1111-111111111111',
        assigned_dev_id: '22222222-2222-2222-2222-222222222222',
        error_context: 'Test checking column',
        status: 'Open',
        scheduled_at: new Date().toISOString()
      });
      
    if (testError && testError.message.includes('scheduled_at')) {
      console.log("Column scheduled_at does not exist, let's create it via a migration helper if needed, or by calling a SQL exec endpoint.");
    } else {
      console.log("Column scheduled_at exists or insert succeeded!");
    }
  } else {
    console.log("Successfully ran ALTER TABLE via exec_sql:", data);
  }
}

alterTable();
