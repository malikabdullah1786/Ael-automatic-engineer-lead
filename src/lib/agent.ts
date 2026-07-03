import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { supabase } from "./supabase";
import { services } from "./services/container";
import crypto from "crypto";

// Helper to get Gemini model dynamically
function getModel(config?: any) {
  let modelName = config?.configurable?.modelName || "models/gemini-3.1-flash-lite";
  if (modelName.startsWith("models/")) {
    modelName = modelName.replace("models/", "");
  }
  return new ChatGoogleGenerativeAI({
    model: modelName,
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1,
  });
}

// 1. Define the Graph State Schema
export const AgentState = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  projectId: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  githubUsername: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  devId: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  devEmail: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  devName: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  errorTrace: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  // Human-in-the-loop action details
  pendingAction: Annotation<{
    type: "ticket_and_schedule";
    ticket: { project_id: string; error_context: string };
    schedule: { email: string; name: string };
  } | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  actionApproved: Annotation<boolean | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  interruptionReason: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  intent: Annotation<"standup" | "investigate" | "general" | "jira_status" | "schedule" | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  overdueTasksQueue: Annotation<any[]>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  }),
  meetingTime: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  jiraAccountId: Annotation<string | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
});

// 2. Node Implementations

/**
 * Route User Intent: Classify query and determine next node
 */
