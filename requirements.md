# Requirements Document

## Introduction

The Autonomous Engineering Lead (AEL) Agent is a full-stack, AI-powered web application that operates as a virtual Site Reliability Engineer (SRE) and Scrum Master. It is built on a Next.js frontend with a LangGraph.js-powered agent backend, a Supabase (PostgreSQL) persistence layer, and Google Gemini as the LLM engine. Users interact with the AEL through a chat interface, where the agent autonomously ingests system alerts, fetches relevant GitHub commit history, semantically triages root causes, resolves developer identities, logs incident tickets, and schedules remediation sync meetings via Google Calendar. A secondary capability enables daily standup and sprint triage — surfacing overdue tasks, workload pressure, and proactively suggesting follow-up actions. The system is deployed to Vercel and accessible publicly without private setup.

---

## Glossary

- **AEL (Autonomous Engineering Lead)**: The AI agent system described by this document.
- **Agent**: The LangGraph.js StateGraph that orchestrates tool calls, LLM reasoning, and conditional routing.
- **StateGraph**: The LangGraph construct that models the agent's execution as a directed graph of nodes and conditional edges.
- **LLM**: Large Language Model — Google Gemini API in this system.
- **Tool**: A discrete, callable function registered with the Agent (e.g., GitHub fetch, DB query, Calendar invite).
- **Checkpointer**: The LangGraph mechanism that persists intermediate Agent state to Supabase, enabling multi-turn conversations.
- **System_Event**: A row in the `system_events` table representing a critical infrastructure alert for a monitored project.
- **Incident_Ticket**: A row in the `incident_tickets` table recording the root-cause analysis, assignee, and resolution status of a triaged System_Event.
- **Sprint_Task**: A row in the `sprint_tasks` table representing a unit of developer work within a sprint, with priority and due date.
- **Team_Member**: A row in the `team_members` table mapping a developer's corporate email address to their GitHub username.
- **Active_Project**: A row in the `active_projects` table representing a monitored software project and its GitHub repository URL.
- **Golden Path**: The primary end-to-end workflow: alert ingestion → commit fetch → semantic triage → identity resolution → incident logging → meeting scheduling.
- **Human-in-the-Loop (HITL)**: A checkpoint in the Agent workflow where the Agent pauses and requests explicit user confirmation before taking an irreversible action.
- **Semantic Mismatch**: The condition where the LLM concludes that no recent commit is causally related to the triaged System_Event.
- **Identity Gap**: The condition where a GitHub username identified during triage has no corresponding entry in the `team_members` table.
- **Overload Condition**: The condition where a Team_Member has three or more critical Sprint_Tasks with a status of 'Pending' or 'In Progress' whose `due_date` is earlier than the current timestamp.
- **Chat_Interface**: The frontend UI component through which the user sends messages to and receives responses from the Agent.
- **PAT**: Personal Access Token — the credential used to authenticate GitHub REST API read-only requests.
- **OAuth**: The authentication flow used to obtain credentials for Google Workspace Calendar and Meet APIs.

---

## Requirements

### Requirement 1: Chat Interface

**User Story:** As a user, I want to interact with the AEL Agent through a conversational chat interface, so that I can issue commands and receive structured responses without leaving a single page.

#### Acceptance Criteria

1. THE Chat_Interface SHALL render a scrollable message history that displays all user messages and Agent responses for the current session.
2. THE Chat_Interface SHALL provide a text input field and a send control that submits the user's message to the Agent.
3. WHEN the user submits a message, THE Chat_Interface SHALL display a loading indicator until the Agent returns a response.
4. WHEN the Agent returns a response, THE Chat_Interface SHALL append the response to the message history and scroll to the most recent message.
5. WHEN the Agent requests Human-in-the-Loop confirmation, THE Chat_Interface SHALL display the Agent's confirmation prompt along with "Confirm" and "Cancel" action controls.
6. IF the user selects "Cancel" on a HITL prompt, THEN THE Agent SHALL abandon the pending action and inform the user that the action was cancelled.
7. THE Chat_Interface SHALL render Agent responses that contain structured data (such as task lists or incident summaries) in a readable formatted layout.
8. THE Chat_Interface SHALL be fully operable using keyboard navigation only, with all interactive controls reachable via the Tab key and activatable via the Enter or Space key.

