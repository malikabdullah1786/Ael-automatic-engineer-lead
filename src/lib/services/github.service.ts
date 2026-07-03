import { Octokit } from "octokit";
import { IVersionControlService, CommitInfo } from "./interfaces";

export class GitHubService implements IVersionControlService {
  private octokit: Octokit;

  constructor() {
    const githubToken = process.env.GITHUB_PAT;
    this.octokit = new Octokit({
      auth: githubToken && githubToken !== "your_github_personal_access_token" ? githubToken : undefined,
    });
  }

  /**
   * Parses "https://github.com/owner/repo" into { owner, repo }
   */
  private parseGithubUrl(url: string): { owner: string; repo: string } | null {
    try {
      const cleanUrl = url.replace(/\.git$/, "");
      const parts = cleanUrl.split("github.com/")[1]?.split("/");
      if (parts && parts.length >= 2) {
        return { owner: parts[0], repo: parts[1] };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetches the latest N commits for a given GitHub repository URL.
   */
  public async fetchRecentCommits(repoUrl: string, limit = 10): Promise<CommitInfo[]> {
    const repoDetails = this.parseGithubUrl(repoUrl);
    if (!repoDetails) {
      throw new Error(`Invalid GitHub repository URL format: ${repoUrl}`);
    }

    const { owner, repo } = repoDetails;

    try {
      const { data: commits } = await this.octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: limit,
      });

      const commitList: CommitInfo[] = [];

      for (const item of commits) {
        try {
          const { data: detail } = await this.octokit.rest.repos.getCommit({
            owner,
            repo,
            ref: item.sha,
          });

          commitList.push({
            sha: item.sha,
            message: item.commit.message,
            authorName: item.commit.author?.name || "Unknown Author",
            githubUsername: item.author?.login || "unmapped-github-user",
            date: item.commit.author?.date || new Date().toISOString(),
            filesChanged: detail.files?.map((f) => f.filename) || [],
          });
        } catch (err) {
          commitList.push({
            sha: item.sha,
            message: item.commit.message,
            authorName: item.commit.author?.name || "Unknown Author",
            githubUsername: item.author?.login || "unmapped-github-user",
            date: item.commit.author?.date || new Date().toISOString(),
            filesChanged: [],
          });
        }
      }

      return commitList;
    } catch (error: any) {
      console.error(`GitHub API error while fetching commits for ${owner}/${repo}:`, error);
      if (error.status === 403 || error.message?.includes("rate limit")) {
        throw new Error("GITHUB_RATE_LIMIT_EXCEEDED");
      }
      if (error.status === 404) {
        // Repo doesn't exist, is private, or hasn't been linked yet — treat as no commits
        throw new Error("GITHUB_REPO_NOT_FOUND");
      }
      throw new Error(`GitHub API failure: ${error.message}`);
    }
  }
}
