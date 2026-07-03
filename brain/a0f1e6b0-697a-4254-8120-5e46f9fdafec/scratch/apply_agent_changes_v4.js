const fs = require('fs');
const path = require('path');

const filePath = 'f:\\z361\\src\\lib\\agent.ts';
let lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Helper to find line index by trimmed start
function findTrimmedStart(lines, prefix) {
  return lines.findIndex(l => l.trim().startsWith(prefix));
}

// 1. Add meetingTime to AgentState if it doesn't already exist
if (!lines.some(l => l.includes('meetingTime: Annotation'))) {
  const stateIndex = lines.findIndex(l => l.includes('overdueTasksQueue: Annotation<any[]>'));
  if (stateIndex === -1) {
    throw new Error("Could not find overdueTasksQueue annotation in agent.ts");
  }
  let closingBraceIndex = -1;
  for (let i = stateIndex; i < lines.length; i++) {
    if (lines[i].trim() === '}),') {
      closingBraceIndex = i;
      break;
    }
  }
  if (closingBraceIndex === -1) {
    throw new Error("Could not find closing brace of overdueTasksQueue in agent.ts");
  }

  const meetingTimeAnnot = [
    '  meetingTime: Annotation<string | null>({',
    '    reducer: (x, y) => (y !== undefined ? y : x),',
    '    default: () => null,',
    '  }),'
  ];

  lines.splice(closingBraceIndex + 1, 0, ...meetingTimeAnnot);
}

// Re-read joined to keep indices aligned
let content = lines.join('\n');
lines = content.split('\n');

// 2. Replace routeIntentNode
// Starts at async function routeIntentNode
// Ends before async function standupNode
const routeIntentStart = findTrimmedStart(lines, 'async function routeIntentNode(');
const routeIntentEnd = findTrimmedStart(lines, 'async function standupNode(');

if (routeIntentStart === -1 || routeIntentEnd === -1) {
  throw new Error(`routeIntentNode range not found: start=${routeIntentStart}, end=${routeIntentEnd}`);
}