---

### Requirement 2: Agent Orchestration Framework

**User Story:** As a developer deploying the AEL, I want the agent's reasoning and tool-use to be modelled as a stateful directed graph, so that complex multi-step workflows are deterministic, inspectable, and resumable.

#### Acceptance Criteria

1. THE Agent SHALL be implemented as a LangGraph.js StateGraph with discrete nodes for each processing step (event ingestion, commit fetch, semantic triage, identity resolution, HITL confirmation, incident logging, and meeting scheduling).
2. THE Agent SHALL use conditional edges to route execution between nodes based on the output of each node (e.g., routing to the Semantic Mismatch path when the LLM finds no causal commit).
3. THE Agent SHALL persist its intermediate state after every node execution using a Supabase-backed Checkpointer, so that a multi-turn conversation can resume from the last completed node.
4. WHEN the Agent encounters an unhandled exception within any node, THE Agent SHALL catch the exception, log the error details, and return a user-facing message describing the failure without exposing internal stack traces.
5. THE Agent SHALL expose its tool set to the LLM as structured function-calling definitions so that the LLM can select and invoke the correct tool for each step.

---

### Requirement 3: System Event Ingestion

**User Story:** As a user, I want the AEL Agent to automatically identify the most recent unresolved system alert, so that I can initiate incident triage without manually locating the alert.

#### Acceptance Criteria

1. WHEN the user requests incident triage without specifying an event, THE Agent SHALL query the `system_events` table for the most recent System_Event whose `event_id` does not appear as a `project_id` reference in an Incident_Ticket with status 'Open' or 'Resolved'.
2. WHEN a qualifying System_Event is found, THE Agent SHALL extract the `error_trace`, associated `project_id`, and `timestamp` and pass them to the next workflow node.
3. WHEN no unresolved System_Event exists in the database, THE Agent SHALL respond to the user with the message: "All systems are fully operational."
4. THE Agent SHALL NOT modify the `system_events` table during ingestion; the table is read-only from the Agent's perspective.

---

### Requirement 4: GitHub Commit Fetching

**User Story:** As a user, I want the AEL Agent to retrieve the most recent commits for the affected project's repository, so that the LLM has the necessary context to perform root-cause analysis.

#### Acceptance Criteria

1. WHEN a System_Event has been ingested, THE Agent SHALL look up the `github_repo_url` for the associated Active_Project from the `active_projects` table.
2. WHEN the `github_repo_url` is available, THE Agent SHALL call the GitHub REST API using a PAT to fetch the 10 most recent commits on the default branch of that repository.
3. THE GitHub_Fetch_Tool SHALL include each commit's SHA, author username, commit message, and ISO 8601 timestamp in the data passed to the LLM.
4. IF the GitHub REST API returns a 4xx or 5xx HTTP status code, THEN THE Agent SHALL catch the error and relay the message: "GitHub API request failed. Proceeding with triage using the error trace alone."
5. IF the GitHub REST API rate limit is exceeded, THEN THE Agent SHALL detect the 429 status code and relay the message: "GitHub API rate limit reached. Proceeding with triage using the error trace alone."
6. THE GitHub_Fetch_Tool SHALL be read-only and SHALL NOT create, update, or delete any resource in the GitHub repository.

---

### Requirement 5: Semantic Triage

**User Story:** As a user, I want the AEL Agent to use AI to determine which recent commit most likely caused the system alert, so that I receive a root-cause analysis without manually reviewing commit logs.

#### Acceptance Criteria