async function routeIntentNode(state: typeof AgentState.State, config?: any) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  console.log("==> routeIntentNode entered. lastMessage:", lastMessage, "state:", { intent: state.intent, errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction, interruptionReason: state.interruptionReason, queueLength: state.overdueTasksQueue?.length });

  // 1. If we have any active interruption, check if user is trying to switch context to a new command
  if (state.interruptionReason) {
    let classified = { intent: "general" };
    try {
      const prompt = `Classify the following developer message to see if it is a new request.
Current time: ${new Date().toISOString()}

Intents:
1. "standup" - The user is asking for a status update, workload summaries, missed deadlines, or task updates.
2. "investigate" - The user wants to check/investigate a system crash, alert, or database error.
3. "schedule" - The user explicitly wants to schedule a follow-up sync/meeting, book a meeting, or invite a developer to a meeting.
4. "list_meetings" - The user wants to view, show, list, or check scheduled meetings/syncs.
5. "jira_status" - The user wants to check Jira tasks, sprint task status, or completed/overdue tasks on Jira.
6. "general" - Any other general response to the current question/interruption (such as saying 'yes'/'no'/'proceed', selecting a project number/name, providing an email, specifying a time, or general chat).

User Message: "${lastMessage}"

Return JSON ONLY in the following format:
{ "intent": "standup" | "investigate" | "schedule" | "list_meetings" | "jira_status" | "general" }`;

      const response = await getModel(config).invoke(prompt);
      const cleanedText = response.content.toString().replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
      const parsed = JSON.parse(cleanedText);
      if (parsed && parsed.intent) {
        classified = parsed;
      }
    } catch (e) {
      console.error("Failed to check intent during active interruption:", e);
    }

    if (["standup", "investigate", "schedule", "list_meetings", "jira_status"].includes(classified.intent)) {
      console.log(`==> Breaking interruption loop. Switching context to new intent: ${classified.intent}`);
      // Clear interruption state and proceed with intent routing for the new query
      return {
        interruptionReason: null,
        pendingAction: null,
        actionApproved: null,
        errorTrace: null,
        devEmail: null,
        devName: null,
        devId: null,
        githubUsername: null,
        meetingTime: null,
        intent: classified.intent
      };
    }
  }

  // Handle active project selection interruption
  if (state.interruptionReason === "project_selection_required") {
    const { data: projects } = await supabase.from("active_projects").select("project_id, project_name");
    const activeProjects = projects || [];
    
    let selectedProj = null;
    const msgLower = lastMessage.toLowerCase().trim();
    
    // Check if user entered a number (1-based index)
    const num = parseInt(msgLower, 10);
    if (!isNaN(num) && num >= 1 && num <= activeProjects.length) {
      selectedProj = activeProjects[num - 1];
    } else {
      // Check for name match
      for (const p of activeProjects) {
        if (msgLower.includes(p.project_name.toLowerCase()) || p.project_name.toLowerCase().includes(msgLower)) {
          selectedProj = p;
          break;
        }
      }
    }
    
    if (selectedProj) {
      if (state.intent === "standup") {
        return {
          projectId: selectedProj.project_id,
          interruptionReason: null,
          intent: "standup",
          messages: [{
            role: "assistant",
            content: `✅ **Project Selected:** Project context set to **${selectedProj.project_name}**.`
          }]
        };
      }

      // Search for developer in the user message or state
      const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address, github_username");
      const activeTeam = teamMembers || [];

      let foundMember = null;
      for (const m of activeTeam) {
        const nameWords = m.name.toLowerCase().split(/\s+/).filter((w: any) => w.length > 2);
        if (msgLower.includes(m.name.toLowerCase()) || nameWords.some((w: any) => msgLower.includes(w))) {
          foundMember = m;
          break;
        }
      }

      let devEmail = foundMember ? foundMember.email_address : state.devEmail;
      let devName = foundMember ? foundMember.name : state.devName;
      let devId = foundMember ? foundMember.dev_id : state.devId;
      let githubUsername = foundMember ? foundMember.github_username : state.githubUsername;

      // If not found in DB, try to extract from message via LLM
      if (!foundMember) {
        try {
          const prompt = `Extract any developer name or email from this message: "${lastMessage}". Return a JSON object with keys "name" (string or null) and "email" (string or null).`;
          const response = await getModel(config).invoke(prompt);
          const parsed = JSON.parse(response.content.toString().replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim());
          if (parsed.name) {
            devName = parsed.name;
          }
          if (parsed.email) {
            devEmail = parsed.email;
          }
        } catch (e) {
          console.error("Failed to parse developer details during project resolution:", e);
        }
      }

      if (!devEmail) {
        devEmail = "unassigned@company.com";
      }

      return {
        projectId: selectedProj.project_id,
        devId,
        devName,
        devEmail,
        githubUsername,
        interruptionReason: null,
        intent: state.intent || "investigate",
        messages: [{
          role: "assistant",
          content: `✅ **Project Selected:** Project context set to **${selectedProj.project_name}**.`
        }]
      };
    } else {
      return {
        interruptionReason: "project_selection_required",
        messages: [{
          role: "assistant",
          content: `⚠️ **Invalid Selection:** I couldn't match your input with any active projects. Please select the project by typing its name or number:\n\n` + activeProjects.map((p, idx) => `${idx + 1}. **${p.project_name}**`).join("\n")
        }]
      };
    }
  }

  // If there is any other active interruption, let's bypass intent routing
  if (state.interruptionReason) {
    return {};
  }

  // If we are resuming from a pending action or have manually resolved developer email, bypass intent routing
  if (state.pendingAction || (state.errorTrace && state.devEmail && state.devEmail !== "unassigned@company.com")) {
    return {};
  }

  // Check user intent using LLM and parse details
  const prompt = `Classify the following developer message and extract details if applicable.
Current time: ${new Date().toISOString()} (Use this to resolve relative dates/times like 'tomorrow', 'next monday', 'at 3 PM').

Intents:
1. "standup" - The user is asking for a status update, workload summaries, missed deadlines, or task updates.
2. "investigate" - The user wants to check/investigate a system crash, alert, or database error.
3. "schedule" - The user explicitly wants to schedule a follow-up sync/meeting, book a meeting, or invite a developer to a meeting.
4. "list_meetings" - The user wants to view, show, list, or check scheduled meetings/syncs, optionally filtering by developer or time.
5. "jira_status" - The user wants to check Jira tasks, sprint task status, or completed/overdue tasks on Jira.
6. "general" - Any other general chat, greeting, or question (e.g. how to change developer gmail, how to add developer, how to use the dashboard).

User Message: "${lastMessage}"

Return a JSON object ONLY in the following format:
{
  "intent": "standup" | "investigate" | "schedule" | "list_meetings" | "jira_status" | "general",
  "devEmail": "extracted_email_if_provided_else_null",
  "devName": "extracted_developer_name_if_provided_else_null",
  "reason": "extracted_meeting_reason_or_context_if_provided_else_null",
  "proposedTime": "ISO_datetime_string_if_provided_else_null"
}`;

  let classified: {
    intent: "standup" | "investigate" | "schedule" | "list_meetings" | "jira_status" | "general",
    devEmail: string | null,
    devName: string | null,
    reason: string | null,
    proposedTime: string | null
  } = {
    intent: "general",
    devEmail: null,
    devName: null,
    reason: null,
    proposedTime: null
  };

  try {
    const response = await getModel(config).invoke(prompt);
    const cleanedText = response.content.toString().replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
    const parsed = JSON.parse(cleanedText);
    if (parsed && parsed.intent) {
      classified = parsed;
    }
  } catch (err) {
    console.error("Failed to parse intent classification JSON:", err);
    const msg = lastMessage.toLowerCase();
    if (msg.includes("standup") || msg.includes("status") || msg.includes("update") || msg.includes("overdue")) {
      classified.intent = "standup";
    } else if (msg.includes("crash") || msg.includes("investigate") || msg.includes("error")) {
      classified.intent = "investigate";
    } else if (msg.includes("schedule") || msg.includes("sync") || msg.includes("meeting")) {
      classified.intent = "schedule";
    }
  }

  if (classified.intent === "standup") {
    const { data: projects } = await supabase
      .from("active_projects")
      .select("project_id, project_name, jira_project_key");
    const activeProjects = projects || [];

    let targetProj = null;
    const msgLower = lastMessage.toLowerCase();
    
    // Attempt to match project name in the message
    for (const p of activeProjects) {
      if (msgLower.includes(p.project_name.toLowerCase())) {
        targetProj = p;
        break;
      }
    }
    
    // Fall back to state.projectId if present
    if (!targetProj && state.projectId) {
      targetProj = activeProjects.find(p => p.project_id === state.projectId);
    }

    if (!targetProj) {
      return {
        intent: "standup",
        interruptionReason: "project_selection_required",
        messages: [{
          role: "assistant",
          content: `🔍 **Multiple Projects Found:** I detected a scheduling/standup request but did not find which project it belongs to. Please specify the project by typing its name or number:\n\n` +
            activeProjects.map((p, idx) => `${idx + 1}. **${p.project_name}**`).join("\n")
        }]
      };
    }

    return {
      intent: "standup",
      projectId: targetProj.project_id,
      overdueTasksQueue: []
    };
  }

  if (classified.intent === "list_meetings") {
    // 1. Fetch all incident tickets with their project/developer associations
    const { data: tickets } = await supabase
      .from("incident_tickets")
      .select("ticket_id, project_id, assigned_dev_id, error_context, status, created_at");

    // 2. Fetch all team members to resolve names
    const { data: teamMembers } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address");
    const devMap = new Map(teamMembers?.map(m => [m.dev_id, m]) || []);

    // 3. Fetch all projects to resolve names
    const { data: projects } = await supabase
      .from("active_projects")
      .select("project_id, project_name");
    const projectMap = new Map(projects?.map(p => [p.project_id, p.project_name]) || []);

    // Parse meetings from tickets
    const meetings = [];
    if (tickets) {
      for (const t of tickets) {
        if (t.error_context && t.error_context.startsWith("[Scheduled:")) {
          const match = t.error_context.match(/^\[Scheduled:\s*([^|]+)\|\s*Link:\s*([^\]]+)\]\s*(.*)$/);
          if (match) {
            const timeStr = match[1].trim();
            const meetLink = match[2].trim();
            const originalContext = match[3].trim();
            const dev = devMap.get(t.assigned_dev_id);
            const projName = projectMap.get(t.project_id) || "Unknown Project";

            meetings.push({
              ticketId: t.ticket_id,
              status: t.status,
              time: new Date(timeStr),
              meetLink,
              reason: originalContext,
              devName: dev ? dev.name : "Unknown Developer",
              devEmail: dev ? dev.email_address : "unassigned@company.com",
              projectName: projName
            });
          }
        }
      }
    }

    // Sort meetings by time ascending
    meetings.sort((a, b) => a.time.getTime() - b.time.getTime());

    // Filter by developer name if provided
    let filtered = meetings;
    if (classified.devName) {
      const q = classified.devName.toLowerCase();
      filtered = filtered.filter(m => m.devName.toLowerCase().includes(q) || m.devEmail.toLowerCase().includes(q));
    }

    // Filter by proposedTime (till/before time) if provided
    if (classified.proposedTime) {
      const limitDate = new Date(classified.proposedTime);
      filtered = filtered.filter(m => m.time <= limitDate);
    }

    // Format output
    let content = "";
    if (filtered.length === 0) {
      content = "📅 **No scheduled meetings found** matching your criteria.";
    } else {
      content = `📅 **Scheduled Incident Sync Meetings:**\n\n`;
      content += `| Developer | Project | Date & Time | Meet Link | Status | Reason |\n`;
      content += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      for (const m of filtered) {
        const dateStr = isNaN(m.time.getTime()) ? "N/A" : m.time.toLocaleString();
        content += `| **${m.devName}** | <u>${m.projectName}</u> | \`${dateStr}\` | [Google Meet](${m.meetLink}) | \`${m.status}\` | ${m.reason} |\n`;
      }
    }

    return {
      intent: "general",
      messages: [{ role: "assistant", content }]
    };
  }

  // Handle explicit scheduling command
  if (classified.intent === "schedule") {
    const { data: projects } = await supabase.from("active_projects").select("project_id, project_name");
    const activeProjects = projects || [];

    const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address, github_username, role");
    const activeTeam = teamMembers || [];

    let foundMember = null;
    const msgLower = lastMessage.toLowerCase();
    
    // Check if any team member name is mentioned in the message
    for (const m of activeTeam) {
      const nameWords = m.name.toLowerCase().split(/\s+/).filter((w: any) => w.length > 2);
      if (msgLower.includes(m.name.toLowerCase()) || nameWords.some((w: any) => msgLower.includes(w))) {
        foundMember = m;
        break;
      }
    }

    let email = foundMember ? foundMember.email_address : classified.devEmail;
    let name = foundMember ? foundMember.name : classified.devName;
    let devId = foundMember ? foundMember.dev_id : null;
    let githubUsername = foundMember ? foundMember.github_username : null;

    if (!email) {
      email = "unassigned@company.com";
    }
    if (!name) {
      name = "Unknown Developer";
    }

    const reason = classified.reason || "Overdue task review";

    // 1. Try to find a project match in the user's message
    let matchedProj = null;
    if (activeProjects.length > 0) {
      for (const p of activeProjects) {
        if (msgLower.includes(p.project_name.toLowerCase())) {
          matchedProj = p;
          break;
        }
      }
    }

    // 2. If not found in the message, check if there's only 1 project in the database
    if (!matchedProj && activeProjects.length === 1) {
      matchedProj = activeProjects[0];
    }

    // 3. If still no project matched, prompt the user to choose
    if (!matchedProj && activeProjects.length > 1) {
      return {
        intent: "schedule",
        devId,
        devEmail: email,
        devName: name,
        githubUsername,
        errorTrace: reason,
        meetingTime: classified.proposedTime,
        interruptionReason: "project_selection_required",
        messages: [{
          role: "assistant",
          content: `🔍 **Multiple Projects Found:** I detected a scheduling request for **${name}** but did not find which project it belongs to. Please specify the project by typing its name or number:\n\n` + activeProjects.map((p, idx) => `${idx + 1}. **${p.project_name}**`).join("\n")
        }]
      };
    }

    const projId = matchedProj ? matchedProj.project_id : null;

    return {
      intent: "schedule",
      projectId: projId,
      devId,
      devName: name,
      devEmail: email,
      githubUsername,
      errorTrace: reason,
      meetingTime: classified.proposedTime,
    };
  }

  // Handle general queries using LLM
  if (classified.intent === "general") {
    const response = await getModel(config).invoke(`You are the Autonomous Engineering Lead (AEL) SRE Agent. Respond to the user's message in a helpful and concise manner.
User message: "${lastMessage}"

If the user is asking how to change developer emails, add new developers, or modify Supabase records:
- Tell them they can do so using the "Team" tab on the sidebar.
- Advise that they can also change the email address of a developer during an active meeting scheduling draft by typing the new email address here in the chat console.

If the user is asking how to select a project:
- Tell them they can do so by going to the "Projects" tab and clicking on any card or list row. The active project will be highlighted in green.`);
    
    return {
      intent: "general",
      messages: [{ role: "assistant", content: response.content.toString() }]
    };
  }

  // If we are in standup remediation flow (queue not empty) and they didn't ask for a fresh standup
  if (state.overdueTasksQueue && state.overdueTasksQueue.length > 0) {
    const responseLower = lastMessage.toLowerCase().trim();
    if (responseLower === "no" || responseLower === "cancel" || responseLower === "decline") {
      return {
        intent: "general",
        overdueTasksQueue: [],
        messages: [{ role: "assistant", content: "❌ **Action Cancelled:** Proactive remediation syncs cancelled." }]
      };
    }

    if (responseLower === "yes" || responseLower === "yes proceed" || responseLower === "proceed" || responseLower === "sure" || responseLower === "ok") {
      const queue = [...state.overdueTasksQueue];
      const task = queue.shift();
      
      return {
        overdueTasksQueue: queue,
        projectId: task.project_id || (task.active_projects as any)?.project_id,
        devId: task.assigned_dev_id,
        devName: (task.team_members as any)?.name || "Unknown Developer",
        devEmail: (task.team_members as any)?.email_address || "unassigned@company.com",
        githubUsername: (task.team_members as any)?.github_username || null,
        errorTrace: `Overdue Critical Task: ${task.task_title}`,
        intent: "investigate",
        actionApproved: null,
        pendingAction: null,
        messages: [{ role: "assistant", content: `Initiating scheduling workflow for critical overdue task: **${task.task_title}**.` }]
      };
    }

    // Prompt user for clarification if response is ambiguous
    return {
      messages: [{ role: "assistant", content: "I recommend scheduling follow-up syncs for all Critical overdue items. Would you like me to proceed? (Type **yes** to schedule meetings, or **no** to decline)" }]
    };
  }

  return { intent: classified.intent };
}
async function standupNode(state: typeof AgentState.State) {
  // Query all active projects and team members
  const { data: projects } = await supabase
    .from("active_projects")
    .select("project_id, project_name, jira_project_key");

  const { data: teamMembers } = await supabase
    .from("team_members")
    .select("dev_id, name, email_address, github_username, role");

  const activeProjects = projects || [];
  const activeTeam = teamMembers || [];

  const proj = activeProjects.find(p => p.project_id === state.projectId) || activeProjects[0];
  if (!proj) {
    return {
      messages: [{ role: "assistant", content: "No active projects found. Please register a project first." }],
      overdueTasksQueue: []
    };
  }

  let summaryContent = `📊 **Sprint Standup Update - ${proj.project_name}**\n\n`;
  const criticalOverdueTasks: any[] = [];
  const now = new Date();

  for (const dev of activeTeam) {
    if (!dev.email_address || dev.email_address.includes("example.com") || dev.email_address.includes("your@email.com")) {
      continue;
    }

    let overdueList: any[] = [];
    let pendingList: any[] = [];
    let completedList: any[] = [];
    let jiraFetched = false;

    // 1. Try to fetch from Jira
    if (proj.jira_project_key) {
      try {
        const summary = await services.jiraService.fetchDeveloperTasks(proj.jira_project_key, dev.email_address);
        if (summary && summary.configured) {
          jiraFetched = true;
          overdueList = (summary.overdue || []).map(t => ({
            task_id: t.key,
            task_title: t.summary,
            status: t.status,
            priority: "Critical",
            due_date: t.dueDate || new Date().toISOString()
          }));
          pendingList = (summary.pending || []).map(t => ({
            task_id: t.key,
            task_title: t.summary,
            status: t.status,
            priority: "Medium",
            due_date: t.dueDate || new Date().toISOString()
          }));
          completedList = (summary.completed || []).map(t => ({
            task_id: t.key,
            task_title: t.summary,
            status: t.status,
            priority: "Low",
            due_date: t.dueDate || new Date().toISOString()
          }));
        }
      } catch (jiraErr) {
        console.error(`Failed to fetch Jira tasks for ${dev.email_address} in project ${proj.project_name}:`, jiraErr);
      }
    }

    // 2. Fall back to local db
    if (!jiraFetched) {
      const { data: localTasks } = await supabase
        .from("sprint_tasks")
        .select("task_id, task_title, status, priority, due_date, project_id, assigned_dev_id")
        .eq("project_id", proj.project_id)
        .eq("assigned_dev_id", dev.dev_id);

      if (localTasks) {
        for (const t of localTasks) {
          const taskObj = {
            task_id: t.task_id,
            task_title: t.task_title,
            status: t.status,
            priority: t.priority || "Medium",
            due_date: t.due_date
          };

          if (t.status === "Completed") {
            completedList.push(taskObj);
          } else if (new Date(t.due_date) < now) {
            overdueList.push(taskObj);
          } else {
            pendingList.push(taskObj);
          }
        }
      }
    }

    summaryContent += `👤 **Developer:** ${dev.name} (${dev.email_address})\n`;
    if (overdueList.length === 0 && pendingList.length === 0 && completedList.length === 0) {
      summaryContent += `  - No tasks assigned in this project.\n\n`;
    } else {
      if (overdueList.length > 0) {
        summaryContent += `  *Overdue Tasks:*\n`;
        for (const t of overdueList) {
          summaryContent += `  - **[${t.priority}]** ${t.task_title} (Due: ${new Date(t.due_date).toLocaleDateString()}, Status: ${t.status})\n`;
          if (t.priority === "Critical") {
            criticalOverdueTasks.push({
              task_id: t.task_id,
              task_title: t.task_title,
              status: t.status,
              priority: t.priority,
              due_date: t.due_date,
              project_id: proj.project_id,
              assigned_dev_id: dev.dev_id,
              active_projects: {
                project_id: proj.project_id,
                project_name: proj.project_name
              },
              team_members: {
                dev_id: dev.dev_id,
                name: dev.name,
                email_address: dev.email_address,
                github_username: dev.github_username,
                role: dev.role
              }
            });
          }
        }
      }
      if (pendingList.length > 0) {
        summaryContent += `  *Pending Tasks:*\n`;
        for (const t of pendingList) {
          summaryContent += `  - **[${t.priority}]** ${t.task_title} (Due: ${new Date(t.due_date).toLocaleDateString()}, Status: ${t.status})\n`;
        }
      }
      if (completedList.length > 0) {
        summaryContent += `  *Completed Tasks:*\n`;
        for (const t of completedList) {
          summaryContent += `  - **[${t.priority}]** ${t.task_title} (Status: ${t.status})\n`;
        }
      }
      summaryContent += `\n`;
    }
  }

  if (criticalOverdueTasks.length > 0) {
    summaryContent += `⚠️ **Proactive Recommendation:** I recommend scheduling follow-up syncs for all Critical overdue items. Would you like me to proceed?`;
    return {
      messages: [{ role: "assistant", content: summaryContent }],
      overdueTasksQueue: criticalOverdueTasks,
      interruptionReason: "standup_remediation_approval"
    };
  }

  return {
    messages: [{ role: "assistant", content: summaryContent }],
    overdueTasksQueue: []
  };
}

