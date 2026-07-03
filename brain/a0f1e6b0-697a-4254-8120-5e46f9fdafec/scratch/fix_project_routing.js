const fs = require('fs');
const path = require('path');

const filePath = 'f:\\z361\\src\\lib\\agent.ts';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Replace routeIntentNode
const oldRouteIntentStart = `async function routeIntentNode(state: typeof AgentState.State, config?: any) {`;
const oldRouteIntentEnd = `    return {
      intent: "investigate", // Route using investigate transitions
      projectId: projId,
      devEmail: email,
      devName: name,
      errorTrace: reason,
    };
  }

  return {};
}`;

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
        const nameWords = m.name.toLowerCase().split(/\\s+/).filter(w => w.length > 2);
        if (msgLower.includes(m.name.toLowerCase()) || nameWords.some(w => msgLower.includes(w))) {
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
Intents:
1. "standup" - The user is asking for a status update, workload summaries, missed deadlines, or task updates.
2. "investigate" - The user wants to check/investigate a system crash, alert, or database error.
3. "schedule" - The user explicitly wants to schedule a follow-up sync/meeting, book a meeting, or invite a developer to a meeting.
4. "general" - Any other general chat, greeting, or question (e.g. how to change developer gmail, how to add developer, how to use the dashboard).

User Message: "\${lastMessage}"

Return a JSON object ONLY in the following format:
{
  "intent": "standup" | "investigate" | "schedule" | "general",
  "devEmail": "extracted_email_if_provided_else_null",
  "devName": "extracted_developer_name_if_provided_else_null",
  "reason": "extracted_meeting_reason_or_context_if_provided_else_null"
}\`;

  let classified = {
    intent: "general",
    devEmail: null,
    devName: null,
    reason: null
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
    return { intent: "standup", overdueTasksQueue: [] };
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
      const nameWords = m.name.toLowerCase().split(/\\s+/).filter(w => w.length > 2);
      if (msgLower.includes(m.name.toLowerCase()) || nameWords.some(w => msgLower.includes(w))) {
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
      devEmail: email,
      devName: name,
      githubUsername,
      errorTrace: reason,
    };
  }

  return {};
}`;

const startIdx = content.indexOf(oldRouteIntentStart);
if (startIdx === -1) {
  throw new Error("Could not find start of routeIntentNode in agent.ts");
}
const endIdx = content.indexOf(oldRouteIntentEnd);
if (endIdx === -1) {
  throw new Error("Could not find end of routeIntentNode in agent.ts");
}

content = content.substring(0, startIdx) + newRouteIntent + content.substring(endIdx + oldRouteIntentEnd.length);

// 2. Replace checkWorkloadNode
const oldCheckWorkloadStart = `async function checkWorkloadNode(state: typeof AgentState.State) {
  console.log("==> checkWorkloadNode entered. state:", { devId: state.devId, devEmail: state.devEmail, githubUsername: state.githubUsername, errorTrace: state.errorTrace });`;

const oldCheckWorkloadEnd = `  return {
    devId: member.dev_id,
    devName: member.name,
    devEmail: member.email_address,
    githubUsername: githubUser,
  };
}`;

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

    // Instead of aborting, ask user for the email address!
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

const startWorkloadIdx = content.indexOf(oldCheckWorkloadStart);
if (startWorkloadIdx === -1) {
  throw new Error("Could not find start of checkWorkloadNode in agent.ts");
}
const endWorkloadIdx = content.indexOf(oldCheckWorkloadEnd);
if (endWorkloadIdx === -1) {
  throw new Error("Could not find end of checkWorkloadNode in agent.ts");
}

content = content.substring(0, startWorkloadIdx) + newCheckWorkload + content.substring(endWorkloadIdx + oldCheckWorkloadEnd.length);

// 3. Replace resolveIdentityNode
const oldResolveIdentityStart = `async function resolveIdentityNode(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1]?.content || "";

  // 1. If we were interrupted by unmapped_identity, check if user provided email
  if (state.interruptionReason === "unmapped_identity") {`;

const oldResolveIdentityEnd = `  return {};
}`;

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

const startResolveIdx = content.indexOf(oldResolveIdentityStart);
if (startResolveIdx === -1) {
  throw new Error("Could not find start of resolveIdentityNode in agent.ts");
}
const endResolveIdx = content.indexOf(oldResolveIdentityEnd);
if (endResolveIdx === -1) {
  throw new Error("Could not find end of resolveIdentityNode in agent.ts");
}

content = content.substring(0, startResolveIdx) + newResolveIdentity + content.substring(endResolveIdx + oldResolveIdentityEnd.length);

// 4. Update determineWorkloadRoute and determineIdentityRoute
const oldRoutesStart = `function determineWorkloadRoute(state: typeof AgentState.State) {
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
  if (state.devEmail && state.errorTrace) {`;

const oldRoutesEnd = `    if (responseLower === "yes" || responseLower === "yes proceed" || responseLower === "proceed") {
      return "prepActionNode";
    }
    return "checkWorkloadNode";
  }
  return END;
}`;

const newRoutes = `function determineWorkloadRoute(state: typeof AgentState.State) {
  console.log("==> determineWorkloadRoute called. state:", { interruptionReason: state.interruptionReason });
  if (state.interruptionReason) {
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

const startRoutesIdx = content.indexOf(oldRoutesStart);
if (startRoutesIdx === -1) {
  throw new Error("Could not find start of determineWorkloadRoute in agent.ts");
}
const endRoutesIdx = content.indexOf(oldRoutesEnd);
if (endRoutesIdx === -1) {
  throw new Error("Could not find end of determineIdentityRoute in agent.ts");
}

content = content.substring(0, startRoutesIdx) + newRoutes + content.substring(endRoutesIdx + oldRoutesEnd.length);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated agent.ts with robust project/developer routing and autofetch logic!');
