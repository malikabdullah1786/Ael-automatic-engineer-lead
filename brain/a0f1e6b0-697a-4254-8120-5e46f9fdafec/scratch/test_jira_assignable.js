const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function check() {
  const { data: configData } = await supabase
    .from("system_settings")
    .select("*")
    .eq("key", "jira_config")
    .single();

  const config = configData.value;
  console.log("Jira host:", config.host);

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json"
  };

  const url = `${config.host.replace(/\/$/, "")}/rest/api/3/user/assignable/search?project=AEL`;
  const res = await fetch(url, { headers });
  console.log("Status:", res.status);
  if (res.status === 200) {
    const users = await res.json();
    console.log("Assignable Users:", JSON.stringify(users, null, 2));
  } else {
    console.log("Error:", await res.text());
  }
}

check();