1. WHEN commit data and a System_Event `error_trace` are both available, THE Agent SHALL submit a structured prompt to the LLM containing the `error_trace` and the list of commit messages, authors, and timestamps.
2. THE LLM SHALL return a structured triage result that includes: the SHA of the most likely causal commit, the associated GitHub author username, a confidence assessment, and a human-readable explanation.
3. WHEN the LLM determines that no recent commit is causally related to the `error_trace`, THE Agent SHALL set the triage result to Semantic Mismatch and respond to the user: "No recent commits match this error trace. This appears to be an infrastructure-level failure."
4. WHEN a Semantic Mismatch is detected, THE Agent SHALL log an Incident_Ticket with `assigned_dev_id` set to NULL and status 'Open', then end the Golden Path workflow for that event.
5. THE Agent SHALL NOT proceed to identity resolution when a Semantic Mismatch is detected.

---

### Requirement 6: Developer Identity Resolution

**User Story:** As a user, I want the AEL Agent to automatically map the responsible GitHub username to a corporate email address, so that the correct developer receives the incident notification and meeting invite.

#### Acceptance Criteria

1. WHEN the semantic triage identifies a causal GitHub author username, THE Agent SHALL query the `team_members` table for the row where `github_username` matches the identified username.
2. WHEN a matching Team_Member is found, THE Agent SHALL extract the `email_address` and `dev_id` and pass them to the next workflow node.
3. WHEN the identified GitHub username has no corresponding entry in the `team_members` table (Identity Gap), THE Agent SHALL pause execution, present the user with the message: "I could not find a corporate email for GitHub user '[username]'. Please provide their email address to continue.", and wait for the user's input.
4. WHEN the user provides an email address in response to an Identity Gap prompt, THE Agent SHALL resume the workflow using the provided email address as the notification target.
5. IF the user provides an email address that does not conform to a valid email format during Identity Gap resolution, THEN THE Agent SHALL prompt the user again with a validation message before resuming.

---

### Requirement 7: Incident Ticket Logging

**User Story:** As a user, I want the AEL Agent to automatically create an incident ticket in the database, so that every triaged alert has an auditable record.

#### Acceptance Criteria

1. WHEN a causal commit and responsible developer have been identified, THE Agent SHALL insert a new row into the `incident_tickets` table containing the `project_id`, `assigned_dev_id`, and status 'Open'.
2. THE Incident_Logging_Tool SHALL return the newly created `ticket_id` and pass it to the next workflow node.
3. THE Agent SHALL NOT create duplicate Incident_Tickets for the same `event_id` within a single workflow execution.
4. IF the Supabase database insert operation fails, THEN THE Agent SHALL catch the error and relay the message: "Incident ticket creation failed due to a database error. The scheduling step has been skipped." and terminate the current workflow execution.

---

### Requirement 8: Human-in-the-Loop Confirmation

**User Story:** As a user, I want the AEL Agent to ask for my explicit approval before scheduling a calendar meeting, so that I retain control over irreversible external actions.

#### Acceptance Criteria

1. WHEN an Incident_Ticket has been created and the responsible developer's email is known, THE Agent SHALL pause and present the user with a confirmation prompt in the format: "I plan to assign this to [Developer Name] and schedule a sync for [proposed time]. Should I proceed?"
2. THE Agent SHALL NOT invoke the Google Calendar API until the user explicitly confirms the action via the Chat_Interface confirmation control.
3. WHEN the user confirms the HITL prompt, THE Agent SHALL proceed to the meeting scheduling node.
4. WHEN the user cancels the HITL prompt, THE Agent SHALL update the Incident_Ticket status to 'Open' without a scheduled meeting, inform the user that scheduling was skipped, and end the workflow.
5. THE Agent SHALL propose a specific meeting time that falls within standard business hours (09:00–18:00) on the next available weekday relative to the current timestamp.

---

### Requirement 9: Meeting Scheduling

**User Story:** As a user, I want the AEL Agent to automatically create a Google Calendar event with a Meet link and invite the responsible developer, so that the remediation sync is booked without manual calendar management.

#### Acceptance Criteria

