import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: NextRequest) {
  try {
    const { data: team, error } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username, role, created_at")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ team: team || [] });
  } catch (error: any) {
    console.error("GET /api/team error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
