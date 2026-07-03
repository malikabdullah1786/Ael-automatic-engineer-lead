const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function printTeam() {
  const { data: members, error } = await supabase
    .from("team_members")
    .select("*");
  
  if (error) {
    console.error("Error fetching team members:", error);
    return;
  }

  console.log("--- Team Members in DB ---");
  console.log(JSON.stringify(members, null, 2));

  const { data: tasks, error: taskErr } = await supabase
    .from("sprint_tasks")
    .select("*");
  
  if (taskErr) {
    console.error("Error fetching sprint tasks:", taskErr);
    return;
  }

  console.log("\n--- Sprint Tasks in DB ---");
  console.log(JSON.stringify(tasks, null, 2));
}

printTeam();