async function jiraStatusNode(state: typeof AgentState.State, config?: any) {
  console.log("==> jiraStatusNode entered. state:", { projectId: state.projectId, devId: state.devId, devEmail: state.devEmail });

  let devEmail = state.devEmail;
  let devName = state.devName;

  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  const msgLower = lastMessage.toLowerCase();

  const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address");
  const activeTeam = teamMembers || [];

  if (!devEmail) {
    for (const m of activeTeam) {
      const nameWords = m.name.toLowerCase().split(/\s+/).filter((w: any) => w.length > 2);
      if (msgLower.includes(m.name.toLowerCase()) || nameWords.some((w: any) => msgLower.includes(w))) {
        devEmail = m.email_address;
        devName = m.name;
        break;
      }
    }
  }

  let projectKey: string | null = null;
  let projectName = "Selected Project";

  const { data: projects } = await supabase.from("active_projects").select("project_id, project_name, jira_project_key");
  const activeProjects = projects || [];

  let foundProj = null;
  for (const p of activeProjects) {
    if (msgLower.includes(p.project_name.toLowerCase()) || (p.jira_project_key && msgLower.includes(p.jira_project_key.toLowerCase()))) {
      foundProj = p;
      break;
    }
  }

  if (!foundProj && state.projectId) {
    foundProj = activeProjects.find(p => p.project_id === state.projectId);
  }

  if (foundProj) {
    projectKey = foundProj.jira_project_key || null;
    projectName = foundProj.project_name;
  } else if (activeProjects.length > 0) {
    const withJira = activeProjects.find(p => !!p.jira_project_key);
    if (withJira) {
      projectKey = withJira.jira_project_key;
      projectName = withJira.project_name;
    }
  }

  if (!projectKey) {
    return {
      intent: "general",
      messages: [{
        role: "assistant",
        content: `⚠️ **Jira Project Key Missing:** Please link a Jira Project Key to your active projects in the workspace settings or Projects view first so I can retrieve tasks.`
      }]
    };
  }

  if (!devEmail) {
    return {
      intent: "general",
      messages: [{
        role: "assistant",
        content: `👤 **Developer Not Found:** I couldn't identify which developer's Jira tasks you'd like to check. Please specify a team member's name (e.g., "Check Husnain's tasks in Jira").`
      }]
    };
  }

  try {
    const summary = await services.jiraService.fetchDeveloperTasks(projectKey, devEmail);

    let content = `📊 **Jira Workload Status for ${devName || devEmail}** in project **${projectName}** (Key: \`${projectKey.toUpperCase()}\`):\n\n`;

    const formatTaskList = (tasks: any[]) => {
      if (tasks.length === 0) return "_None_\n";
      return tasks.map(t => `- [${t.key}](${t.url}): ${t.summary} (Status: \`${t.status}\`${t.dueDate ? `, Due: ${t.dueDate}` : ""})`).join("\n") + "\n";
    };

    content += `🔴 **Overdue Tasks (${summary.overdue.length}):**\n`;
    content += formatTaskList(summary.overdue);
    content += `\n🟡 **Pending Tasks (${summary.pending.length}):**\n`;
    content += formatTaskList(summary.pending);
    content += `\n🟢 **Completed Tasks (${summary.completed.length}):**\n`;
    content += formatTaskList(summary.completed);

    return {
      intent: "general",
      messages: [{ role: "assistant", content }]
    };
  } catch (err: any) {
    console.error("Failed to fetch Jira status in jiraStatusNode:", err);
    return {
      intent: "general",
      messages: [{
        role: "assistant",
        content: `❌ **Failed to retrieve Jira tasks:** ${err.message}`
      }]
    };
  }
}

