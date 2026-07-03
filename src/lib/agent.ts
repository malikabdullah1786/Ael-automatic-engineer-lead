import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { supabase } from "./supabase";
import { services } from "./services/container";

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
  intent: Annotation<"standup" | "investigate" | "general" | null>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  }),
  overdueTasksQueue: Annotation<any[]>({
    reducer: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  }),
});

// 2. Node Implementations

/**
 * Route User Intent: Classify query and determine next node
 */
async function routeIntentNode(state: typeof AgentState.State, config?: any) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";
  console.log("==> routeIntentNode entered. lastMessage:", lastMessage, "state:", { intent: state.intent, errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction, interruptionReason: state.interruptionReason, queueLength: state.overdueTasksQueue?.length });

  // If there is an active interruption, let's bypass intent routing
  if (state.interruptionReason) {
    return {};
  }

  // If we are resuming from a pending action or have manually resolved developer email, bypass intent routing
  if (state.pendingAction || (state.errorTrace && state.devEmail)) {
    return {};
  }

  // Check user intent using LLM
  const prompt = `Classify the following developer message into one of three intents:
1. "standup" - The user is asking for a status update, workload summaries, missed deadlines, or task updates.
2. "investigate" - The user wants to check/investigate a system crash, alert, or database error.
3. "general" - Any other general chat or greeting.

User Message: "${lastMessage}"

Return ONLY one word: "standup", "investigate", or "general".`;

  const response = await getModel(config).invoke(prompt);
  const intentStr = response.content.toString().trim().toLowerCase();
  
  let classifiedIntent: "standup" | "investigate" | "general" = "general";
  if (intentStr.includes("standup")) classifiedIntent = "standup";
  if (intentStr.includes("investigate")) classifiedIntent = "investigate";

  // If we have overdue tasks queue but user asks for a fresh standup, clear the queue and proceed with standup
  if (classifiedIntent === "standup") {
    return { intent: "standup", overdueTasksQueue: [] };
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

  return { intent: classifiedIntent };
}

/**
 * Daily Standup Node (Epic 1)
 * Queries tasks and drafts a workload & priority summary
 */