1. WHEN the user confirms the HITL scheduling prompt, THE Agent SHALL call the Google Calendar API using OAuth credentials to create a calendar event with a Google Meet conference link.
2. THE Calendar_Tool SHALL set the event title to "Incident Sync: [project_name] — Ticket [ticket_id]".
3. THE Calendar_Tool SHALL add the responsible developer's `email_address` as a required attendee on the event.
4. THE Calendar_Tool SHALL set the event duration to 30 minutes.
5. WHEN the calendar event is successfully created, THE Agent SHALL return the event URL and Meet link to the user in the chat response.
6. IF the Google Calendar API returns a 4xx or 5xx HTTP status code, THEN THE Agent SHALL catch the error and relay the message: "Google Calendar API request failed. The meeting was not scheduled. Please create the meeting manually." without retrying.
7. IF the Google OAuth token has expired, THEN THE Agent SHALL detect the 401 status code and relay the message: "Google Calendar authorization has expired. Please re-authenticate to schedule meetings."

---

### Requirement 10: Workload Overload Detection

**User Story:** As a user, I want the AEL Agent to warn me before assigning a new incident to a developer who is already overloaded, so that I can make an informed assignment decision.

#### Acceptance Criteria

1. WHEN a responsible developer has been identified and before the HITL confirmation prompt is displayed, THE Agent SHALL query the `sprint_tasks` table for Sprint_Tasks where `assigned_dev_id` matches the developer's `dev_id`, `status` is 'Pending' or 'In Progress', `priority` is 'Critical', and `due_date` is earlier than the current timestamp.
2. WHEN the query returns three or more Sprint_Tasks meeting the Overload Condition criteria, THE Agent SHALL prepend a warning to the HITL prompt: "⚠️ Warning: [Developer Name] currently has [N] overdue critical tasks. Consider reassigning. Shall I still schedule the sync with them, or would you like to assign a different team member?"
3. WHEN the user chooses to assign a different team member in response to the overload warning, THE Agent SHALL prompt the user to specify the replacement developer's name or email address.
4. WHEN a replacement developer is specified, THE Agent SHALL perform identity resolution for the replacement and resume the workflow from the HITL confirmation step.

---

### Requirement 11: Daily Standup & Sprint Triage

**User Story:** As a user, I want to ask the AEL Agent about today's team status and deadline compliance, so that I can run a standup without manually querying the database.

#### Acceptance Criteria

1. WHEN the user submits a query that requests team status or standup information, THE Agent SHALL invoke the Sprint_Status_Tool to query the `sprint_tasks` table for all Sprint_Tasks across all active projects.
2. THE Sprint_Status_Tool SHALL classify each Sprint_Task as overdue if its `due_date` is earlier than the current timestamp and its `status` is not 'Completed'.
3. THE Agent SHALL return a structured summary grouping overdue tasks by `assigned_dev_id`, including each task's `task_title`, `priority`, `due_date`, and `status`.
4. THE Agent SHALL sort the overdue task summary so that Sprint_Tasks with `priority` of 'Critical' appear before 'High', 'High' before 'Medium', and 'Medium' before 'Low'.
5. WHEN at least one Critical overdue Sprint_Task is present in the summary, THE Agent SHALL append a proactive recommendation: "I recommend scheduling follow-up syncs for all Critical overdue items. Would you like me to proceed?"
6. WHEN the user confirms the proactive recommendation, THE Agent SHALL initiate the meeting scheduling workflow for each Critical overdue Sprint_Task, requesting a separate HITL confirmation for each one.
7. WHEN no Sprint_Tasks are overdue, THE Agent SHALL respond: "All sprint tasks are on track. No overdue items found."

---

### Requirement 12: Database Schema Integrity

**User Story:** As a developer deploying the AEL, I want the Supabase database schema to enforce referential integrity and data validity, so that the Agent never operates on inconsistent data.

#### Acceptance Criteria

