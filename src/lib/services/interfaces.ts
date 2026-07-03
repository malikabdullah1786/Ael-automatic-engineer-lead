export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  githubUsername: string;
  date: string;
  filesChanged: string[];
}

export interface MeetingDetails {
  eventId: string;
  meetLink: string;
  startDateTime: string;
  endDateTime: string;
  eventUrl?: string;
}

/**
 * DIP Interface for Version Control operations
 */
export interface IVersionControlService {
  fetchRecentCommits(repoUrl: string, limit?: number): Promise<CommitInfo[]>;
}

/**
 * DIP Interface for Calendar and Scheduling operations
 */
export interface ICalendarService {
  scheduleSyncMeeting(
    devEmail: string,
    devName: string,
    errorContext: string,
    projectName: string,
    ticketId: string,
    meetingTime?: string | null
  ): Promise<MeetingDetails>;
}

export interface JiraTask {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  created: string;
  url: string;
}

export interface JiraWorkloadSummary {
  pending: JiraTask[];
  completed: JiraTask[];
  overdue: JiraTask[];
  configured?: boolean;
}

/**
 * DIP Interface for Jira operations
 */
export interface IJiraService {
  verifyConnection(config?: { host: string; email: string; apiToken: string }): Promise<boolean>;
  createIssue(
    projectKey: string,
    summary: string,
    description: string,
    assigneeEmail?: string,
    config?: { host: string; email: string; apiToken: string },
    assigneeAccountId?: string
  ): Promise<{ key: string; url: string }>;
  fetchDeveloperTasks(
    projectKey: string,
    devEmail: string,
    config?: { host: string; email: string; apiToken: string }
  ): Promise<JiraWorkloadSummary>;
  getAssignableUsers(
    projectKey: string,
    config?: { host: string; email: string; apiToken: string }
  ): Promise<Array<{ accountId: string; displayName: string; emailAddress?: string }>>;
}