async function fetchAlertNode(state: typeof AgentState.State) {
  // Fetch active ticket project IDs (where status is Open or Resolved)
  const { data: activeTickets } = await supabase
    .from("incident_tickets")
    .select("project_id")
    .in("status", ["Open", "Resolved"]);

  const activeProjectIds = activeTickets ? activeTickets.map((t: any) => t.project_id) : [];

  // Fetch recent system events
  const { data: events, error } = await supabase
    .from("system_events")
    .select(`
      event_id,
      project_id,
      error_trace,
      active_projects (project_name, github_repo_url)
    `)
    .order("timestamp", { ascending: false })
    .limit(20);

  if (error || !events || events.length === 0) {
    return {
      messages: [{ role: "assistant", content: "All systems are fully operational." }],
      intent: null // Terminate flow
    };
  }

  // Find the most recent event that is NOT triaged (i.e. neither event_id nor project_id is in activeProjectIds)
  const event = events.find((e: any) => 
    !activeProjectIds.includes(e.event_id) && 
    !activeProjectIds.includes(e.project_id)
  );

  if (!event) {
    return {
      messages: [{ role: "assistant", content: "All systems are fully operational." }],
      intent: null // Terminate flow
    };
  }

  return {
    projectId: event.project_id,
    errorTrace: event.error_trace,
    messages: [{ 
      role: "assistant", 
      content: `Found recent critical alert in project **${(event.active_projects as any)?.project_name || "Unknown"}**.\n\`\`\`\n${event.error_trace}\n\`\`\`\nInitiating GitHub commit scans...` 
    }],
  };
}

/**
 * Fetch Git Commits Node (Epic 2)
 * Pulls recent commit history from GitHub repository
 */
async function fetchCommitsNode(state: typeof AgentState.State) {
  if (!state.projectId) return {};

  const { data: project } = await supabase
    .from("active_projects")
    .select("github_repo_url")
    .eq("project_id", state.projectId)
    .single();

  if (!project || !project.github_repo_url) {
    return {
      messages: [{ role: "assistant", content: "Error: No GitHub repository URL associated with this project." }],
    };
  }

  try {
    const commits = await services.githubService.fetchRecentCommits(project.github_repo_url, 10);
    
    // Store commits list context directly in messages log for LLM evaluation
    return {
      messages: [{ 
        role: "assistant", 
        content: `Fetched the last ${commits.length} commits from GitHub. Evaluating commits against stack trace...`,
        commitsContext: commits 
      }],
    };
  } catch (error: any) {
    // Edge Case 4: GitHub API failures / Rate limiting
    return {
      interruptionReason: "unmapped_identity",
      messages: [{ 
        role: "assistant", 
        content: `⚠️ **GitHub API Failure:** I could not access the repository commits right now (likely due to placeholder repository URL or PAT access issues).\n\nWould you like to manually assign this crash and schedule a sync meeting? Please type the developer's corporate email address to proceed.` 
      }]
    };
  }
}

/**
 * Semantic Triaging Node (Epic 2 / Edge Case 2)
 * Audits git commits against the crash log using Gemini
 */
async function semanticAuditNode(state: typeof AgentState.State, config?: any) {
  // Find commits context in previous message
  const commitsMessage = state.messages.find((m: any) => m.commitsContext !== undefined);
  const commits = commitsMessage?.commitsContext || [];

  if (commits.length === 0) {
    return {
      messages: [{ role: "assistant", content: "No commits available to audit." }],
    };
  }

  const prompt = `You are a senior Site Reliability Engineer. Compare the following System Error stack trace against the latest 10 commits from the repository.

[SYSTEM ERROR LOG]
${state.errorTrace}

[LATEST 10 REPO COMMITS]
${JSON.stringify(commits)}

Perform a semantic analysis:
1. Identify if any commit is highly likely to have introduced the crash (based on modified files, function names, or commit messages).
2. If a culprit commit is identified, return its author's GitHub username.
3. If NO commits match the crash context (e.g. timeout, infrastructure-level database drops, unrelated commits), indicate that this is an infrastructure failure.

Output format:
Return JSON ONLY in the following shape:
{
  "culpritFound": true/false,
  "githubUsername": "username_here_or_null",
  "explanation": "Brief explanation of your findings"
}`;

  try {
    const response = await getModel(config).invoke(prompt);
    // Parse the output clean from markdown wrapping
    const text = response.content.toString().replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(text);

    if (result.culpritFound && result.githubUsername) {
      return {
        githubUsername: result.githubUsername,
        messages: [{ 
          role: "assistant", 
          content: `🔍 **Semantic Triaging Result:**\n${result.explanation}\n\nIdentified culprit: **@${result.githubUsername}**. Auditing developer workload...` 
        }],
      };
    } else {
      // Edge Case 2: Infrastructure mismatch - Fetch Jira assignable users
      const { data: project } = await supabase
        .from("active_projects")
        .select("jira_project_key, project_name")
        .eq("project_id", state.projectId)
        .single();

      const projectKey = project?.jira_project_key;
      let assignableJiraUsers: any[] = [];
      if (projectKey) {
        try {
          assignableJiraUsers = await services.jiraService.getAssignableUsers(projectKey);
        } catch (err) {
          console.error("Failed to fetch assignable users from Jira:", err);
        }
      }

      const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address");
      const activeTeam = teamMembers || [];

      let content = `⚠️ **Infrastructure-Level Crash Detected:**\n${result.explanation}\n\nNo recent commits match this error trace. Please choose who to assign this issue to:\n\n`;

      if (assignableJiraUsers && assignableJiraUsers.length > 0) {
        assignableJiraUsers.forEach((user, index) => {
          content += `${index + 1}. **${user.displayName}** (${user.accountId})\n`;
        });
      } else {
        activeTeam.forEach((user, index) => {
          content += `${index + 1}. **${user.name}** (${user.email_address})\n`;
        });
      }

      return {
        githubUsername: null,
        interruptionReason: "jira_assignee_selection_required",
        messages: [{ 
          role: "assistant", 
          content
        }]
      };
    }
  } catch (err) {
    const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address");
    const activeTeam = teamMembers || [];
    let content = `⚠️ **Audit Failure:** Failed to perform semantic audit on git commits.\n\nPlease choose who to assign this issue to:\n\n`;
    activeTeam.forEach((user, index) => {
      content += `${index + 1}. **${user.name}** (${user.email_address})\n`;
    });

    return {
      githubUsername: null,
      interruptionReason: "jira_assignee_selection_required",
      messages: [{ 
        role: "assistant", 
        content
      }]
    };
  }
}

