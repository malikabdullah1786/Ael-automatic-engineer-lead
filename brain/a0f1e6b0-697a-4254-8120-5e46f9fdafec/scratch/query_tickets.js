const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: "f:\\z361\\.env.local" });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: tickets, error } = await supabase
    .from("incident_tickets")
    .select("ticket_id, error_context, assigned_dev_id, status");
  if (error) {
    console.error("Error fetching tickets:", error);
    return;
  }
  console.log("Tickets count:", tickets.length);
  tickets.forEach(t => {
    console.log(`ID: ${t.ticket_id}, Status: ${t.status}, Context: "${t.error_context}"`);
  });
}

run();
