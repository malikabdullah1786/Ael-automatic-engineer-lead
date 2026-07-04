import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Initialize Supabase Client using Service Role to bypass Row Level Security (RLS) for server logs
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Secret token to authenticate Vercel request
const LOG_DRAIN_SECRET = process.env.VERCEL_LOG_DRAIN_SECRET || "default_local_secret";

/**
 * Verify HMAC SHA1 signature from Vercel Log Drains
 */
function verifySignature(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  
  const hmac = crypto.createHmac("sha1", LOG_DRAIN_SECRET);
  hmac.update(payload);
  const digest = hmac.digest("hex");
  
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-vercel-signature");

    // 1. Authenticate webhook
    // Support either Vercel signature verification OR a simple secure URL query token
    const querySecret = req.nextUrl.searchParams.get("secret");
    const isAuthorized = 
      (querySecret && querySecret === LOG_DRAIN_SECRET) || 
      verifySignature(rawBody, signature);

    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse logs (Vercel sends log events as an array of JSON objects)
    const logs = JSON.parse(rawBody);
    if (!Array.isArray(logs)) {
      return NextResponse.json({ error: "Invalid log payload format" }, { status: 400 });
    }

    const systemEventsToInsert = [];

    // 3. Process each log line
    for (const log of logs) {
      // Vercel Log Types: 'stdout', 'stderr', 'system' (errors are typically in stderr or system type)
      // Look for indicators of server crashes, stack traces, unhandled exceptions
      const isErrorLog = 
        log.source === "stderr" || 
        (log.proxy && log.proxy.statusCode >= 500) ||
        (log.message && (
          log.message.includes("ERROR") || 
          log.message.includes("Exception") || 
          log.message.includes("UnhandledRejection") || 
          log.message.includes("FATAL") ||
          log.message.includes("Crash")
        ));

      if (isErrorLog) {
        // Attempt to find the project ID matching this domain or vercel project name
        const hostName = log.host || "";
        const projectId = await resolveProjectIdForLog(log.projectId, hostName);

        if (projectId) {
          systemEventsToInsert.push({
            project_id: projectId,
            error_trace: `[Vercel Log Drain] Host: ${hostName}\nSource: ${log.source}\nLog Message:\n${log.message}`,
            timestamp: log.timestamp ? new Date(log.timestamp).toISOString() : new Date().toISOString()
          });
        }
      }
    }

    // 4. Batch insert occurrences into system_events
    if (systemEventsToInsert.length > 0) {
      const { error } = await supabase
        .from("system_events")
        .insert(systemEventsToInsert);

      if (error) {
        console.error("Supabase Log Insertion Error:", error);
        return NextResponse.json({ error: "Database save failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ 
      success: true, 
      processed: logs.length, 
      loggedErrors: systemEventsToInsert.length 
    });

  } catch (error: any) {
    console.error("Vercel Log Drain Endpoint Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Resolves the project_id in our database based on Vercel's projectId or host domain name
 */
async function resolveProjectIdForLog(vercelProjectId: string | undefined, hostName: string): Promise<string | null> {
  // Query active projects. You can match by name, a metadata field, or github repo url.
  // In this implementation, we check if the domain contains the project name or repository slug
  const { data: projects, error } = await supabase
    .from("active_projects")
    .select("project_id, project_name, github_repo_url");

  if (error || !projects || projects.length === 0) {
    return null;
  }

  // Attempt to match the project based on domain hostname or fall back to the first active project
  for (const project of projects) {
    const cleanProjName = project.project_name.toLowerCase().replace(/\s+/g, "-");
    if (hostName.includes(cleanProjName)) {
      return project.project_id;
    }
  }

  // Fallback default: Return the first active project to ensure the event is logged
  return projects[0].project_id;
}