/**
 * Developer Workload Audit Node (Epic 3 / Edge Case 1)
 * Checks target developer workload & handles interruptions
 */
async function checkWorkloadNode(state: typeof AgentState.State) {
  console.log("==> checkWorkloadNode entered. state:", { devId: state.devId, devEmail: state.devEmail, githubUsername: state.githubUsername, errorTrace: state.errorTrace });
  let member = null;

  if (state.devId) {
    const { data } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username")
      .eq("dev_id", state.devId)
      .single();
    member = data;
  } else if (state.devEmail && state.devEmail !== "unassigned@company.com") {
    const { data } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username")
      .eq("email_address", state.devEmail)
      .single();
    member = data;
  } else if (state.githubUsername) {
    const { data } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username")
      .eq("github_username", state.githubUsername)
      .single();
    member = data;
  }

  // Try to search by devName if still not found
  if (!member && state.devName && state.devName !== "Unknown Developer") {
    const { data: nameMatches } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username")
      .ilike("name", `%${state.devName}%`);
    if (nameMatches && nameMatches.length > 0) {
      member = nameMatches[0];
    }
  }

  const hasValidEmail = state.devEmail && state.devEmail !== "unassigned@company.com";

  if (!member && hasValidEmail) {
    // Auto-register developer dynamically if we have their email address
    try {
      const crypto = require("crypto");
      const dev_id = crypto.randomUUID();
      const { data: newMember } = await supabase
        .from("team_members")
        .insert({
          dev_id,
          name: state.devName || "Unknown Developer",
          email_address: state.devEmail,
          role: "Developer"
        })
        .select()
        .single();
      
      if (newMember) {
        member = newMember;
      }
    } catch (insertErr) {
      console.error("Failed to auto-register developer:", insertErr);
    }
  }

  if (!member) {
    if (state.githubUsername) {
      return {
        devId: null,
        interruptionReason: "unmapped_identity",
        messages: [{
          role: "assistant",
          content: `⚠️ **Identity Mismatch:** I identified the culprit as **@${state.githubUsername}**, but they do not exist in our corporate directory.\n\nPlease type their corporate email address to proceed with the scheduling flow.`
        }]
      };
    }

    return {
      interruptionReason: "developer_email_required",
      messages: [{
        role: "assistant",
        content: `⚠️ **Developer Not Found:** I couldn't find a developer matching **${state.devName || "the target assignee"}** in the team directory.\n\nPlease type their corporate email address to register them in Supabase and proceed with scheduling.`
      }]
    };
  }

  const githubUser = member.github_username || state.githubUsername || "unmapped";

  // 2. Query target developer overdue or critical tasks
  const { data: tasks } = await supabase
    .from("sprint_tasks")
    .select("task_id, task_title, priority")
    .eq("assigned_dev_id", member.dev_id)
    .or(`priority.eq.Critical,due_date.lt.${new Date().toISOString()}`)
    .neq("status", "Completed");

  const overdueCount = tasks?.length || 0;

  // Edge Case 1: Workload overload warning (>= 3 overdue/critical tasks)
  if (overdueCount >= 3) {
    return {
      devId: member.dev_id,
      devName: member.name,
      devEmail: member.email_address,
      githubUsername: githubUser,
      interruptionReason: "workload_overload",
      messages: [{
        role: "assistant",
        content: `⚠️ **Workload Overload Alert:** I traced the bug to **${member.name}** (@${githubUser}), but they currently have **${overdueCount} critical or overdue tasks** in this sprint.\n\nShould I proceed with assigning this high-priority bug and booking a sync meeting for them? (Type 'yes' or specify a different developer's name/email to reassign).`
      }]
    };
  }

  return {
    devId: member.dev_id,
    devName: member.name,
    devEmail: member.email_address,
    githubUsername: githubUser,
    interruptionReason: null
  };
}
async function resolveIdentityNode(state: typeof AgentState.State, config?: any) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  console.log("==> resolveIdentityNode entered. lastMessage:", lastMessage, "interruptionReason:", state.interruptionReason, "meetingTime in state:", state.meetingTime);

  // 1. If we were interrupted by unmapped_identity, check if user provided email
  if (state.interruptionReason === "unmapped_identity") {
    const queryTerm = lastMessage.trim();
    const isEmail = queryTerm.includes("@") && queryTerm.includes(".");
    if (!isEmail) {
      return {
        interruptionReason: "unmapped_identity",
        messages: [{ role: "assistant", content: "Please provide a valid corporate email address (e.g. developer@company.com)." }]
      };
    }

    // Attempt to lookup in team_members by email to see if name/github details exist
    const { data: member } = await supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username")
      .eq("email_address", queryTerm)
      .single();

    if (member) {
      return {
        devId: member.dev_id,
        devEmail: member.email_address,
        devName: member.name,
        githubUsername: member.github_username,
        interruptionReason: null // Clear interruption
      };
    }

    // If email is not registered in team_members, resolve it using email as target
    return {
      devEmail: queryTerm,
      devName: state.githubUsername || "Unknown Developer",
      interruptionReason: null // Clear interruption
    };
  }

  // 2. If we were interrupted by developer_email_required
  if (state.interruptionReason === "developer_email_required") {
    const queryTerm = lastMessage.trim();
    const isEmail = queryTerm.includes("@") && queryTerm.includes(".");
    if (!isEmail) {
      return {
        interruptionReason: "developer_email_required",
        messages: [{ role: "assistant", content: `Please provide a valid corporate email address (e.g. developer@company.com) to register **${state.devName || "the developer"}**.` }]
      };
    }

    return {
      devEmail: queryTerm,
      interruptionReason: null
    };
  }

  // 3. If we were interrupted by workload_overload, check user approval or reassignment
  if (state.interruptionReason === "workload_overload") {
    const responseLower = lastMessage.toLowerCase().trim();

    // User confirmed override
    if (responseLower === "yes" || responseLower === "yes proceed" || responseLower === "proceed") {
      return {
        interruptionReason: null // Clear interrupt and continue
      };
    }

    // User wants to reassign to someone else (can be name or email)
    const queryTerm = lastMessage.trim();
    const isEmail = queryTerm.includes("@") && queryTerm.includes(".");

    let query = supabase
      .from("team_members")
      .select("dev_id, name, email_address, github_username");
      
    if (isEmail) {
      query = query.eq("email_address", queryTerm);
    } else {
      query = query.ilike("name", `%${queryTerm}%`);
    }

    const { data: matches } = await query;
    const otherDev = matches && matches.length > 0 ? matches[0] : null;

    if (otherDev) {
      return {
        devId: otherDev.dev_id,
        devName: otherDev.name,
        devEmail: otherDev.email_address,
        githubUsername: otherDev.github_username,
        interruptionReason: null // Clear interruption
      };
    }

    return {
      interruptionReason: "workload_overload",
      messages: [{ 
        role: "assistant", 
        content: `I could not find a developer in the team directory matching '${queryTerm}'. Please enter a valid corporate email address or team member name, or type 'yes' to proceed with the original assignment.` 
      }]
    };
  }

  // 4. If we were interrupted by meeting_time_required, parse time using LLM
  if (state.interruptionReason === "meeting_time_required") {
    try {
      const prompt = `You are parsing a date/time string from a developer's chat message.
Current local time is: ${new Date().toISOString()}

User message: "${lastMessage}"

Extract/parse the date and time from the user's message relative to the current local time.
Return a JSON object in this format ONLY:
{
  "parsedTime": "ISO_datetime_string_if_parsed_successfully_else_null",
  "success": true | false
}`;
      const response = await getModel(config).invoke(prompt);
      const parsed = JSON.parse(response.content.toString().replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim());
      console.log("==> LLM parsed meeting time:", parsed);
      if (parsed.success && parsed.parsedTime) {
        console.log("==> resolveIdentityNode returning meetingTime:", parsed.parsedTime);
        return {
          meetingTime: parsed.parsedTime,
          interruptionReason: null
        };
      } else {
        console.log("==> LLM failed to parse or success was false");
      }
    } catch (e) {
      console.error("Failed to parse meeting time via LLM:", e);
    }

    console.log("==> resolveIdentityNode returning failure to parse meeting time");
    return {
      interruptionReason: "meeting_time_required",
      messages: [{
        role: "assistant",
        content: `⚠️ **Could not parse date/time:** I wasn't able to extract a valid date and time from your message "${lastMessage}". Please specify the time clearly (e.g., 'tomorrow at 3 PM', 'Monday at 10 AM', 'July 4th at 2:30 PM').`
      }]
    };
  }

  // 5. If we were interrupted by standup_remediation_approval, handle yes/no responses
  if (state.interruptionReason === "standup_remediation_approval") {
    const responseLower = lastMessage.toLowerCase().trim();
    if (responseLower === "no" || responseLower === "cancel" || responseLower === "decline") {
      return {
        intent: "general",
        overdueTasksQueue: [],
        interruptionReason: null,
        messages: [{ role: "assistant", content: "❌ **Action Cancelled:** Proactive remediation syncs cancelled." }]
      };
    }

    if (responseLower === "yes" || responseLower === "yes proceed" || responseLower === "proceed" || responseLower === "sure" || responseLower === "ok") {
      if (state.overdueTasksQueue && state.overdueTasksQueue.length > 0) {
        const queue = [...state.overdueTasksQueue];
        const task = queue.shift();
        
        return {
          overdueTasksQueue: queue,
          projectId: task.project_id || (task.active_projects as any)?.project_id,
          devId: task.assigned_dev_id,
          devName: (task.team_members as any)?.name || "Unknown Developer",
          devEmail: (task.team_members as any)?.email_address || "unassigned@company.com",
          githubUsername: (task.team_members as any)?.github_username || null,
          errorTrace: `Overdue Critical Task: ${task.task_title}`,
          intent: "investigate",
          actionApproved: null,
          pendingAction: null,
          interruptionReason: null,
          messages: [{ role: "assistant", content: `Initiating scheduling workflow for critical overdue task: **${task.task_title}**.` }]
        };
      }
    }

    // Prompt user for clarification if response is ambiguous
    return {
      interruptionReason: "standup_remediation_approval",
      messages: [{ role: "assistant", content: "I recommend scheduling follow-up syncs for all Critical overdue items. Would you like me to proceed? (Type **yes** to schedule meetings, or **no** to decline)" }]
    };
  }

  // 6. If we were interrupted by jira_assignee_selection_required
  if (state.interruptionReason === "jira_assignee_selection_required") {
    const { data: project } = await supabase
      .from("active_projects")
      .select("jira_project_key, project_name")
      .eq("project_id", state.projectId)
      .single();

    const projectKey = project?.jira_project_key;
    let assignableJiraUsers: any[] = [];
    if (projectKey) {
      try {
        assignableJiraUsers = await services.jiraService.getAssignableUsers(projectKey);
      } catch (err) {
        console.error("Failed to fetch assignable users from Jira:", err);
      }
    }

    const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address, github_username");
    const activeTeam = teamMembers || [];

    let selectedUser: any = null;
    const msgLower = lastMessage.toLowerCase().trim();

    if (assignableJiraUsers && assignableJiraUsers.length > 0) {
      const num = parseInt(msgLower, 10);
      if (!isNaN(num) && num >= 1 && num <= assignableJiraUsers.length) {
        selectedUser = assignableJiraUsers[num - 1];
      } else {
        for (const user of assignableJiraUsers) {
          if (user.displayName.toLowerCase().includes(msgLower) || msgLower.includes(user.displayName.toLowerCase())) {
            selectedUser = user;
            break;
          }
        }
      }
    } else {
      const num = parseInt(msgLower, 10);
      if (!isNaN(num) && num >= 1 && num <= activeTeam.length) {
        const selectedMember = activeTeam[num - 1];
        selectedUser = {
          accountId: null,
          displayName: selectedMember.name,
          emailAddress: selectedMember.email_address
        };
      } else {
        for (const m of activeTeam) {
          if (m.name.toLowerCase().includes(msgLower) || msgLower.includes(m.name.toLowerCase())) {
            selectedUser = {
              accountId: null,
              displayName: m.name,
              emailAddress: m.email_address
            };
            break;
          }
        }
      }
    }

    if (selectedUser) {
      let localDev = activeTeam.find(t => t.name.toLowerCase() === selectedUser.displayName.toLowerCase());
      if (!localDev && selectedUser.emailAddress) {
        localDev = activeTeam.find(t => t.email_address.toLowerCase() === selectedUser.emailAddress.toLowerCase());
      }

      return {
        jiraAccountId: selectedUser.accountId,
        devId: localDev ? localDev.dev_id : null,
        devName: localDev ? localDev.name : selectedUser.displayName,
        devEmail: localDev ? localDev.email_address : (selectedUser.emailAddress || "unassigned@company.com"),
        githubUsername: localDev ? localDev.github_username : null,
        interruptionReason: null,
        messages: [{
          role: "assistant",
          content: `✅ **Jira Assignee Selected:** Issue will be assigned to **${selectedUser.displayName}**. Checking workload...`
        }]
      };
    } else {
      let content = `⚠️ **Invalid Selection:** I couldn't match your input with any assignable Jira users. Please select the developer by typing their name or number:\n\n`;
      if (assignableJiraUsers && assignableJiraUsers.length > 0) {
        assignableJiraUsers.forEach((user, index) => {
          content += `${index + 1}. **${user.displayName}** (${user.accountId})\n`;
        });
      } else {
        activeTeam.forEach((user, index) => {
          content += `${index + 1}. **${user.name}** (${user.email_address})\n`;
        });
      }

      return {
        interruptionReason: "jira_assignee_selection_required",
        messages: [{
          role: "assistant",
          content
        }]
      };
    }
  }

  return {};
}
async function prepActionNode(state: typeof AgentState.State) {
  console.log("==> prepActionNode entered. state:", { projectId: state.projectId, devEmail: state.devEmail, devName: state.devName, pendingAction: !!state.pendingAction, actionApproved: state.actionApproved });
  if (!state.projectId || !state.devEmail || !state.devName) {
    return {
      projectId: null,
      devId: null,
      devName: null,
      devEmail: null,
      githubUsername: null,
      errorTrace: null,
      pendingAction: null,
      actionApproved: null,
      interruptionReason: null,
      intent: null,
      messages: [{ role: "assistant", content: "❌ **Triage aborted:** Missing telemetry values (Project, Developer Name, or Email) to prepare incident assignment." }]
    };
  }

  // Check if meeting time is required but missing
  if (!state.meetingTime) {
    return {
      interruptionReason: "meeting_time_required",
      messages: [{
        role: "assistant",
        content: `📅 **Meeting Time Required:** Please specify the date and time for the meeting (e.g. 'tomorrow at 3 PM', 'Monday at 10 AM', etc.) to schedule the sync for **${state.devName}**.`
      }]
    };
  }

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

  const now = new Date();
  let proposedTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
  proposedTime.setMinutes(0, 0, 0); // start at top of the hour
  
  const startTime = state.meetingTime ? new Date(state.meetingTime) : adjustToBusinessHours(proposedTime);

  // Check if we already have approval decision in message history
  if (state.pendingAction) {
    const lastMessage = state.messages[state.messages.length - 1]?.content || "";
    const responseLower = lastMessage.toLowerCase().trim();

    // 1. Check if the message contains a new email address to update the draft/assignee
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailMatch = lastMessage.match(emailRegex);
    if (emailMatch) {
      const extractedEmail = emailMatch[0].toLowerCase().trim();
      
      try {
        if (state.devId) {
          await supabase
            .from("team_members")
            .update({ email_address: extractedEmail })
            .eq("dev_id", state.devId);
        }
      } catch (dbErr) {
        console.error("Failed to update developer email in database:", dbErr);
      }
      
      const updatedAction = {
        ...state.pendingAction,
        schedule: {
          ...state.pendingAction.schedule,
          email: extractedEmail
        }
      };
      
      return {
        devEmail: extractedEmail,
        pendingAction: updatedAction,
        interruptionReason: "human_approval_required",
        messages: [{
          role: "assistant",
          content: `✉️ **Email Updated:** I have updated the email for **${state.devName}** to **${extractedEmail}** in the team directory and the draft action.\n\nShould I execute this action now? (Type **yes** to approve, or **no** to cancel)`
        }]
      };
    }

    // 2. If user says "yes" or approved:
    if (responseLower === "yes" || responseLower === "approve" || state.actionApproved === true) {
      return {
        actionApproved: true
      };
    }

    if (responseLower === "no" || responseLower === "cancel" || state.actionApproved === false) {
      return {
        actionApproved: false,
        pendingAction: null
      };
    }
  }

  // Otherwise, construct the action details and initiate human-in-the-loop interruption
  const actionPayload = {
    type: "ticket_and_schedule" as const,
    ticket: {
      project_id: state.projectId,
      error_context: state.errorTrace || "Unknown runtime crash."
    },
    schedule: {
      email: state.devEmail,
      name: state.devName
    }
  };

  // Check database for meeting conflict
  let conflictWarning = "";
  if (state.devId) {
    const { data: tickets } = await supabase
      .from("incident_tickets")
      .select("error_context, status")
      .eq("assigned_dev_id", state.devId)
      .eq("status", "Open");
      
    if (tickets) {
      for (const t of tickets) {
        if (t.error_context && t.error_context.includes(`[Scheduled: ${startTime.toISOString()}]`)) {
          conflictWarning = `\n\n⚠️ **Conflict Warning:** The database indicates that **${state.devName}** already has another incident sync scheduled at this time (\`${startTime.toLocaleString()}\`).`;
          break;
        }
      }
    }
  }

  return {
    pendingAction: actionPayload,
    interruptionReason: "human_approval_required",
    messages: [{
      role: "assistant",
      content: `📋 **Incident Action Drafted:**\n- **Project ID:** ${state.projectId}\n- **Assignee:** ${state.devName} (${state.devEmail})\n- **Meeting Time:** \`${startTime.toLocaleString()}\`\n- **Triage Action:** File incident ticket & schedule a 15-minute Google Meet.${conflictWarning}\n\nShould I execute this action? (Type **yes** to approve, or **no** to cancel)`
    }]
  };
}
async function executeActionNode(state: typeof AgentState.State) {
  console.log("==> executeActionNode entered. state:", { pendingAction: !!state.pendingAction, actionApproved: state.actionApproved, queueLength: state.overdueTasksQueue?.length });
  // Define a helper to build the return payload when popping the next task
  const getNextTaskPayload = (currentMsg: string) => {
    if (state.overdueTasksQueue && state.overdueTasksQueue.length > 0) {
      const queue = [...state.overdueTasksQueue];
      const nextTask = queue.shift();
      return {
        projectId: nextTask.project_id || (nextTask.active_projects as any)?.project_id,
        devId: nextTask.assigned_dev_id,
        devName: (nextTask.team_members as any)?.name || "Unknown Developer",
        devEmail: (nextTask.team_members as any)?.email_address || "unassigned@company.com",
        githubUsername: (nextTask.team_members as any)?.github_username || null,
        jiraAccountId: null,
        errorTrace: `Overdue Critical Task: ${nextTask.task_title}`,
        overdueTasksQueue: queue,
        actionApproved: null,
        pendingAction: null,
        interruptionReason: null,
        meetingTime: state.meetingTime,
        messages: [{
          role: "assistant",
          content: `${currentMsg}\n\n--- \n\nInitiating scheduling workflow for next critical overdue task: **${nextTask.task_title}**.`
        }]
      };
    }
    return null;
  };

  if (state.actionApproved === false) {
    const cancelMsg = "❌ **Action Cancelled:** Incident ticket has not been created and no calendar invite was sent.";
    const queuedPayload = getNextTaskPayload(cancelMsg);
    if (queuedPayload) return queuedPayload;

    return {
      projectId: null,
      devId: null,
      devName: null,
      devEmail: null,
      githubUsername: null,
      jiraAccountId: null,
      errorTrace: null,
      pendingAction: null,
      actionApproved: null,
      interruptionReason: null,
      intent: null,
      messages: [{ role: "assistant", content: cancelMsg }]
    };
  }

  if (!state.pendingAction) {
    return {
      projectId: null,
      devId: null,
      devName: null,
      devEmail: null,
      githubUsername: null,
      jiraAccountId: null,
      errorTrace: null,
      pendingAction: null,
      actionApproved: null,
      interruptionReason: null,
      intent: null
    };
  }

  const { ticket, schedule } = state.pendingAction;

  try {
    // Fetch project details for calendar event metadata
    const { data: project } = await supabase
      .from("active_projects")
      .select("project_name, jira_project_key")
      .eq("project_id", ticket.project_id)
      .single();
    const projectName = project?.project_name || "Unknown Project";

    // 1. Create Incident Ticket in Supabase
    const { data: ticketRecord, error: ticketErr } = await supabase
      .from("incident_tickets")
      .insert({
        project_id: ticket.project_id,
        assigned_dev_id: state.devId,
        error_context: ticket.error_context,
        status: "Open"
      })
      .select()
      .single();

    if (ticketErr) {
      throw new Error(`Supabase Ticket Save Failed: ${ticketErr.message}`);
    }

    // 1.5 Create Jira Issue in Backlog if linked
    let jiraIssueUrl = "";
    let jiraIssueKey = "";
    if (project?.jira_project_key) {
      try {
        const jiraResult = await services.jiraService.createIssue(
          project.jira_project_key,
          `[AEL Incident] ${ticket.error_context}`,
          `Incident Ticket ID: ${ticketRecord.ticket_id}\nProject: ${projectName}\nDeveloper: ${schedule.name} (${schedule.email})\nError Context: ${ticket.error_context}`,
          state.devEmail || undefined,
          undefined,
          state.jiraAccountId || undefined
        );
        jiraIssueUrl = jiraResult.url;
        jiraIssueKey = jiraResult.key;
      } catch (jiraErr: any) {
        console.error("Failed to create Jira issue:", jiraErr);
      }
    }

    // 2. Schedule Calendar Event & Google Meet
    let meetLink = "";
    let eventUrl = "";
    let meetStart = new Date().toISOString();
    
    try {
      const meeting = await services.calendarService.scheduleSyncMeeting(
        schedule.email,
        schedule.name,
        ticket.error_context,
        projectName,
        ticketRecord.ticket_id,
        state.meetingTime
      );
      meetLink = meeting.meetLink;
      eventUrl = meeting.eventUrl || "";
      meetStart = meeting.startDateTime;

      // Update incident ticket error_context with the scheduled meeting details
      const updatedContext = `[Scheduled: ${meetStart} | Link: ${meetLink}] ${ticket.error_context}`;
      await supabase
        .from("incident_tickets")
        .update({ error_context: updatedContext })
        .eq("ticket_id", ticketRecord.ticket_id);

    } catch (calError: any) {
      console.error("Google Calendar API failure:", calError);
      const isAuthError = calError.message?.includes("401") || calError.message?.includes("auth") || calError.message?.includes("GOOGLE_CALENDAR_AUTH_MISSING");
      
      const calendarErrorMsg = isAuthError
        ? "⚠️ **Google Calendar authorization has expired. Please re-authenticate to schedule meetings.**"
        : "⚠️ **Google Calendar API request failed. The meeting was not scheduled. Please create the meeting manually.**";

      const queuedPayload = getNextTaskPayload(calendarErrorMsg);
      if (queuedPayload) return queuedPayload;

      return {
        projectId: null,
        devId: null,
        devName: null,
        devEmail: null,
        githubUsername: null,
        jiraAccountId: null,
        errorTrace: null,
        pendingAction: null,
        actionApproved: null,
        interruptionReason: null,
        intent: null,
        messages: [{ role: "assistant", content: calendarErrorMsg }]
      };
    }

    const meetingDate = new Date(meetStart).toLocaleString();
    let successMsg = `✅ **Incident Triage Complete!**\n\n1. **Ticket Filed:** Logged Ticket successfully in your database.\n2. **Meeting Scheduled:** Google Calendar invite sent to **${schedule.name}** (${schedule.email}) for **${meetingDate}**.\n   - **Event URL:** ${eventUrl}\n   - **Video Conference (Meet):** ${meetLink}`;
    if (jiraIssueKey) {
      successMsg += `\n3. **Jira Backlog Ticket Created:** [${jiraIssueKey}](${jiraIssueUrl})`;
    }

    const queuedPayload = getNextTaskPayload(successMsg);
    if (queuedPayload) return queuedPayload;

    return {
      projectId: null,
      devId: null,
      devName: null,
      devEmail: null,
      githubUsername: null,
      jiraAccountId: null,
      errorTrace: null,
      pendingAction: null,
      actionApproved: null,
      interruptionReason: null,
      intent: null,
      messages: [{ role: "assistant", content: successMsg }]
    };

  } catch (error: any) {
    console.error("Incident execution failure:", error);
    const generalErrorMsg = `❌ **Incident Triage Execution Failed:** ${error.message}`;

    const queuedPayload = getNextTaskPayload(generalErrorMsg);
    if (queuedPayload) return queuedPayload;

    return {
      projectId: null,
      devId: null,
      devName: null,
      devEmail: null,
      githubUsername: null,
      jiraAccountId: null,
      errorTrace: null,
      pendingAction: null,
      actionApproved: null,
      interruptionReason: null,
      intent: null,
      messages: [{ role: "assistant", content: generalErrorMsg }]
    };
  }
}
// 3. Define Conditional Routing Logic

