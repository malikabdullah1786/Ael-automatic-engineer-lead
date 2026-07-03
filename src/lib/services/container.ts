import { GitHubService } from "./github.service";
import { GoogleCalendarService } from "./calendar.service";
import { JiraService } from "./jira.service";
import { IVersionControlService, ICalendarService, IJiraService } from "./interfaces";

class ServiceContainer {
  public githubService: IVersionControlService;
  public calendarService: ICalendarService;
  public jiraService: IJiraService;

  constructor() {
    this.githubService = new GitHubService();
    this.calendarService = new GoogleCalendarService();
    this.jiraService = new JiraService();
  }
}

export const services = new ServiceContainer();
export type { IVersionControlService, ICalendarService, IJiraService };
export * from "./interfaces";
