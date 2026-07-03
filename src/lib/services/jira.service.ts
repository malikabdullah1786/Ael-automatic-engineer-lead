import { IJiraService, JiraTask, JiraWorkloadSummary } from "./interfaces";
import { supabase } from "../supabase";

export class JiraService implements IJiraService {
  /**
   * Resolves Jira configuration by checking in-memory, Supabase system_settings, and env variables.
   */
  private async getConfig(overrideConfig?: { host: string; email: string; apiToken: string }) {
    if (overrideConfig?.host && overrideConfig?.email && overrideConfig?.apiToken) {
      return this.normalizeConfig(overrideConfig);
    }

    try {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "jira_config")
        .single();

      if (data?.value) {
        const val = data.value as any;
        if (val.host && val.email && val.apiToken) {
          return this.normalizeConfig(val);
        }
      }
    } catch (err) {
      console.warn("Failed to retrieve Jira config from system_settings table, falling back to env:", err);
    }

    const host = process.env.JIRA_HOST || "";
    const email = process.env.JIRA_EMAIL || "";
    const apiToken = process.env.JIRA_API_TOKEN || "";

    return this.normalizeConfig({ host, email, apiToken });
  }

  private normalizeConfig(config: { host: string; email: string; apiToken: string }) {
    let host = config.host.trim();
    if (host && !host.startsWith("http://") && !host.startsWith("https://")) {
      host = `https://${host}`;
    }
    // Remove trailing slash
    if (host.endsWith("/")) {
      host = host.slice(0, -1);
    }
    return {
      host,
      email: config.email.trim(),
      apiToken: config.apiToken.trim(),
    };
  }

  private getAuthHeader(email: string, apiToken: string) {
    const creds = `${email}:${apiToken}`;
    return `Basic ${Buffer.from(creds).toString("base64")}`;
  }

  /**
   * Verifies the connection by querying /rest/api/3/myself.
   */
  async verifyConnection(config?: { host: string; email: string; apiToken: string }): Promise<boolean> {
    const resolved = await this.getConfig(config);
    if (!resolved.host || !resolved.email || !resolved.apiToken) {
      return false;
    }

    try {
      const res = await fetch(`${resolved.host}/rest/api/3/myself`, {
        headers: {
          Authorization: this.getAuthHeader(resolved.email, resolved.apiToken),
          Accept: "application/json",
        },
      });

      return res.status === 200;
    } catch (err) {
      console.error("Jira connection verification failed:", err);
      return false;
    }
  }

  /**
   * Finds a Jira user's account ID from their email.
   */
  private async findUserAccountId(host: string, authHeader: string, email: string): Promise<string | null> {
    try {
      const url = `${host}/rest/api/3/user/search?query=${encodeURIComponent(email)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (res.status === 200) {
        const users = await res.json();
        if (Array.isArray(users) && users.length > 0) {
          return users[0].accountId || null;
        }
      }
    } catch (err) {
      console.error(`Failed to find Jira user for email ${email}:`, err);
    }
    return null;
  }

  /**
   * Creates a task or bug issue in Jira, assigning it if the user email is resolved.
   */
  async createIssue(
    projectKey: string,
    summary: string,
    description: string,
    assigneeEmail?: string,
    config?: { host: string; email: string; apiToken: string },
    assigneeAccountId?: string
  ): Promise<{ key: string; url: string }> {
    const resolved = await this.getConfig(config);
    if (!resolved.host || !resolved.email || !resolved.apiToken) {
      throw new Error("Jira integration is not configured. Please check your credentials.");
    }

    const authHeader = this.getAuthHeader(resolved.email, resolved.apiToken);

    // Try to find user account ID
    let accountId: string | null = assigneeAccountId || null;
    if (!accountId && assigneeEmail) {
      accountId = await this.findUserAccountId(resolved.host, authHeader, assigneeEmail);
    }

    // Sanitize summary to avoid newlines and limit length (Jira limit is 255 chars)
    let cleanSummary = summary.replace(/[\r\n]+/g, " ").trim();
    if (cleanSummary.length > 250) {
      cleanSummary = cleanSummary.substring(0, 247) + "...";
    }

    const fields: any = {
      project: {
        key: projectKey.toUpperCase(),
      },
      summary: cleanSummary,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: description,
              },
            ],
          },
        ],
      },
      issuetype: {
        name: "Task", // Default fallback
      },
    };

    if (accountId) {
      fields.assignee = {
        accountId,
      };
    }

    const response = await fetch(`${resolved.host}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Jira Create Issue failed with status ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const issueKey = data.key;
    const url = `${resolved.host}/browse/${issueKey}`;

    return { key: issueKey, url };
  }

  async getAssignableUsers(
    projectKey: string,
    config?: { host: string; email: string; apiToken: string }
  ): Promise<Array<{ accountId: string; displayName: string; emailAddress?: string }>> {
    const resolved = await this.getConfig(config);
    if (!resolved.host || !resolved.email || !resolved.apiToken) {
      return [];
    }

    const authHeader = this.getAuthHeader(resolved.email, resolved.apiToken);
    const host = resolved.host.replace(/\/$/, "");
    const url = `${host}/rest/api/3/user/assignable/search?project=${projectKey.toUpperCase()}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (res.status === 200) {
        const users = await res.json();
        return (users || []).map((u: any) => ({
          accountId: u.accountId,
          displayName: u.displayName,
          emailAddress: u.emailAddress,
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch assignable users from Jira for project ${projectKey}:`, err);
    }
    return [];
  }

  /**
   * Fetches issues assigned to a developer and groups them into Completed, Overdue, and Pending.
   */
  async fetchDeveloperTasks(
    projectKey: string,
    devEmail: string,
    config?: { host: string; email: string; apiToken: string }
  ): Promise<JiraWorkloadSummary> {
    const resolved = await this.getConfig(config);
    const summary: JiraWorkloadSummary = { pending: [], completed: [], overdue: [] };

    if (!resolved.host || !resolved.email || !resolved.apiToken) {
      return summary; // Return empty lists if not configured
    }

    summary.configured = true;

    const authHeader = this.getAuthHeader(resolved.email, resolved.apiToken);

    // Resolve user account ID
    const accountId = await this.findUserAccountId(resolved.host, authHeader, devEmail);
    
    // Construct JQL
    // Filter by project and assignee. If account ID was not resolved, try searching by email directly in JQL.
    const assigneeFilter = accountId ? `assignee = "${accountId}"` : `assignee = "${devEmail}"`;
    const jql = `project = "${projectKey.toUpperCase()}" AND ${assigneeFilter}`;

    try {
      const searchUrl = `${resolved.host}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key,summary,status,duedate,created&maxResults=100`;
      const response = await fetch(searchUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        console.error("Jira search query failed:", await response.text());
        return summary;
      }

      const searchResult = await response.json();
      const issues = searchResult.issues || [];
      const now = new Date();

      for (const issue of issues) {
        const fields = issue.fields || {};
        const statusName = (fields.status?.name || "").toLowerCase();
        const statusCategory = (fields.status?.statusCategory?.name || "").toLowerCase();
        const dueDateStr = fields.duedate; // YYYY-MM-DD
        const createdStr = fields.created;

        const task: JiraTask = {
          key: issue.key,
          summary: fields.summary || "No Summary",
          status: fields.status?.name || "Unknown",
          dueDate: dueDateStr || null,
          created: createdStr || null,
          url: `${resolved.host}/browse/${issue.key}`,
        };

        // Determine category
        const isCompleted = statusCategory === "done" || statusName === "done" || statusName === "resolved" || statusName === "closed";
        
        if (isCompleted) {
          summary.completed.push(task);
        } else if (dueDateStr) {
          const dueDate = new Date(dueDateStr);
          // Set due date to end of day to be fair
          dueDate.setHours(23, 59, 59, 999);
          if (dueDate < now) {
            summary.overdue.push(task);
          } else {
            summary.pending.push(task);
          }
        } else {
          summary.pending.push(task);
        }
      }
    } catch (err) {
      console.error("Error fetching tasks from Jira:", err);
    }

    return summary;
  }
}