function determineIntentRoute(state: typeof AgentState.State) {
  console.log("==> determineIntentRoute called. state:", { intent: state.intent, errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction, interruptionReason: state.interruptionReason, actionApproved: state.actionApproved });
  if (state.pendingAction && state.actionApproved !== null) {
    return "executeActionNode";
  }
  if (state.interruptionReason) {
    return "resolveIdentityNode";
  }
  if ((state.intent === "schedule" || (state.errorTrace && state.devEmail)) && !state.pendingAction) {
    return "checkWorkloadNode";
  }
  if (state.intent === "standup") {
    return "standupNode";
  }
  if (state.intent === "jira_status") {
    return "jiraStatusNode";
  }
  if (state.intent === "investigate") {
    return "fetchAlertNode";
  }
  return END;
}

function determineAlertRoute(state: typeof AgentState.State) {
  if (!state.projectId) return END;
  return "fetchCommitsNode";
}

function determineCommitsRoute(state: typeof AgentState.State) {
  if (state.interruptionReason) return END;
  return "semanticAuditNode";
}

function determineAuditRoute(state: typeof AgentState.State) {
  if (state.interruptionReason) return END;
  return "checkWorkloadNode";
}

function determineWorkloadRoute(state: typeof AgentState.State) {
  console.log("==> determineWorkloadRoute called. state:", { interruptionReason: state.interruptionReason });
  if (state.interruptionReason) {
    return END;
  }
  return "prepActionNode";
}
function determineApprovalRoute(state: typeof AgentState.State) {
  console.log("==> determineApprovalRoute called. state:", { interruptionReason: state.interruptionReason });
  if (state.interruptionReason) {
    return END;
  }
  return "executeActionNode";
}

