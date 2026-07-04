import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req: NextRequest) {
  try {
    const { data: logs, error } = await supabase
      .from("system_events")
      .select(`
        event_id,
        project_id,
        error_trace,
        timestamp,
        active_projects (
          project_name
        )
      `)
      .order("timestamp", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logs: logs || [] });
  } catch (error: any) {
    console.error("GET /api/logs error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Get the first active project ID to link the event
    const { data: projects, error: projError } = await supabase
      .from("active_projects")
      .select("project_id")
      .limit(1);

    if (projError) {
      return NextResponse.json({ error: projError.message }, { status: 500 });
    }

    if (!projects || projects.length === 0) {
      return NextResponse.json({ 
        error: "No active projects found in database. Please run the DDL schema file with seed data in Supabase first." 
      }, { status: 400 });
    }

    const projectId = projects[0].project_id;

    // 2. Select a random diagnostic error message
    const mockErrors = [
      "FATAL: database system is shutting down. Connection refused at index.js:42. Connection pool exhausted for pg_pool.",
      "TypeError: Cannot read properties of undefined (reading 'split') at PaymentService.ts:182:14. Failed processing checkout token.",
      "AxiosError: Request failed with status code 503 Service Unavailable at GitHubClient.ts:98. GitHub API quota exceeded.",
      "OutOfMemoryError: JavaScript heap out of memory in Next.js Serverless runtime container.",
      "GoogleApiError: Unauthorized OAuth scope requested. Unable to write events to Google Calendar. Permission Denied.",
      "GitHubWebhookError: Signature verification failed. Event payload rejected."
    ];
    const randomError = mockErrors[Math.floor(Math.random() * mockErrors.length)];

    // 3. Write dummy crash event
    const { error: insertError } = await supabase
      .from("system_events")
      .insert({
        project_id: projectId,
        error_trace: `[System Diagnostics Alert]\nLocation: production-server-lambda\nTrace:\n${randomError}`,
        timestamp: new Date().toISOString()
      });

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/logs error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
