import { NextResponse } from "next/server";

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  updated_at: string;
  pushed_at: string;
}

// GET /api/github/repos
// Fetches all repositories accessible to the authenticated GitHub PAT
export async function GET() {
  try {
    const pat = process.env.GITHUB_PAT;
    if (!pat) {
      return NextResponse.json(
        { error: "GITHUB_PAT is not configured in environment variables." },
        { status: 400 }
      );
    }

    // Fetch all repos (user + org) — paginate up to 100
    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member",
      {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AEL-Agent/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Don't cache — always fresh
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json(
        { error: `GitHub API error: ${err.message}` },
        { status: res.status }
      );
    }

    const repos: GitHubRepo[] = await res.json();

    // Return a slimmed-down shape — only what the UI needs
    const mapped = repos.map((r) => ({
      id: r.id,
      name: r.name,
      full_name: r.full_name,
      html_url: r.html_url,
      description: r.description,
      private: r.private,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      open_issues: r.open_issues_count,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
      pushed_at: r.pushed_at,
    }));

    return NextResponse.json({ repos: mapped, count: mapped.length });
  } catch (err: any) {
    console.error("GET /api/github/repos error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