function determineIdentityRoute(state: typeof AgentState.State) {
  if (state.interruptionReason) {
    return END;
  }
  if (state.devEmail && state.errorTrace) {
    const lastMessage = state.messages[state.messages.length - 1]?.content || "";
    const responseLower = lastMessage.toLowerCase().trim();
    if (responseLower === "yes" || responseLower === "yes proceed" || responseLower === "proceed") {
      return "prepActionNode";
    }
    return "checkWorkloadNode";
  }
  return END;
}
function determineActionRoute(state: typeof AgentState.State) {
  console.log("==> determineActionRoute called. state:", { errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction });
  if (state.errorTrace && state.devEmail && !state.pendingAction) {
    return "checkWorkloadNode";
  }
  return END;
}

// 4. Construct the Workflow StateGraph
const workflow = new StateGraph(AgentState)
  .addNode("routeIntentNode", routeIntentNode)
  .addNode("resolveIdentityNode", resolveIdentityNode)
  .addNode("standupNode", standupNode)
  .addNode("jiraStatusNode", jiraStatusNode)
  .addNode("fetchAlertNode", fetchAlertNode)
  .addNode("fetchCommitsNode", fetchCommitsNode)
  .addNode("semanticAuditNode", semanticAuditNode)
  .addNode("checkWorkloadNode", checkWorkloadNode)
  .addNode("prepActionNode", prepActionNode)
  .addNode("executeActionNode", executeActionNode);

