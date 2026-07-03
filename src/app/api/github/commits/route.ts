import { NextRequest, NextResponse } from "next/server";
import { services } from "@/lib/services/container";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const repoUrl = searchParams.get("repoUrl");

  if (!repoUrl) {
    return NextResponse.json({ error: "Missing repoUrl parameter" }, { status: 400 });
  }

  try {
    const commits = await services.githubService.fetchRecentCommits(repoUrl, 10);
    return NextResponse.json({ success: true, commits });
  } catch (error: any) {
    console.error("Failed to fetch commits in API route:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch commits" }, { status: 500 });
  }
}