const newRouteIntent = `async function routeIntentNode(state: typeof AgentState.State, config?: any) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  console.log("==> routeIntentNode entered. lastMessage:", lastMessage, "state:", { intent: state.intent, errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction, interruptionReason: state.interruptionReason, queueLength: state.overdueTasksQueue?.length });

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
      // Search for developer in the user message or state
      const { data: teamMembers } = await supabase.from("team_members").select("dev_id, name, email_address, github_username");
      const activeTeam = teamMembers || [];

      let foundMember = null;
      for (const m of activeTeam) {
        const nameWords = m.name.toLowerCase().split(/\\s+/).filter((w: any) => w.length > 2);
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
          const prompt = \`Extract any developer name or email from this message: "\${lastMessage}". Return a JSON object with keys "name" (string or null) and "email" (string or null).\`;
          const response = await getModel(config).invoke(prompt);
          const parsed = JSON.parse(response.content.toString().replace(/\\\`\\\`\\\`json/g, "").replace(/\\\`\\\`\\\`/g, "").trim());
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
        intent: "investigate",
        messages: [{
          role: "assistant",
          content: \`✅ **Project Selected:** Project context set to **\${selectedProj.project_name}**.\`
        }]
      };
    } else {
      return {
        interruptionReason: "project_selection_required",
        messages: [{
          role: "assistant",
          content: \`⚠️ **Invalid Selection:** I couldn't match your input with any active projects. Please select the project by typing its name or number:\\n\\n\` + activeProjects.map((p, idx) => \`\${idx + 1}. **\${p.project_name}**\`).join("\\n")
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
  const prompt = \`Classify the following developer message and extract details if applicable.
Current time: \${new Date().toISOString()} (Use this to resolve relative dates/times like 'tomorrow', 'next monday', 'at 3 PM').

Intents:
1. "standup" - The user is asking for a status update, workload summaries, missed deadlines, or task updates.
2. "investigate" - The user wants to check/investigate a system crash, alert, or database error.
3. "schedule" - The user explicitly wants to schedule a follow-up sync/meeting, book a meeting, or invite a developer to a meeting.
4. "list_meetings" - The user wants to view, show, list, or check scheduled meetings/syncs, optionally filtering by developer or time.
5. "general" - Any other general chat, greeting, or question (e.g. how to change developer gmail, how to add developer, how to use the dashboard).

User Message: "\${lastMessage}"

Return a JSON object ONLY in the following format:
{
  "intent": "standup" | "investigate" | "schedule" | "list_meetings" | "general",
  "devEmail": "extracted_email_if_provided_else_null",
  "devName": "extracted_developer_name_if_provided_else_null",
  "reason": "extracted_meeting_reason_or_context_if_provided_else_null",
  "proposedTime": "ISO_datetime_string_if_provided_else_null"
}\`;

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
    const cleanedText = response.content.toString().replace(/\\\`\\\`\\\`json/g, "").replace(/\\\`\\\`\\\`/g, "").trim();
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
    return { intent: "standup", overdueTasksQueue: [] };
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
          const match = t.error_context.match(/^\\\[Scheduled:\\s*([^|]+)\\|\\s*Link:\\s*([^\\\]]+)\\\]\\s*(.*)$/);
          if (match) {
            const timeStr = match[1];
            const meetLink = match[2];
            const originalContext = match[3];
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
      content = \`📅 **Scheduled Incident Sync Meetings:**\\n\\n\`;
      content += \`| Developer | Project | Date & Time | Meet Link | Status | Reason |\\n\`;
      content += \`| :--- | :--- | :--- | :--- | :--- | :--- |\\n\`;
      for (const m of filtered) {
        content += \`| **\${m.devName}** | <u>\${m.projectName}</u> | \\\`\${m.time.toLocaleString()}\\\` | [Google Meet](\${m.meetLink}) | \\\`\${m.status}\\\` | \${m.reason} |\\n\`;
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
      const nameWords = m.name.toLowerCase().split(/\\s+/).filter((w: any) => w.length > 2);
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
        intent: "investigate",
        devId,
        devEmail: email,
        devName: name,
        githubUsername,
        errorTrace: reason,
        meetingTime: classified.proposedTime,
        interruptionReason: "project_selection_required",
        messages: [{
          role: "assistant",
          content: \`🔍 **Multiple Projects Found:** I detected a scheduling request for **\${name}** but did not find which project it belongs to. Please specify the project by typing its name or number:\\n\\n\` + activeProjects.map((p, idx) => \`\${idx + 1}. **\${p.project_name}**\`).join("\\n")
        }]
      };
    }

    const projId = matchedProj ? matchedProj.project_id : null;

    return {
      intent: "investigate",
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
    const response = await getModel(config).invoke(\`You are the Autonomous Engineering Lead (AEL) SRE Agent. Respond to the user's message in a helpful and concise manner.
User message: "\${lastMessage}"

If the user is asking how to change developer emails, add new developers, or modify Supabase records:
- Tell them they can do so using the "Team" tab on the sidebar.
- Advise that they can also change the email address of a developer during an active meeting scheduling draft by typing the new email address here in the chat console.

If the user is asking how to select a project:
- Tell them they can do so by going to the "Projects" tab and clicking on any card or list row. The active project will be highlighted in green.\`);
    
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
        errorTrace: \`Overdue Critical Task: \${task.task_title}\`,
        intent: "investigate",
        actionApproved: null,
        pendingAction: null,
        messages: [{ role: "assistant", content: \`Initiating scheduling workflow for critical overdue task: **\${task.task_title}**.\` }]
      };
    }

    // Prompt user for clarification if response is ambiguous
    return {
      messages: [{ role: "assistant", content: "I recommend scheduling follow-up syncs for all Critical overdue items. Would you like me to proceed? (Type **yes** to schedule meetings, or **no** to decline)" }]
    };
  }

  return { intent: classified.intent };
}`;

lines.splice(routeIntentStart, routeIntentEnd - routeIntentStart, ...newRouteIntent.split('\n'));

// Write files and reload from disk to ensure indices are updated and clean
content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// 3. Replace checkWorkloadNode
const checkWorkloadStart = findTrimmedStart(lines, 'async function checkWorkloadNode(');
const checkWorkloadEnd = findTrimmedStart(lines, 'async function resolveIdentityNode(');

if (checkWorkloadStart === -1 || checkWorkloadEnd === -1) {
  throw new Error(`checkWorkloadNode range not found: start=${checkWorkloadStart}, end=${checkWorkloadEnd}`);
}