1. THE Database SHALL define the `active_projects` table with columns: `project_id` (UUID, primary key, default gen_random_uuid()), `project_name` (text, not null), `github_repo_url` (text, not null).
2. THE Database SHALL define the `team_members` table with columns: `dev_id` (UUID, primary key, default gen_random_uuid()), `name` (text, not null), `email_address` (text, not null, unique), `github_username` (text, not null, unique).
3. THE Database SHALL define the `system_events` table with columns: `event_id` (UUID, primary key, default gen_random_uuid()), `project_id` (UUID, not null, foreign key referencing `active_projects.project_id`), `error_trace` (text, not null), `timestamp` (timestamptz, not null, default now()).
4. THE Database SHALL define the `incident_tickets` table with columns: `ticket_id` (UUID, primary key, default gen_random_uuid()), `project_id` (UUID, not null, foreign key referencing `active_projects.project_id`), `assigned_dev_id` (UUID, nullable, foreign key referencing `team_members.dev_id`), `status` (text, not null, check constraint restricting values to 'Open' and 'Resolved').
5. THE Database SHALL define the `sprint_tasks` table with columns: `task_id` (UUID, primary key, default gen_random_uuid()), `project_id` (UUID, not null, foreign key referencing `active_projects.project_id`), `assigned_dev_id` (UUID, not null, foreign key referencing `team_members.dev_id`), `task_title` (text, not null), `status` (text, not null, check constraint restricting values to 'Pending', 'In Progress', 'Completed', 'Blocked'), `priority` (text, not null, check constraint restricting values to 'Low', 'Medium', 'High', 'Critical'), `due_date` (timestamptz, not null).
6. THE Database SHALL be seeded with at least two Active_Projects, four Team_Members, five System_Events, and ten Sprint_Tasks (with at least two overdue Critical tasks) to enable end-to-end demonstration without requiring live data entry.

---

### Requirement 13: Authentication & Credential Management

**User Story:** As a developer deploying the AEL, I want all external API credentials to be stored as environment variables and never exposed in client-side code, so that the application can be deployed publicly without leaking secrets.

#### Acceptance Criteria

1. THE Application SHALL read the GitHub PAT, Google OAuth client credentials, Supabase URL, and Supabase service role key exclusively from server-side environment variables.
2. THE Application SHALL NOT embed any API keys, tokens, or secrets in client-side JavaScript bundles or in any file committed to the source repository.
3. THE Application SHALL expose a server-side API route that proxies all Agent requests from the frontend, so that no credentials are transmitted to the browser.
4. WHERE the Google OAuth flow is used, THE Application SHALL complete the OAuth authorization code exchange server-side and store the resulting access and refresh tokens in server-side session storage or environment variables only.
5. IF a required environment variable is missing at application startup, THEN THE Application SHALL log a descriptive error message identifying the missing variable and refuse to start.

---

### Requirement 14: Deployment & Public Accessibility

**User Story:** As an evaluator of the AEL, I want to access a live, deployed version of the application without any private configuration, so that I can evaluate the full end-to-end experience.

#### Acceptance Criteria

1. THE Application SHALL be deployed to Vercel and accessible via a public HTTPS URL.
2. THE Application SHALL function end-to-end using only the environment variables configured in the Vercel deployment, without requiring the evaluator to set up any local services.
3. THE Application SHALL display the Chat_Interface on the root path ("/") of the deployed URL.
4. THE Application SHALL load the Chat_Interface and be ready to accept user input within 5 seconds of the initial page load on a standard broadband connection (minimum 10 Mbps download).
5. IF the Vercel deployment build fails, THEN THE Application SHALL surface the build error in the Vercel deployment logs without exposing credentials.

---

### Requirement 15: Observability & Error Transparency

**User Story:** As a developer operating the AEL, I want all tool invocations, LLM calls, and errors to be logged server-side, so that I can diagnose failures in the production deployment.

#### Acceptance Criteria

1. THE Application SHALL write a structured log entry for every Tool invocation, including the tool name, input parameters (with secrets redacted), and the outcome (success or error code).
2. THE Application SHALL write a structured log entry for every LLM API call, including the model name, input token count, output token count, and latency in milliseconds.
3. IF any Tool or LLM call results in an error, THEN THE Application SHALL include the error type and a non-sensitive error message in the log entry.
4. THE Application SHALL NOT log the full content of `error_trace` fields or user chat messages in plain text to prevent accidental exposure of sensitive operational data.
5. THE Agent SHALL redact all credential values from log entries before writing them.
