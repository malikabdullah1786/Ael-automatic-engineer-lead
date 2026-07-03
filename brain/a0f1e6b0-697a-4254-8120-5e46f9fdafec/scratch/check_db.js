const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'f:\\z361\\.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('incident_tickets')
    .select('*')
    .limit(1);

  if (error) {
    console.error("Error querying incident_tickets:", error);
  } else {
    console.log("incident_tickets structure:", data);
  }
}

check();
