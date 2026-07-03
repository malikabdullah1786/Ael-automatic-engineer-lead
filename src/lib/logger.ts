import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Initialize a service client to bypass RLS for logging
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Server-side helper to record system events and crashes in the database.
 * Use this in try/catch blocks of API routes and Server Actions.
 */
export async function logSystemEvent(errorTrace: string, projectId?: string) {
  try {
    let targetProjectId = projectId;

    // Fallback: If no project ID is passed, assign to the first active project
    if (!targetProjectId) {
      const { data, error } = await supabase
        .from("active_projects")
        .select("project_id")
        .limit(1)
        .single();
        
      if (!error && data) {
        targetProjectId = data.project_id;
      }
    }

    if (!targetProjectId) {
      console.warn("Could not write system event: No active projects found in database.");
      return;
    }

    const { error } = await supabase
      .from("system_events")
      .insert({
        project_id: targetProjectId,
        error_trace: errorTrace,
        timestamp: new Date().toISOString()
      });

    if (error) {
      console.error("Supabase Log Write Failure:", error);
    }
  } catch (err) {
    console.error("Logger internal failure:", err);
  }
}
