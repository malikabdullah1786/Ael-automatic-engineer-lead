import { google } from "googleapis";
import { ICalendarService, MeetingDetails } from "./interfaces";

export class GoogleCalendarService implements ICalendarService {
  private oauth2Client;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    // Auto-resolve redirect URI:
    //  1. Use GOOGLE_REDIRECT_URI if explicitly set
    //  2. Use Vercel's auto-injected VERCEL_URL in production (never exposes localhost)
    //  3. Fall back to localhost for local development
    const appBaseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI || `${appBaseUrl}/oauth2callback`;

    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    if (refreshToken) {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    }
  }

  /**
   * Schedules a 30-minute sync session with the target developer.
   * Generates an automatic Google Meet video conference.
   */
  public async scheduleSyncMeeting(
    devEmail: string,
    devName: string,
    errorContext: string,
    projectName: string,
    ticketId: string,
    meetingTime?: string | null
  ): Promise<MeetingDetails> {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken || refreshToken === "your_oauth_refresh_token_for_offline_access") {
      throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
    }

    const calendar = google.calendar({ version: "v3", auth: this.oauth2Client });

    const now = new Date();
    let proposedTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    proposedTime.setMinutes(0, 0, 0); // start at top of the hour

    // Helper to adjust time to standard business hours (09:00 - 18:00) on the next available weekday
    const adjustToBusinessHours = (date: Date): Date => {
      let d = new Date(date);
      let day = d.getDay();
      let hour = d.getHours();

      if (day === 0) { // Sunday -> Monday 9 AM
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
      } else if (day === 6) { // Saturday -> Monday 9 AM
        d.setDate(d.getDate() + 2);
        d.setHours(9, 0, 0, 0);
      } else if (hour < 9) {
        d.setHours(9, 0, 0, 0);
      } else if (hour >= 18) {
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return adjustToBusinessHours(d); // Recurse to handle weekends
      }

      // Check again if we landed on a weekend day
      day = d.getDay();
      if (day === 0 || day === 6) {
        return adjustToBusinessHours(d);
      }

      return d;
    };

    const startTime = meetingTime ? new Date(meetingTime) : adjustToBusinessHours(proposedTime);
    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30-minute duration

    const eventPayload = {
      summary: `Incident Sync: ${projectName} — Ticket ${ticketId}`,
      description: `Auto-scheduled by the Autonomous Engineering Lead (AEL) Agent.\n\nReason: Intercepted system crash alert in the repository.\n\nCrash context:\n${errorContext}`,
      organizer: {
        displayName: "AEL — Autonomous Engineering Lead",
        email: process.env.GMAIL_USER || process.env.GOOGLE_CLIENT_ID,
      },
      start: {
        dateTime: startTime.toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: "UTC",
      },
      attendees: [
        { email: devEmail, displayName: devName }
      ],
      conferenceData: {
        createRequest: {
          requestId: `ael-sync-${Date.now()}`,
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId: "primary",
        requestBody: eventPayload,
        conferenceDataVersion: 1,
        sendUpdates: "all",
      });

      const event = response.data;
      const meetLink = event.hangoutLink || "";
      const eventUrl = event.htmlLink || "";

      return {
        eventId: event.id || "",
        meetLink,
        eventUrl,
        startDateTime: startTime.toISOString(),
        endDateTime: endTime.toISOString(),
      };
    } catch (error: any) {
      console.error("Google Calendar API failure:", error);
      throw error; // Let caller catch and handle with specific message codes
    }
  }

  public async scheduleTeamMeeting(
    attendees: Array<{ email: string; name: string }>,
    topic: string,
    meetingTime: string,
    durationMinutes: number
  ): Promise<MeetingDetails> {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!refreshToken || refreshToken === "your_oauth_refresh_token_for_offline_access") {
      throw new Error("GOOGLE_CALENDAR_AUTH_MISSING");
    }

    const calendar = google.calendar({ version: "v3", auth: this.oauth2Client });

    const startTime = new Date(meetingTime);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const eventPayload = {
      summary: `Team Sync: ${topic}`,
      description: `Auto-scheduled Team Sync by the Autonomous Engineering Lead (AEL) Agent.\n\nTopic: ${topic}\nDuration: ${durationMinutes} minutes`,
      organizer: {
        displayName: "AEL — Autonomous Engineering Lead",
        email: process.env.GMAIL_USER || process.env.GOOGLE_CLIENT_ID,
      },
      start: {
        dateTime: startTime.toISOString(),
        timeZone: "UTC",
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: "UTC",
      },
      attendees: attendees.map(a => ({ email: a.email, displayName: a.name })),
      conferenceData: {
        createRequest: {
          requestId: `ael-team-sync-${Date.now()}`,
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      },
    };

    try {
      const response = await calendar.events.insert({
        calendarId: "primary",
        requestBody: eventPayload,
        conferenceDataVersion: 1,
        sendUpdates: "all",
      });

      const event = response.data;
      const meetLink = event.hangoutLink || "";
      const eventUrl = event.htmlLink || "";

      return {
        eventId: event.id || "",
        meetLink,
        eventUrl,
        startDateTime: startTime.toISOString(),
        endDateTime: endTime.toISOString(),
      };
    } catch (error: any) {
      console.error("Google Calendar Team Meeting API failure:", error);
      throw error;
    }
  }
}
