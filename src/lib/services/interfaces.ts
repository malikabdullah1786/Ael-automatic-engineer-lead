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
    ticketId: string
  ): Promise<MeetingDetails>;
}
