import { supabase } from "../../../src/lib/supabase";

async function debug() {
  console.log("Querying team_members...");
  const { data: team, error: teamErr } = await supabase.from("team_members").select("*");
  if (teamErr) console.error("teamErr:", teamErr);
  else console.log("Team members:", team);

  console.log("Querying incident_tickets...");
  const { data: tickets, error: ticketErr } = await supabase.from("incident_tickets").select("*");
  if (ticketErr) console.error("ticketErr:", ticketErr);
  else console.log("Tickets:", tickets);
}

debug();