async function standupNode(state: typeof AgentState.State) {
  // Query tasks and team members
  const { data: tasks, error: tasksErr } = await supabase
    .from("sprint_tasks")
    .select(`
      task_id,
      task_title,
      status,
      priority,
      due_date,
      project_id,
      assigned_dev_id,
      active_projects (project_id, project_name),
      team_members (dev_id, name, email_address, github_username, role)
    `);

  if (tasksErr || !tasks) {
    return {
      messages: [{ role: "assistant", content: `Failed to retrieve sprint tasks from database: ${tasksErr?.message}` }],
    };
  }

  const now = new Date();

  // Classify overdue tasks (due_date in the past and status is not Completed)
  const overdueTasks = tasks.filter((t: any) => {
    return new Date(t.due_date) < now && t.status !== "Completed";
  });

  if (overdueTasks.length === 0) {
    return {
      messages: [{ role: "assistant", content: "All sprint tasks are on track. No overdue items found." }],
      overdueTasksQueue: []
    };
  }

  // Priority order weight
  const priorityWeight = {
    "Critical": 4,
    "High": 3,
    "Medium": 2,
    "Low": 1
  } as any;

  // Sort overdue tasks so Critical is first, then High, then Medium, then Low
  overdueTasks.sort((a: any, b: any) => {
    const wA = priorityWeight[a.priority] || 0;
    const wB = priorityWeight[b.priority] || 0;
    return wB - wA;
  });

  // Group by assigned_dev_id
  const devGroup: Record<string, { name: string; email: string; tasks: any[] }> = {};
  for (const t of overdueTasks) {
    const devId = t.assigned_dev_id || "unassigned";
    const devName = (t.team_members as any)?.name || "Unassigned Developer";
    const devEmail = (t.team_members as any)?.email_address || "unassigned@company.com";
    if (!devGroup[devId]) {
      devGroup[devId] = { name: devName, email: devEmail, tasks: [] };
    }
    devGroup[devId].tasks.push(t);
  }

  // Build the structured summary
  let summaryContent = "📊 **Sprint Overdue Tasks Summary**\n\n";
  for (const [_, info] of Object.entries(devGroup)) {
    summaryContent += `👤 **Developer:** ${info.name} (${info.email})\n`;
    for (const t of info.tasks) {
      summaryContent += `  - **[${t.priority}]** ${t.task_title} (Due: ${new Date(t.due_date).toLocaleDateString()}, Status: ${t.status})\n`;
    }
    summaryContent += "\n";
  }

  const criticalOverdueTasks = overdueTasks.filter((t: any) => t.priority === "Critical");

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
      // Edge Case 2: Infrastructure mismatch
      return {
        githubUsername: null,
        interruptionReason: "unmapped_identity",
        messages: [{ 
          role: "assistant", 
          content: `⚠️ **Infrastructure-Level Crash Detected:**\n${result.explanation}\n\nNo recent commits match this error trace. Would you like to manually assign this bug and schedule a sync meeting? Please type the developer's corporate email address to proceed.` 
        }]
      };
    }
  } catch (err) {
    return {
      githubUsername: null,
      interruptionReason: "unmapped_identity",
      messages: [{ 
        role: "assistant", 
        content: `⚠️ **Audit Failure:** Failed to perform semantic audit on git commits.\n\nWould you like to manually assign this bug and schedule a sync meeting? Please type the developer's corporate email address to proceed.` 
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
  } else if (state.devEmail) {
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

  if (!member) {
    if (state.githubUsername) {
      return {
        devId: null,
        interruptionReason: "unmapped_identity",
        messages: [{
          role: "assistant",
          content: `⚠️ **Identity Mismatch:** I identified the commit culprit as **@${state.githubUsername}**, but they do not exist in our corporate directory.\n\nPlease type their corporate email address to proceed with the scheduling flow.`
        }]
      };
    }
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
      messages: [{ role: "assistant", content: "❌ **Triage skipped:** Target developer not found in the team directory." }]
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
  };
}

/**
 * Resolve Identity Node
 * Direct entry node if user provides input during identity/overload interrupts
 */
async function resolveIdentityNode(state: typeof AgentState.State) {
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

  // 2. If we were interrupted by workload_overload, check user approval or reassignment
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

  return {};
}

/**
 * Prepare Action details (Epic 3 / Edge Case 5)
 * Drafts the incident details and flags a pause for human authorization
 */
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
          content: `\uD83D\uDCE7 **Email Updated:** I have updated the email for **${state.devName}** to **${extractedEmail}** in the team directory and the draft action.\n\nShould I execute this action now? (Type **yes** to approve, or **no** to cancel)`
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

  return {
    pendingAction: actionPayload,
    interruptionReason: "human_approval_required",
    messages: [{
      role: "assistant",
      content: `\uD83D\uDCCB **Incident Action Drafted:**\n- **Project ID:** ${state.projectId}\n- **Assignee:** ${state.devName} (${state.devEmail})\n- **Triage Action:** File incident ticket & schedule a 15-minute Google Meet.\n\nShould I execute this action? (Type **yes** to approve, or **no** to cancel)`
    }]
  };
}

/**
 * Execute Action Node (Epic 3)
 * Commits the incident ticket to Supabase and books the Calendar + Meet invite
 */
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
        errorTrace: `Overdue Critical Task: ${nextTask.task_title}`,
        overdueTasksQueue: queue,
        actionApproved: null,
        pendingAction: null,
        interruptionReason: null,
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
      .select("project_name")
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
        ticketRecord.ticket_id
      );
      meetLink = meeting.meetLink;
      eventUrl = meeting.eventUrl || "";
      meetStart = meeting.startDateTime;
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
    const successMsg = `✅ **Incident Triage Complete!**\n\n1. **Ticket Filed:** Logged Ticket successfully in your database.\n2. **Meeting Scheduled:** Google Calendar invite sent to **${schedule.name}** (${schedule.email}) for **${meetingDate}**.\n   - **Event URL:** ${eventUrl}\n   - **Video Conference (Meet):** ${meetLink}`;

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

  } catch (err: any) {
    if (err.message?.includes("Supabase Ticket Save Failed")) {
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
        messages: [{
          role: "assistant",
          content: `❌ **Incident ticket creation failed due to a database error. The scheduling step has been skipped.**`
        }]
      };
    }
    
    const generalErrorMsg = `❌ **Failed to execute triage actions:** ${err.message}`;
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
}

// 3. Define Conditional Routing Logic

function determineIntentRoute(state: typeof AgentState.State) {
  console.log("==> determineIntentRoute called. state:", { intent: state.intent, errorTrace: state.errorTrace, devEmail: state.devEmail, pendingAction: !!state.pendingAction, interruptionReason: state.interruptionReason, actionApproved: state.actionApproved });
  if (state.pendingAction && state.actionApproved !== null) {
    return "executeActionNode";
  }
  if (state.errorTrace && state.devEmail && !state.pendingAction) {
    return "checkWorkloadNode";
  }
  if (state.interruptionReason) {
    return "resolveIdentityNode";
  }
  if (state.intent === "standup") {
    return "standupNode";
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
  if (state.interruptionReason === "workload_overload") {
    return END;
  }
  return "prepActionNode";
}

function determineApprovalRoute(state: typeof AgentState.State) {
  console.log("==> determineApprovalRoute called. state:", { interruptionReason: state.interruptionReason });
  if (state.interruptionReason === "human_approval_required") {
    return END;
  }
  return "executeActionNode";
}

function determineIdentityRoute(state: typeof AgentState.State) {
  if (state.devEmail && state.errorTrace) {
    // If resuming from workload warning override, bypass rechecking workload
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
  fetchAlertNode: "fetchAlertNode",
  checkWorkloadNode: "checkWorkloadNode",
  executeActionNode: "executeActionNode",
  [END]: END
});

workflow.addEdge("standupNode", END);

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
