import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email_address, github_username, role } = body;

    if (!name || !email_address) {
      return NextResponse.json(
        { error: "Name and Email Address are required." },
        { status: 400 }
      );
    }

    const dev_id = crypto.randomUUID();

    const { data, error } = await supabase
      .from("team_members")
      .insert([
        {
          dev_id,
          name,
          email_address,
          github_username: github_username || null,
          role: role || "Developer",
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ member: data, success: true });
  } catch (error: any) {
    console.error("POST /api/team error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
