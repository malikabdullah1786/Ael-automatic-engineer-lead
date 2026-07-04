import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // ─── 1. Total system_events (= "DB Queries" proxy) ─────────────────────────
    const { count: totalEvents, error: eventsErr } = await supabase
      .from("system_events")
      .select("*", { count: "exact", head: true });

    if (eventsErr) throw new Error(eventsErr.message);

    // ─── 2. Total sprint_tasks ───────────────────────────────────────────────────
    const { count: totalTasks, error: tasksErr } = await supabase
      .from("sprint_tasks")
      .select("*", { count: "exact", head: true });

    if (tasksErr) throw new Error(tasksErr.message);

    // ─── 3. Total team_members ───────────────────────────────────────────────────
    const { count: totalMembers, error: membersErr } = await supabase
      .from("team_members")
      .select("*", { count: "exact", head: true });

    if (membersErr) throw new Error(membersErr.message);

    // ─── 4. Total active_projects ────────────────────────────────────────────────
    const { count: totalProjects, error: projErr } = await supabase
      .from("active_projects")
      .select("*", { count: "exact", head: true });

    if (projErr) throw new Error(projErr.message);

    // ─── 5. Hourly system events for the last 24 hours (for chart) ───────────────
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentEvents, error: recentErr } = await supabase
      .from("system_events")
      .select("timestamp")
      .gte("timestamp", since)
      .order("timestamp", { ascending: true });

    if (recentErr) throw new Error(recentErr.message);

    // Bucket events into 24 hourly slots
    const hourlyCounts: number[] = Array(24).fill(0);
    const now = Date.now();

    (recentEvents || []).forEach((event) => {
      const eventTime = new Date(event.timestamp).getTime();
      const hoursAgo = Math.floor((now - eventTime) / (60 * 60 * 1000));
      const slotIndex = 23 - Math.min(hoursAgo, 23); // index 0 = 23h ago, 23 = now
      hourlyCounts[slotIndex] += 1;
    });

    // ─── 6. Overdue tasks count ──────────────────────────────────────────────────
    const { count: overdueTasks, error: overdueErr } = await supabase
      .from("sprint_tasks")
      .select("*", { count: "exact", head: true })
      .neq("status", "Completed")
      .lt("due_date", new Date().toISOString());

    if (overdueErr) throw new Error(overdueErr.message);

    // ─── 7. Last 7-day event counts for week-over-week ──────────────────────────
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { count: thisWeekEvents } = await supabase
      .from("system_events")
      .select("*", { count: "exact", head: true })
      .gte("timestamp", oneWeekAgo);

    const { count: lastWeekEvents } = await supabase
      .from("system_events")
      .select("*", { count: "exact", head: true })
      .gte("timestamp", twoWeeksAgo)
      .lt("timestamp", oneWeekAgo);

    // Calculate week-over-week percentage change
    const lastWeekCount = lastWeekEvents ?? 0;
    const thisWeekCount = thisWeekEvents ?? 0;
    let weeklyChangePercent = 0;
    if (lastWeekCount > 0) {
      weeklyChangePercent = Math.round(
        ((thisWeekCount - lastWeekCount) / lastWeekCount) * 100
      );
    } else if (thisWeekCount > 0) {
      // If last week was 0 and this week is > 0, calculate increase relative to 1 baseline
      weeklyChangePercent = thisWeekCount * 100;
    }

    return NextResponse.json({
      totalEvents: totalEvents ?? 0,
      totalTasks: totalTasks ?? 0,
      totalMembers: totalMembers ?? 0,
      totalProjects: totalProjects ?? 0,
      overdueTasks: overdueTasks ?? 0,
      thisWeekEvents: thisWeekEvents ?? 0,
      lastWeekEvents: lastWeekEvents ?? 0,
      weeklyChangePercent,
      hourlyCounts,   // array[24] for the bar chart
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("GET /api/usage error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