const newCheckWorkload = `async function checkWorkloadNode(state: typeof AgentState.State) {
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
      .ilike("name", \`%\${state.devName}%\`);
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
          content: \`⚠️ **Identity Mismatch:** I identified the culprit as **@\${state.githubUsername}**, but they do not exist in our corporate directory.\\n\\nPlease type their corporate email address to proceed with the scheduling flow.\`
        }]
      };
    }

    return {
      interruptionReason: "developer_email_required",
      messages: [{
        role: "assistant",
        content: \`⚠️ **Developer Not Found:** I couldn't find a developer matching **\${state.devName || "the target assignee"}** in the team directory.\\n\\nPlease type their corporate email address to register them in Supabase and proceed with scheduling.\`
      }]
    };
  }

  const githubUser = member.github_username || state.githubUsername || "unmapped";

  // 2. Query target developer overdue or critical tasks
  const { data: tasks } = await supabase
    .from("sprint_tasks")
    .select("task_id, task_title, priority")
    .eq("assigned_dev_id", member.dev_id)
    .or(\`priority.eq.Critical,due_date.lt.\${new Date().toISOString()}\`)
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
        content: \`⚠️ **Workload Overload Alert:** I traced the bug to **\${member.name}** (@\${githubUser}), but they currently have **\${overdueCount} critical or overdue tasks** in this sprint.\\n\\nShould I proceed with assigning this high-priority bug and booking a sync meeting for them? (Type 'yes' or specify a different developer's name/email to reassign).\`
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
}`;

lines.splice(checkWorkloadStart, checkWorkloadEnd - checkWorkloadStart, ...newCheckWorkload.split('\n'));

content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// 4. Replace resolveIdentityNode
const resolveIdentityStart = findTrimmedStart(lines, 'async function resolveIdentityNode(');
const resolveIdentityEnd = findTrimmedStart(lines, 'async function prepActionNode(');

if (resolveIdentityStart === -1 || resolveIdentityEnd === -1) {
  throw new Error(`resolveIdentityNode range not found: start=${resolveIdentityStart}, end=${resolveIdentityEnd}`);
}

const newResolveIdentity = `async function resolveIdentityNode(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";

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
        messages: [{ role: "assistant", content: \`Please provide a valid corporate email address (e.g. developer@company.com) to register **\${state.devName || "the developer"}**.\` }]
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
      query = query.ilike("name", \`%\${queryTerm}%\`);
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
        content: \`I could not find a developer in the team directory matching '\${queryTerm}'. Please enter a valid corporate email address or team member name, or type 'yes' to proceed with the original assignment.\` 
      }]
    };
  }

  return {};
}`;

lines.splice(resolveIdentityStart, resolveIdentityEnd - resolveIdentityStart, ...newResolveIdentity.split('\n'));

content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// 5. Replace prepActionNode
const prepActionStart = findTrimmedStart(lines, 'async function prepActionNode(');
const prepActionEnd = findTrimmedStart(lines, 'async function executeActionNode(');

if (prepActionStart === -1 || prepActionEnd === -1) {
  throw new Error(`prepActionNode range not found: start=${prepActionStart}, end=${prepActionEnd}`);
}

const newPrepAction = `async function prepActionNode(state: typeof AgentState.State) {
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
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/;
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
          content: \`✉️ **Email Updated:** I have updated the email for **\${state.devName}** to **\${extractedEmail}** in the team directory and the draft action.\\n\\nShould I execute this action now? (Type **yes** to approve, or **no** to cancel)\`
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
        if (t.error_context && t.error_context.includes(\`[Scheduled: \${startTime.toISOString()}]\`)) {
          conflictWarning = \`\\n\\n⚠️ **Conflict Warning:** The database indicates that **\${state.devName}** already has another incident sync scheduled at this time (\\\`\${startTime.toLocaleString()}\\\`).\`;
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
      content: \`📋 **Incident Action Drafted:**\\n- **Project ID:** \${state.projectId}\\n- **Assignee:** \${state.devName} (\${state.devEmail})\\n- **Meeting Time:** \\\`\${startTime.toLocaleString()}\\\`\\n- **Triage Action:** File incident ticket & schedule a 15-minute Google Meet.\${conflictWarning}\\n\\nShould I execute this action? (Type **yes** to approve, or **no** to cancel)\`
    }]
  };
}`;

lines.splice(prepActionStart, prepActionEnd - prepActionStart, ...newPrepAction.split('\n'));

content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// 6. Replace executeActionNode
const executeActionStart = findTrimmedStart(lines, 'async function executeActionNode(');
const executeActionEnd = lines.findIndex(l => l.includes('// 3. Define Conditional Routing Logic'));

if (executeActionStart === -1 || executeActionEnd === -1) {
  throw new Error(`executeActionNode range not found: start=${executeActionStart}, end=${executeActionEnd}`);
}

