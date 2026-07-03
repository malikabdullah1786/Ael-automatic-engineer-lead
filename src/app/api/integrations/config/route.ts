import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "jira_config")
      .single();

    if (error && error.code !== "PGRST116") { // PGRST116 is code for no rows returned
      throw error;
    }

    if (!data?.value) {
      // Check environment variables as fallback
      const envHost = process.env.JIRA_HOST || "";
      const envEmail = process.env.JIRA_EMAIL || "";
      const envToken = process.env.JIRA_API_TOKEN || "";

      if (envHost && envEmail) {
        return NextResponse.json({
          host: envHost,
          email: envEmail,
          hasToken: !!envToken,
        });
      }

      return NextResponse.json({
        host: "",
        email: "",
        hasToken: false,
      });
    }

    const val = data.value as any;
    return NextResponse.json({
      host: val.host || "",
      email: val.email || "",
      hasToken: !!val.apiToken,
    });
  } catch (err: any) {
    console.error("GET /api/integrations/config error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { error } = await supabase
      .from("system_settings")
      .delete()
      .eq("key", "jira_config");

    if (error) throw error;

    return NextResponse.json({ ok: true, message: "Jira integration configuration removed successfully." });
  } catch (err: any) {
    console.error("DELETE /api/integrations/config error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
