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
  console.log("Jira email:", config.email);

  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json"
  };

  const devEmails = ["malikabdullahfast@gmail.com", "malikabdullah1786@gmail.com", "instaflowauto@gmail.com"];
  
  for (const email of devEmails) {
    console.log(`\n--- Searching user in Jira for email: ${email} ---`);
    const searchUrl = `${config.host.replace(/\/$/, "")}/rest/api/3/user/search?query=${encodeURIComponent(email)}`;
    const res = await fetch(searchUrl, { headers });
    if (res.status === 200) {
      const users = await res.json();
      console.log(`Users found for ${email}:`, JSON.stringify(users, null, 2));
      if (users.length > 0) {
        const accountId = users[0].accountId;
        // Search issues
        const jql = `project = "AEL" AND assignee = "${accountId}"`;
        const searchUrl = `${config.host.replace(/\/$/, "")}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key,summary,status,duedate,created`;
        console.log(`Searching via GET JQL: ${searchUrl}`);
        const searchRes = await fetch(searchUrl, {
          method: "GET",
          headers
        });
        if (searchRes.status === 200) {
          const results = await searchRes.json();
          console.log(`Issues found for ${email}:`, results.issues?.map(i => ({ key: i.key, summary: i.fields.summary, status: i.fields.status.name, duedate: i.fields.duedate })));
        } else {
          console.log(`Failed to search issues: ${searchRes.status}`, await searchRes.text());
        }
      }
    } else {
      console.log(`Failed to search user: ${res.status}`, await res.text());
    }
  }
}

check();
