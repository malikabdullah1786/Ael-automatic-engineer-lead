import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const isStatusColumnMissing = (msg: string) => {
  const lower = msg.toLowerCase();
  return lower.includes("status") && (lower.includes("does not exist") || lower.includes("schema cache"));
};

export async function GET(req: NextRequest) {
  try {
    let { data: projects, error } = await supabase
      .from("active_projects")
      .select("project_id, project_name, github_repo_url, status, created_at")
      .order("project_name", { ascending: true });

    if (error && isStatusColumnMissing(error.message)) {
      // Fallback: select without status column
      const fallbackRes = await supabase
        .from("active_projects")
        .select("project_id, project_name, github_repo_url, created_at")
        .order("project_name", { ascending: true });

      if (fallbackRes.error) {
        return NextResponse.json({ error: fallbackRes.error.message }, { status: 500 });
      }

      projects = (fallbackRes.data || []).map((p: any) => ({
        ...p,
        status: "active"
      }));
      error = null;
    } else if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ projects: projects || [] });
  } catch (error: any) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


export async function POST(req: NextRequest) {
  try {
    const { name, github_repo_url, status } = await req.json();

    if (!name || !github_repo_url) {
      return NextResponse.json({ error: "Missing name or github_repo_url parameters." }, { status: 400 });
    }

    const payload: any = {
      project_name: name,
      github_repo_url: github_repo_url
    };
    if (status) {
      payload.status = status;
    }

    let { data: project, error } = await supabase
      .from("active_projects")
      .insert(payload)
      .select()
      .single();

    if (error && isStatusColumnMissing(error.message)) {
      delete payload.status;
      const fallbackRes = await supabase
        .from("active_projects")
        .insert(payload)
        .select()
        .single();

      if (fallbackRes.error) {
        return NextResponse.json({ error: fallbackRes.error.message }, { status: 500 });
      }

      project = {
        ...fallbackRes.data,
        status: "active"
      };
      error = null;
    } else if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, project });
  } catch (error: any) {
    console.error("POST /api/projects error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { projectId, status } = await req.json();

    if (!projectId || !status) {
      return NextResponse.json({ error: "Missing projectId or status parameters." }, { status: 400 });
    }

    const { data: project, error } = await supabase
      .from("active_projects")
      .update({ status })
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) {
      if (error && isStatusColumnMissing(error.message)) {
        return NextResponse.json({
          error: "Database column 'status' does not exist. Please run the SQL script in your Supabase SQL editor first:\n\nALTER TABLE active_projects ADD COLUMN status VARCHAR(50) DEFAULT 'active';"
        }, { status: 400 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, project });
  } catch (error: any) {
    console.error("PATCH /api/projects error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const githubRepoUrl = searchParams.get("githubRepoUrl");

    if (!projectId && !githubRepoUrl) {
      return NextResponse.json({ error: "Missing projectId or githubRepoUrl parameter." }, { status: 400 });
    }

    let query = supabase.from("active_projects").delete();
    if (projectId) {
      query = query.eq("project_id", projectId);
    } else {
      query = query.eq("github_repo_url", githubRepoUrl);
    }

    const { error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/projects error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