// Define Graph Transitions
workflow.addEdge(START, "routeIntentNode");

workflow.addConditionalEdges("routeIntentNode", determineIntentRoute, {
  resolveIdentityNode: "resolveIdentityNode",
  standupNode: "standupNode",
  jiraStatusNode: "jiraStatusNode",
  fetchAlertNode: "fetchAlertNode",
  checkWorkloadNode: "checkWorkloadNode",
  executeActionNode: "executeActionNode",
  [END]: END
});

workflow.addEdge("standupNode", END);
workflow.addEdge("jiraStatusNode", END);

workflow.addConditionalEdges("fetchAlertNode", determineAlertRoute, {
  fetchCommitsNode: "fetchCommitsNode",
  [END]: END
});

workflow.addConditionalEdges("fetchCommitsNode", determineCommitsRoute, {
  semanticAuditNode: "semanticAuditNode",
  [END]: END
});

workflow.addConditionalEdges("semanticAuditNode", determineAuditRoute, {
  checkWorkloadNode: "checkWorkloadNode",
  [END]: END
});

workflow.addConditionalEdges("checkWorkloadNode", determineWorkloadRoute, {
  prepActionNode: "prepActionNode",
  [END]: END
});

workflow.addConditionalEdges("resolveIdentityNode", determineIdentityRoute, {
  checkWorkloadNode: "checkWorkloadNode",
  prepActionNode: "prepActionNode",
  [END]: END
});

workflow.addConditionalEdges("prepActionNode", determineApprovalRoute, {
  executeActionNode: "executeActionNode",
  [END]: END
});

workflow.addConditionalEdges("executeActionNode", determineActionRoute, {
  checkWorkloadNode: "checkWorkloadNode",
  [END]: END
});

// Export compiled graph without checkpointer here (we inject checkpointer dynamically in Next.js router)
export const aelGraph = workflow;
