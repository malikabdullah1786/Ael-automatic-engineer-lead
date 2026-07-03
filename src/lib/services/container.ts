import { GitHubService } from "./github.service";
import { GoogleCalendarService } from "./calendar.service";
import { IVersionControlService, ICalendarService } from "./interfaces";

class ServiceContainer {
  public githubService: IVersionControlService;
  public calendarService: ICalendarService;

  constructor() {
    this.githubService = new GitHubService();
    this.calendarService = new GoogleCalendarService();
  }
}

export const services = new ServiceContainer();
export type { IVersionControlService, ICalendarService };
export * from "./interfaces";
