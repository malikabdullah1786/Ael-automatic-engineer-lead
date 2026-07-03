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
    if (error.message === "GITHUB_REPO_NOT_FOUND") {
      // Repo is private, deleted, or not yet linked — return empty gracefully
      console.warn("GitHub repo not found or inaccessible:", repoUrl);
      return NextResponse.json({ success: true, commits: [], warning: "Repository not found or is private. No commits available." });
    }
    console.error("Failed to fetch commits in API route:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch commits" }, { status: 500 });
  }
}