const newExecuteAction = `async function executeActionNode(state: typeof AgentState.State) {
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
        errorTrace: \`Overdue Critical Task: \${nextTask.task_title}\`,
        overdueTasksQueue: queue,
        actionApproved: null,
        pendingAction: null,
        interruptionReason: null,
        meetingTime: state.meetingTime,
        messages: [{
          role: "assistant",
          content: \`\${currentMsg}\\n\\n--- \\n\\nInitiating scheduling workflow for next critical overdue task: **\${nextTask.task_title}**.\`
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
      throw new Error(\`Supabase Ticket Save Failed: \${ticketErr.message}\`);
    }

    // 1.5 Create Jira Issue in Backlog if linked
    let jiraIssueUrl = "";
    let jiraIssueKey = "";
    if (project?.jira_project_key) {
      try {
        const jiraResult = await services.jiraService.createIssue(
          project.jira_project_key,
          \`[AEL Incident] \${ticket.error_context}\`,
          \`Incident Ticket ID: \${ticketRecord.ticket_id}\\nProject: \${projectName}\\nDeveloper: \${schedule.name} (\${schedule.email})\\nError Context: \${ticket.error_context}\`,
          state.devEmail || undefined
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
      const updatedContext = \`[Scheduled: \${meetStart} | Link: \${meetLink}] \${ticket.error_context}\`;
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
        errorTrace: null,
        pendingAction: null,
        actionApproved: null,
        interruptionReason: null,
        intent: null,
        messages: [{ role: "assistant", content: calendarErrorMsg }]
      };
    }

    const meetingDate = new Date(meetStart).toLocaleString();
    let successMsg = \`✅ **Incident Triage Complete!**\\n\\n1. **Ticket Filed:** Logged Ticket successfully in your database.\\n2. **Meeting Scheduled:** Google Calendar invite sent to **\${schedule.name}** (\${schedule.email}) for **\${meetingDate}**.\\n   - **Event URL:** \${eventUrl}\\n   - **Video Conference (Meet):** \${meetLink}\`;
    if (jiraIssueKey) {
      successMsg += \`\\n3. **Jira Backlog Ticket Created:** [\${jiraIssueKey}](\${jiraIssueUrl})\`;
    }

    const queuedPayload = getNextTaskPayload(successMsg);
    if (queuedPayload) return queuedPayload;

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
      messages: [{ role: "assistant", content: successMsg }]
    };

  } catch (error: any) {
    console.error("Incident execution failure:", error);
    const generalErrorMsg = \`❌ **Incident Triage Execution Failed:** \${error.message}\`;

    const queuedPayload = getNextTaskPayload(generalErrorMsg);
    if (queuedPayload) return queuedPayload;

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
      messages: [{ role: "assistant", content: generalErrorMsg }]
    };
  }
}`;

lines.splice(executeActionStart, executeActionEnd - executeActionStart, ...newExecuteAction.split('\n'));

content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

// 7. Replace determineWorkloadRoute and determineIdentityRoute
const workloadRouteStart = findTrimmedStart(lines, 'function determineWorkloadRoute(');
const workloadRouteEnd = findTrimmedStart(lines, 'function determineApprovalRoute(');

if (workloadRouteStart === -1 || workloadRouteEnd === -1) {
  throw new Error(`determineWorkloadRoute range not found: start=${workloadRouteStart}, end=${workloadRouteEnd}`);
}

const newWorkloadRoute = `function determineWorkloadRoute(state: typeof AgentState.State) {
  console.log("==> determineWorkloadRoute called. state:", { interruptionReason: state.interruptionReason });
  if (state.interruptionReason) {
    return END;
  }
  return "prepActionNode";
}`;

lines.splice(workloadRouteStart, workloadRouteEnd - workloadRouteStart, ...newWorkloadRoute.split('\n'));

content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
lines = fs.readFileSync(filePath, 'utf8').split('\n');

const identityRouteStart = findTrimmedStart(lines, 'function determineIdentityRoute(');
const identityRouteEnd = findTrimmedStart(lines, 'function determineActionRoute(');

if (identityRouteStart === -1 || identityRouteEnd === -1) {
  throw new Error(`determineIdentityRoute range not found: start=${identityRouteStart}, end=${identityRouteEnd}`);
}

const newIdentityRoute = `function determineIdentityRoute(state: typeof AgentState.State) {
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
}`;

lines.splice(identityRouteStart, identityRouteEnd - identityRouteStart, ...newIdentityRoute.split('\n'));

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log('Successfully applied all changes to f:\\z361\\src\\lib\\agent.ts');
