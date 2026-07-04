"use client";

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface SystemEvent {
  event_id: string;
  project_id: string;
  error_trace: string;
  timestamp: string;
  active_projects?: {
    project_name: string;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  threadId: string;
  title: string;
  messages: ChatMessage[];
  interruptionReason: string | null;
}

interface Project {
  project_id: string;
  project_name: string;
  github_repo_url: string;
  created_at: string;
  status?: "active" | "paused" | "completed";
  jira_project_key?: string | null;
  region?: string;
  size?: string;
}

interface TeamMember {
  dev_id: string;
  name: string;
  email_address: string;
  github_username: string;
  role: string;
  created_at: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stars: number;
  forks: number;
  open_issues: number;
  default_branch: string;
  pushed_at: string;
}

interface UsageData {
  totalEvents: number;
  totalTasks: number;
  totalMembers: number;
  totalProjects: number;
  overdueTasks: number;
  thisWeekEvents: number;
  lastWeekEvents: number;
  weeklyChangePercent: number;
  hourlyCounts: number[];   // array[24]
  generatedAt: string;
}

const AVAILABLE_MODELS = [
  "models/antigravity-preview-05-2026",
  "models/aqa",
  "models/deep-research-max-preview-04-2026",
  "models/deep-research-preview-04-2026",
  "models/deep-research-pro-preview-12-2025",
  "models/gemini-2.0-flash",
  "models/gemini-2.0-flash-001",
  "models/gemini-2.0-flash-lite",
  "models/gemini-2.0-flash-lite-001",
  "models/gemini-2.5-computer-use-preview-10-2025",
  "models/gemini-2.5-flash",
  "models/gemini-2.5-flash-image",
  "models/gemini-2.5-flash-lite",
  "models/gemini-2.5-flash-native-audio-latest",
  "models/gemini-2.5-flash-preview-tts",
  "models/gemini-2.5-pro",
  "models/gemini-2.5-pro-preview-tts",
  "models/gemini-3-flash-preview",
  "models/gemini-3-pro-image",
  "models/gemini-3-pro-image-preview",
  "models/gemini-3-pro-preview",
  "models/gemini-3.1-flash-image",
  "models/gemini-3.1-flash-image-preview",
  "models/gemini-3.1-flash-lite",
  "models/gemini-3.1-flash-lite-image",
  "models/gemini-3.1-flash-lite-preview",
  "models/gemini-3.1-flash-tts-preview",
  "models/gemini-3.1-pro-preview",
  "models/gemini-3.1-pro-preview-customtools",
  "models/gemini-3.5-flash",
  "models/gemini-flash-latest",
  "models/gemini-flash-lite-latest",
  "models/gemini-omni-flash-preview",
  "models/gemini-pro-latest",
  "models/gemini-robotics-er-1.5-preview",
  "models/gemini-robotics-er-1.6-preview",
  "models/gemma-4-26b-a4b-it",
  "models/gemma-4-31b-it",
  "models/imagen-4.0-fast-generate-001",
  "models/imagen-4.0-generate-001",
  "models/imagen-4.0-ultra-generate-001",
  "models/lyria-3-clip-preview",
  "models/lyria-3-pro-preview",
  "models/nano-banana-pro-preview",
  "models/veo-3.1-fast-generate-preview",
  "models/veo-3.1-generate-preview",
  "models/veo-3.1-lite-generate-preview"
];

const DEFAULT_MODEL = "models/gemini-3.1-flash-lite";

export default function Home() {
  // Navigation: "landing" | "app" | "architecture"
  const [viewMode, setViewMode] = useState<"landing" | "app" | "architecture">("landing");

  // Sidebar Tab Navigation
  const [activeTab, setActiveTab] = useState<"projects" | "chat" | "team" | "integrations" | "usage" | "billing" | "settings">("projects");

  // Persistent navigation helpers - save to localStorage so Restart stays on the same screen
  const navigateTo = (mode: "landing" | "app" | "architecture") => {
    setViewMode(mode);
    if (typeof window !== "undefined") localStorage.setItem("ael_view_mode", mode);
  };
  const switchTab = (tab: "projects" | "chat" | "team" | "integrations" | "usage" | "billing" | "settings") => {
    setActiveTab(tab);
    setIsSidebarOpen(false); // Close sidebar on mobile when navigating
    if (typeof window !== "undefined") localStorage.setItem("ael_active_tab", tab);
  };

  const handlePromptClick = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Copied: "${text}"`);
    setInputMessage(text);
    switchTab("chat");
    navigateTo("app");
  };

  // Dynamic Selected Gemini Model (Persisted)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [modelSearch, setModelSearch] = useState("");

  // Projects list (from DB + Mock region/sizes matching screenshot)
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [searchProjectQuery, setSearchProjectQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "completed">("all");
  const [sortBy, setSortBy] = useState<"name" | "created">("name");
  const [viewLayout, setViewLayout] = useState<"grid" | "list">("grid");

  // Team list (from DB)
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  // Usage stats (from /api/usage - real Supabase data)
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Integration verification loading states
  const [integrationChecking, setIntegrationChecking] = useState<Record<string, boolean>>({});

  // Active project selector (for agent context - like the model selector)
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [activeProjectCommits, setActiveProjectCommits] = useState<any[]>([]);
  const [activeProjectCommitsLoading, setActiveProjectCommitsLoading] = useState(false);
  const [editingJiraProjectId, setEditingJiraProjectId] = useState<string | null>(null);
  const [editingJiraKeyVal, setEditingJiraKeyVal] = useState<string>("");

  // Live GitHub repos fetched from GitHub API
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubReposLoading, setGithubReposLoading] = useState(false);
  const [githubRepoSearch, setGithubRepoSearch] = useState("");

  // New Project Dialog State
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [newProjRepo, setNewProjRepo] = useState("");
  const [newProjRegion, setNewProjRegion] = useState("us-east-1");
  const [newProjSize, setNewProjSize] = useState("NANO");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjJiraKey, setNewProjJiraKey] = useState("");

  // New Team Member Dialog State
  const [isNewTeamOpen, setIsNewTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamEmail, setNewTeamEmail] = useState("");
  const [newTeamGithub, setNewTeamGithub] = useState("");
  const [newTeamRole, setNewTeamRole] = useState("Developer");
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);

  // Live Telemetry Logs State
  const [logs, setLogs] = useState<SystemEvent[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [inserting, setInserting] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);

  // Gemini-style Chat Sessions States
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interruptionReason, setInterruptionReason] = useState<string | null>(null);

  // Sidebar — starts closed; a media-query useEffect will open it on desktop
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const [inputMessage, setInputMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  
  // Custom Inputs for Interruptions
  const [customEmail, setCustomEmail] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load and fetch database details on mount
  // Responsive sidebar: open by default on desktop, closed on mobile
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarOpen(matches); // open on desktop, closed on mobile
    };
    update(mq.matches);
    const handler = (e: MediaQueryListEvent) => update(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchProjects();
    fetchTeam();
    fetchUsage();
    fetchGitHubRepos();

    if (typeof window !== "undefined") {
      // Check for Google OAuth callback parameters
      const urlParams = new URLSearchParams(window.location.search);
      const oauthStatus = urlParams.get("oauth");
      if (oauthStatus === "success") {
        toast.success("Google OAuth Refresh Token updated automatically in .env.local!");
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (oauthStatus === "error") {
        const msg = urlParams.get("message") || "Authorization failed.";
        toast.error(`Google OAuth Failed: ${msg}`);
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      // Restore view mode (so Restart stays on the app screen)
      const savedViewMode = localStorage.getItem("ael_view_mode");
      if (savedViewMode === "app") setViewMode("app");
      if (savedViewMode === "architecture") setViewMode("architecture");

      // Restore active tab
      const savedTab = localStorage.getItem("ael_active_tab");
      if (savedTab) setActiveTab(savedTab as any);

      // Restore selected model
      const savedModel = localStorage.getItem("ael_selected_model");
      if (savedModel) setSelectedModel(savedModel);
      // Restore selected project
      const savedProject = localStorage.getItem("ael_selected_project");
      if (savedProject) setSelectedProjectId(savedProject);
      
      // Restore chat sessions from DB first, fall back to local storage
      const restoreChatSessions = async () => {
        try {
          const res = await fetch("/api/chat");
          if (res.ok) {
            const data = await res.json();
            if (data.sessions && data.sessions.length > 0) {
              setSessions(data.sessions);
              const savedLastThread = localStorage.getItem("ael_last_thread_id");
              const activeSession = data.sessions.find((s: any) => s.threadId === savedLastThread) || data.sessions[0];
              setThreadId(activeSession.threadId);
              setMessages(activeSession.messages || []);
              setInterruptionReason(activeSession.interruptionReason || null);
              return;
            }
          }
        } catch (dbErr) {
          console.error("Failed to fetch sessions from database, falling back to local storage", dbErr);
        }

        const savedSessions = localStorage.getItem("ael_sessions");
        if (savedSessions) {
          try {
            const parsed = JSON.parse(savedSessions);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSessions(parsed);
              const savedLastThread = localStorage.getItem("ael_last_thread_id");
              const activeSession = parsed.find((s: any) => s.threadId === savedLastThread) || parsed[0];
              setThreadId(activeSession.threadId);
              setMessages(activeSession.messages || []);
              setInterruptionReason(activeSession.interruptionReason || null);
              return;
            }
          } catch (e) {
            console.error("Failed to load local storage sessions", e);
          }
        }
        await handleStartNewChat([]);
      };

      restoreChatSessions();
    }
  }, []);

  // Auto-scroll inside chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTab]);

  // Fetch active projects from database
  const fetchProjects = async () => {
    try {
      setProjectsLoading(true);
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (res.ok) {
        // Map database projects to include AWS region and instance status mimicking screenshot
        const dbProjects = (data.projects || []).map((p: any, idx: number) => {
          // Hardcode screenshot states for matching aesthetics
          let region = "us-east-1";
          let size = "NANO";

          if (p.project_name.toLowerCase().includes("pulse")) {
            region = "ap-southeast-1";
          } else if (p.project_name.toLowerCase().includes("website")) {
            region = "ap-northeast-1";
          } else {
            // cycle regions
            const regions = ["us-east-1", "eu-central-1", "ap-southeast-2"];
            region = regions[idx % regions.length];
          }

          return {
            ...p,
            region,
            size,
            status: p.status || "active"
          };
        });
        setProjects(dbProjects);
        
        let projectToSelect = null;
        const savedProject = localStorage.getItem("ael_selected_project");
        if (savedProject) {
          projectToSelect = dbProjects.find((p: any) => p.project_id === savedProject);
        }
        if (!projectToSelect && dbProjects.length > 0) {
          projectToSelect = dbProjects[0];
        }
        if (projectToSelect) {
          setSelectedProjectId(projectToSelect.project_id);
          localStorage.setItem("ael_selected_project", projectToSelect.project_id);
          fetchProjectCommits(projectToSelect.github_repo_url);
        }
      } else {
        toast.error(`Projects Fetch Error: ${data.error}`);
      }
    } catch (err) {
      toast.error("Failed to retrieve active projects.");
    } finally {
      setProjectsLoading(false);
    }
  };

  // Verify an integration by calling /api/integrations/verify?service=X
  const verifyIntegration = async (service: string) => {
    setIntegrationChecking((prev) => ({ ...prev, [service]: true }));
    try {
      const res = await fetch(`/api/integrations/verify?service=${service}`);
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    } catch (err) {
      toast.error(`Could not reach /api/integrations/verify for ${service}.`);
    } finally {
      setIntegrationChecking((prev) => ({ ...prev, [service]: false }));
    }
  };

  // Fetch real usage stats from Supabase
  const fetchUsage = async () => {
    try {
      setUsageLoading(true);
      const res = await fetch("/api/usage");
      const data = await res.json();
      if (res.ok) {
        setUsageData(data);
      } else {
        toast.error(`Usage fetch error: ${data.error}`);
      }
    } catch (err) {
      toast.error("Failed to load workspace usage stats.");
    } finally {
      setUsageLoading(false);
    }
  };

  // Fetch live GitHub repositories from GitHub API via PAT
  const fetchGitHubRepos = async () => {
    try {
      setGithubReposLoading(true);
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      if (res.ok) {
        setGithubRepos(data.repos || []);
      } else {
        toast.error(`GitHub: ${data.error}`);
      }
    } catch {
      toast.error("Failed to fetch GitHub repositories.");
    } finally {
      setGithubReposLoading(false);
    }
  };

  // Fetch live git commits for a repository
  const fetchProjectCommits = async (repoUrl: string) => {
    if (!repoUrl) return;
    try {
      setActiveProjectCommitsLoading(true);
      const res = await fetch(`/api/github/commits?repoUrl=${encodeURIComponent(repoUrl)}`);
      const data = await res.json();
      if (res.ok) {
        setActiveProjectCommits(data.commits || []);
      } else {
        setActiveProjectCommits([]);
        console.error("Failed to fetch project commits:", data.error);
      }
    } catch (err) {
      console.error("Network error fetching project commits:", err);
      setActiveProjectCommits([]);
    } finally {
      setActiveProjectCommitsLoading(false);
    }
  };

  // Fetch team members from database
  const fetchTeam = async () => {
    try {
      setTeamLoading(true);
      const res = await fetch("/api/team");
      const data = await res.json();
      if (res.ok) {
        setTeam(data.team || []);
      } else {
        toast.error(`Team Fetch Error: ${data.error}`);
      }
    } catch (err) {
      toast.error("Failed to retrieve team members.");
    } finally {
      setTeamLoading(false);
    }
  };

  // Fetch system logs
  const fetchLogs = async () => {
    try {
      setLogsLoading(true);
      const res = await fetch("/api/logs");
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs || []);
      } else {
        toast.error(`Database Error: ${data.error}`);
      }
    } catch (err) {
      toast.error("Failed to load logs from server.");
    } finally {
      setLogsLoading(false);
    }
  };

  // Toggle active/paused state on projects (database integrated)
  const handleToggleProjectStatus = async (projectId: string, currentStatus: "active" | "paused" | "completed") => {
    const nextStatus = currentStatus === "active" ? "paused" : "active";
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to toggle status.");
        return;
      }
      setProjects(prev => prev.map(p => {
        if (p.project_id === projectId) {
          return { ...p, status: nextStatus };
        }
        return p;
      }));
      toast.success(`Project ${nextStatus === "active" ? "resumed" : "paused"} successfully.`);
    } catch (err: any) {
      toast.error(`Error toggling project status: ${err.message}`);
    }
  };

  // Mark project as completed or reactivate
  const handleMarkProjectCompleted = async (projectId: string, isCompleted: boolean) => {
    const nextStatus = isCompleted ? "completed" : "active";
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: nextStatus })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update project status.");
        return;
      }
      setProjects(prev => prev.map(p => {
        if (p.project_id === projectId) {
          return { ...p, status: nextStatus };
        }
        return p;
      }));
      toast.success(isCompleted ? "Project marked as completed!" : "Project reactivated.");
    } catch (err: any) {
      toast.error(`Error marking project: ${err.message}`);
    }
  };

  // Deselect/Delete project from database
  const handleDeselectProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Are you sure you want to deselect/remove project "${projectName}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/projects?projectId=${projectId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to delete project.");
        return;
      }
      setProjects(prev => prev.filter(p => p.project_id !== projectId));
      toast.success(`Project "${projectName}" successfully deselected.`);
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        localStorage.removeItem("ael_selected_project");
      }
    } catch (err: any) {
      toast.error(`Error deselecting project: ${err.message}`);
    }
  };

  // Inline-edit Jira project key for a project card
  const handleSaveJiraKey = async (projectId: string, key: string) => {
    const trimmedKey = key.trim().toUpperCase();
    try {
      const res = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, jira_project_key: trimmedKey || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save Jira key.");
        return;
      }
      setProjects(prev =>
        prev.map(p => p.project_id === projectId ? { ...p, jira_project_key: trimmedKey || null } : p)
      );
      toast.success(trimmedKey ? `Jira key set to "${trimmedKey}"` : "Jira key cleared.");
    } catch (err: any) {
      toast.error(`Error saving Jira key: ${err.message}`);
    }
  };

  // Select/Add Github Repository as a project in DB
  const handleSelectGithubRepoAsProject = async (repo: GitHubRepo) => {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repo.name,
          github_repo_url: repo.html_url,
          status: "active"
        })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to register project.");
        return;
      }
      const newProj = {
        ...data.project,
        region: "us-east-1",
        size: "NANO",
        status: "active"
      };
      setProjects(prev => [...prev, newProj]);
      setSelectedProjectId(newProj.project_id);
      localStorage.setItem("ael_selected_project", newProj.project_id);
      localStorage.setItem("ael_selected_repo_url", newProj.github_repo_url);
      localStorage.setItem("ael_selected_repo_name", newProj.project_name);
      toast.success(`Project "${repo.name}" registered and selected.`);
    } catch (err: any) {
      toast.error(`Error adding project: ${err.message}`);
    }
  };

  // Deselect/Remove Github Repository project using repo URL
  const handleDeselectGithubRepoProject = async (githubRepoUrl: string, projectName: string) => {
    if (!confirm(`Are you sure you want to deselect/remove project "${projectName}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/projects?githubRepoUrl=${encodeURIComponent(githubRepoUrl)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to deselect project.");
        return;
      }
      setProjects(prev => prev.filter(p => p.github_repo_url !== githubRepoUrl));
      toast.success(`Project "${projectName}" deselected.`);
      const matched = projects.find(p => p.github_repo_url === githubRepoUrl);
      if (matched && selectedProjectId === matched.project_id) {
        setSelectedProjectId("");
        localStorage.removeItem("ael_selected_project");
      }
    } catch (err: any) {
      toast.error(`Error deselecting project: ${err.message}`);
    }
  };

  // Create new project
  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim() || !newProjRepo.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    try {
      setIsCreatingProject(true);
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProjName.trim(),
          github_repo_url: newProjRepo.trim(),
          jira_project_key: newProjJiraKey.trim().toUpperCase() || null
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Project '${newProjName}' registered in Supabase!`);
        setIsNewProjectOpen(false);
        setNewProjName("");
        setNewProjRepo("");
        setNewProjJiraKey("");
        fetchProjects();
      } else {
        toast.error(data.error || "Failed to create project.");
      }
    } catch (err) {
      toast.error("Network error creating project.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  // Create new team member
  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim() || !newTeamEmail.trim()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    try {
      setIsCreatingTeam(true);
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTeamName.trim(),
          email_address: newTeamEmail.trim(),
          github_username: newTeamGithub.trim() || null,
          role: newTeamRole.trim() || "Developer"
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Team member '${newTeamName}' registered in Supabase!`);
        setIsNewTeamOpen(false);
        setNewTeamName("");
        setNewTeamEmail("");
        setNewTeamGithub("");
        setNewTeamRole("Developer");
        fetchTeam();
      } else {
        toast.error(data.error || "Failed to create team member.");
      }
    } catch (err) {
      toast.error("Network error creating team member.");
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleDeleteMember = async (dev_id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove team member '${name}'?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/team?dev_id=${dev_id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Removed team member '${name}' successfully.`);
        fetchTeam();
      } else {
        toast.error(data.error || "Failed to remove team member.");
      }
    } catch (err) {
      toast.error("Network error removing team member.");
    }
  };


  // Switch selected active project
  const handleSelectProject = (p: any) => {
    setSelectedProjectId(p.project_id);
    localStorage.setItem("ael_selected_project", p.project_id);
    fetchProjectCommits(p.github_repo_url);
    toast.success(`Switched active project context to: ${p.project_name}`);
  };

  // Trigger Mock Server Crash
  const handleMockServerCrash = async () => {
    try {
      setInserting(true);
      const res = await fetch("/api/logs", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Mock backend crash log written to Supabase!");
        fetchLogs();
      } else {
        toast.error(data.error || "Failed to generate log.");
      }
    } catch (err) {
      toast.error("Network error triggering mock crash.");
    } finally {
      setInserting(false);
    }
  };

  // Persist sessions array to localStorage
  const saveSessions = (updated: ChatSession[]) => {
    setSessions(updated);
    localStorage.setItem("ael_sessions", JSON.stringify(updated));
  };

  // Start New Chat Session
  const handleStartNewChat = async (currentSessions = sessions) => {
    const newId = `thread-${Math.random().toString(36).substring(2, 11)}`;
    const newSession: ChatSession = {
      threadId: newId,
      title: "New Conversation",
      messages: [],
      interruptionReason: null,
    };
    const updated = [newSession, ...currentSessions];
    setThreadId(newId);
    setMessages([]);
    setInterruptionReason(null);
    saveSessions(updated);
    localStorage.setItem("ael_last_thread_id", newId);

    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSession),
      });
    } catch (e) {
      console.error("Failed to save new session to database", e);
    }
  };

  // Switch to selected session
  const handleSwitchSession = (id: string) => {
    const session = sessions.find((s) => s.threadId === id);
    if (session) {
      setThreadId(id);
      setMessages(session.messages || []);
      setInterruptionReason(session.interruptionReason || null);
      localStorage.setItem("ael_last_thread_id", id);
    }
  };

  // Delete session
  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sessions.filter((s) => s.threadId !== id);
    saveSessions(updated);

    try {
      await fetch(`/api/chat?threadId=${id}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("Failed to delete session from database", e);
    }

    if (threadId === id) {
      if (updated.length > 0) {
        setThreadId(updated[0].threadId);
        setMessages(updated[0].messages || []);
        setInterruptionReason(updated[0].interruptionReason || null);
        localStorage.setItem("ael_last_thread_id", updated[0].threadId);
      } else {
        await handleStartNewChat(updated);
      }
    }
  };

  // Update messages, interruption, and smart title in active session
  const updateSessionData = async (newMessages: ChatMessage[], newInterruption: string | null) => {
    setMessages(newMessages);
    setInterruptionReason(newInterruption);

    let activeSession: ChatSession | null = null;
    const updated = sessions.map((s) => {
      if (s.threadId === threadId) {
        let title = s.title;
        if (title === "New Conversation" && newMessages.length > 0) {
          const firstUser = newMessages.find((m) => m.role === "user");
          if (firstUser) {
            title = firstUser.content.substring(0, 24) + (firstUser.content.length > 24 ? "..." : "");
          }
        }
        activeSession = {
          ...s,
          title,
          messages: newMessages,
          interruptionReason: newInterruption,
        };
        return activeSession;
      }
      return s;
    });
    saveSessions(updated);

    if (activeSession) {
      try {
        await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(activeSession),
        });
      } catch (e) {
        console.error("Failed to save updated session to database", e);
      }
    }
  };

  // Submit agent chat message
  const triggerAgentMessage = async (msgText: string) => {
    if (!msgText.trim() || sendingMessage) return;

    const userMessage: ChatMessage = { role: "user", content: msgText };
    const updatedMessages = [...messages, userMessage];
    updateSessionData(updatedMessages, interruptionReason);
    setSendingMessage(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msgText,
          threadId,
          modelName: selectedModel, // Pass model dynamically
          history: updatedMessages,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        updateSessionData(data.messages || [], data.interruptionReason || null);
        fetchLogs();
      } else {
        toast.error(data.error || "Agent routing failed.");
      }
    } catch (err) {
      toast.error("Network error communicating with AEL agent.");
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim()) return;
    triggerAgentMessage(inputMessage.trim());
    setInputMessage("");
  };

  // Human-in-the-loop: Handle Ticket/Meet Approval (Edge Case 5)
  const handleApprovalDecision = async (approve: boolean) => {
    setSendingMessage(true);
    const userMessage: ChatMessage = {
      role: "user",
      content: approve ? "[Approved Triage Action]" : "[Rejected Action]",
    };
    const updatedMessages = [...messages, userMessage];
    updateSessionData(updatedMessages, null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          approvalDecision: approve ? "approve" : "reject",
          modelName: selectedModel, // Pass model dynamically
          history: updatedMessages,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        updateSessionData(data.messages || [], data.interruptionReason || null);
        fetchLogs();
      } else {
        toast.error(data.error || "Approval submission failed.");
      }
    } catch (err) {
      toast.error("Network error submitting approval.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Human-in-the-loop: Handle Unmapped email submission (Edge Case 3)
  const handleEmailSubmission = async () => {
    if (!customEmail.trim() || !customEmail.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    const email = customEmail.trim();
    setCustomEmail("");
    setSendingMessage(true);
    const userMessage: ChatMessage = { role: "user", content: email };
    const updatedMessages = [...messages, userMessage];
    updateSessionData(updatedMessages, null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          emailInput: email,
          modelName: selectedModel, // Pass model dynamically
          history: updatedMessages,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        updateSessionData(data.messages || [], data.interruptionReason || null);
      } else {
        toast.error(data.error || "Failed to submit email.");
      }
    } catch (err) {
      toast.error("Network error submitting email.");
    } finally {
      setSendingMessage(false);
    }
  };

  // Handle Dynamic Model Change
  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName);
    localStorage.setItem("ael_selected_model", modelName);
    toast.success(`Switched active SRE model to ${modelName}`);
  };

  // Client-Side crash trigger for testing Error Boundary
  if (shouldCrash) {
    throw new Error(
      "Intentional React UI crash triggered by user for logging validation. Error Boundary has successfully intercepted this stack trace."
    );
  }

  // Parse Severity badge color for logs list
  const getSeverityBadge = (trace: string) => {
    const traceLower = trace.toLowerCase();
    if (traceLower.includes("fatal") || traceLower.includes("error")) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
          FATAL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
        WARN
      </span>
    );
  };

  // Helper to process inline styles (bold, italics, inline code, links)
  const processInlineStyles = (text: string): string => {
    return text
      // Bold
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`(.*?)`/g, "<code class='bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] border border-slate-200/50'>$1</code>")
      // Links [Text](URL)
      .replace(/\[(.*?)\]\((.*?)\)/g, "<a href='$2' target='_blank' rel='noopener noreferrer' class='text-[#3ecf8e] hover:text-[#34b27b] hover:underline font-semibold'>$1</a>");
  };

  // Helper to render HTML tables with custom style matching our application theme (emerald borders, clean text)
  const renderHtmlTable = (headers: string[], rows: string[][]): string => {
    let html = `<div class="my-3 overflow-x-auto border border-slate-200 rounded-lg shadow-sm">`;
    html += `<table class="min-w-full divide-y divide-slate-200 text-left text-[11px]">`;
    
    // Headers
    html += `<thead class="bg-slate-50 font-bold text-slate-700"><tr>`;
    headers.forEach(h => {
      html += `<th class="px-3 py-2 border-b border-slate-200">${processInlineStyles(h)}</th>`;
    });
    html += `</tr></thead>`;
    
    // Rows
    html += `<tbody class="divide-y divide-slate-200 bg-white text-slate-600">`;
    if (rows.length === 0) {
      html += `<tr><td colspan="${headers.length}" class="px-3 py-4 text-center text-slate-400 italic">No items found</td></tr>`;
    } else {
      rows.forEach(r => {
         html += `<tr class="hover:bg-slate-50">`;
         r.forEach(cell => {
           html += `<td class="px-3 py-2 whitespace-nowrap">${processInlineStyles(cell)}</td>`;
         });
         html += `</tr>`;
      });
    }
    html += `</tbody></table></div>`;
    return html;
  };

  // Render markdown-like text as formatted HTML (no external dep)
  const renderMarkdown = (text: string): string => {
    const lines = text.split("\n");
    let html = "";
    let inList = false;
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check if line is a table line
      if (line.startsWith("|") && line.endsWith("|")) {
        // Close list if we were in one
        if (inList) {
          html += "</ul>";
          inList = false;
        }

        const cells = line
          .split("|")
          .slice(1, -1)
          .map(c => c.trim());

        if (!inTable) {
          // This is the header row or line containing the columns
          inTable = true;
          tableHeaders = cells;
          tableRows = [];
        } else {
          // Check if it's the separator row (contains only dashes, colons, or empty space)
          const isSeparator = cells.every(c => /^[ :-]+$/.test(c));
          if (!isSeparator) {
            tableRows.push(cells);
          }
        }
        continue;
      } else {
        // If we were in a table and this line is NOT a table line, render the table
        if (inTable) {
          html += renderHtmlTable(tableHeaders, tableRows);
          inTable = false;
          tableHeaders = [];
          tableRows = [];
        }
      }

      // Headers
      if (line.startsWith("####")) {
        html += `<h4 class="text-[11px] font-bold text-slate-800 mt-3 mb-1 uppercase tracking-wider">${processInlineStyles(line.replace(/^####\s*/, ""))}</h4>`;
      } else if (line.startsWith("###")) {
        html += `<h3 class="text-xs font-bold text-slate-800 mt-4 mb-1.5 flex items-center gap-1.5">${processInlineStyles(line.replace(/^###\s*/, ""))}</h3>`;
      } else if (line.startsWith("##")) {
        html += `<h2 class="text-sm font-bold text-slate-900 mt-5 mb-2 pb-1 border-b border-slate-100 flex items-center gap-2">${processInlineStyles(line.replace(/^##\s*/, ""))}</h2>`;
      } else if (line.startsWith("#")) {
        html += `<h1 class="text-base font-extrabold text-slate-950 mt-6 mb-3">${processInlineStyles(line.replace(/^#\s*/, ""))}</h1>`;
      }
      // Bullet lists
      else if (line.startsWith("- ") || line.startsWith("* ")) {
        if (!inList) {
          html += "<ul class='space-y-1 my-2 ml-4 list-disc text-slate-600'>";
          inList = true;
        }
        html += `<li>${processInlineStyles(line.replace(/^[-*]\s*/, ""))}</li>`;
      }
      // Horizontal Rule
      else if (line === "***" || line === "---" || line === "___") {
        html += "<hr class='my-4 border-slate-200' />";
      }
      // Plain lines
      else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        if (line === "") {
          html += "<div class='h-2'></div>";
        } else {
          html += `<p class="leading-relaxed mb-1.5">${processInlineStyles(line)}</p>`;
        }
      }
    }

    // Clean up remaining open structures
    if (inList) {
      html += "</ul>";
    }
    if (inTable) {
      html += renderHtmlTable(tableHeaders, tableRows);
    }

    return html;
  };

  // Filter and sort projects
  const filteredProjects = projects
    .filter(p => {
      const matchesSearch = p.project_name.toLowerCase().includes(searchProjectQuery.toLowerCase()) || p.github_repo_url.toLowerCase().includes(searchProjectQuery.toLowerCase());
      if (statusFilter === "all") return matchesSearch;
      return matchesSearch && p.status === statusFilter;
    })
    .sort((a, b) => {
      if (sortBy === "name") {
        return a.project_name.localeCompare(b.project_name);
      } else {
        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      }
    });

  // Filter models
  const filteredModels = AVAILABLE_MODELS.filter(m => m.toLowerCase().includes(modelSearch.toLowerCase()));

  // =========================================================================
  // RENDERING LANDING / HOME PAGE
  // =========================================================================
  if (viewMode === "landing") {
    return (
      <div className="min-h-screen bg-[#fafbfa] text-slate-800 font-sans flex flex-col justify-between selection:bg-[#3ecf8e]/20">
        
        {/* Navigation */}
        <header className="h-16 border-b border-slate-200/60 px-6 md:px-12 flex items-center justify-between bg-white/80 backdrop-blur sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-[#ecfdf5] border border-[#a7f3d0] rounded-lg">
              <svg className="w-5 h-5 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-slate-900 tracking-tight text-base">AEL Autonomous Engineering Lead</span>
            </div>
          </div>
          <div className="flex items-center gap-4">

            <button 
              onClick={() => navigateTo("architecture")} 
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              Architecture
            </button>
            <Button 
              onClick={() => navigateTo("app")}
              className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs px-4 py-2 rounded-md shadow-sm transition-all"
            >
              Launch Console
            </Button>
          </div>
        </header>

        {/* Long Form Landing & Documentation */}
        <main className="flex-1 flex flex-col justify-start items-center px-6 md:px-12 py-16 text-center max-w-5xl mx-auto space-y-20">
          
          {/* Hero Split Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center w-full text-left py-4">
            {/* Left Column (lg:col-span-7) */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-block">
                <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-100 rounded px-2.5 py-0.5 font-bold">
                  Zero friction telemetry agent
                </span>
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.1]">
                Triage and fix <br/>
                production crashes <br/>
                <span className="bg-gradient-to-r from-emerald-600 to-[#3ecf8e] bg-clip-text text-transparent">
                  in seconds.
                </span>
              </h1>
              
              <p className="text-xs md:text-sm text-slate-500 max-w-xl leading-relaxed">
                Drop your logs, link GitHub, and instantly pinpoint regression commits. No complex setups. No manual triaging. Total automation.
              </p>

              {/* Tag Badges */}
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="font-mono text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200/60 rounded px-2 py-0.5">
                  100% autonomous
                </span>
                <span className="font-mono text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200/60 rounded px-2 py-0.5">
                  Continuous monitoring
                </span>
              </div>
            </div>

            {/* Right Column (lg:col-span-5) */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div 
                onClick={() => navigateTo("app")}
                className="shiny-card shiny-card-hover-lift group relative cursor-pointer w-full max-w-sm rounded-2xl bg-white border border-slate-200/60 p-6 md:p-8 shadow-md"
              >
                {/* Glow Backdrop */}
                <div className="absolute -inset-0.5 bg-gradient-to-r from-[#3ecf8e] to-emerald-500 rounded-2xl blur opacity-0 group-hover:opacity-10 transition duration-300 -z-10" />
                
                {/* Content */}
                <div className="space-y-6">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#3ecf8e] group-hover:bg-[#3ecf8e] group-hover:text-white transition-all duration-300">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  
                  <div>
                    <h3 className="text-base font-bold text-slate-900 group-hover:text-[#3ecf8e] transition-colors flex items-center gap-1.5">
                      Launch workspace
                      <span className="text-sm font-normal group-hover:translate-x-1.5 transition-transform duration-300">&rarr;</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1">
                      or click to start SRE co-pilot
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-1.5">
                    <span className="font-mono text-[8px] font-bold text-[#6b7280] bg-[#f9fafb] border border-slate-200/50 rounded px-1.5 py-0.5">
                      Live telemetry
                    </span>
                    <span className="font-mono text-[8px] font-bold text-[#6b7280] bg-[#f9fafb] border border-slate-200/50 rounded px-1.5 py-0.5">
                      Automatic Jira sync
                    </span>
                    <span className="font-mono text-[8px] font-bold text-[#6b7280] bg-[#f9fafb] border border-slate-200/50 rounded px-1.5 py-0.5">
                      100% private
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats Banner */}
          <div className="shiny-card grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-4xl bg-white p-6 rounded-2xl border border-slate-200/60 shadow-sm">
            <div>
              <p className="text-3xl font-extrabold text-[#3ecf8e]">100%</p>
              <p className="text-xs text-slate-500 mt-1">Autonomous Triaging</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-slate-900">&lt; 30s</p>
              <p className="text-xs text-slate-500 mt-1">Average Response Time</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-slate-900">Live</p>
              <p className="text-xs text-slate-500 mt-1">Octokit Git Integration</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-[#3ecf8e]">Active</p>
              <p className="text-xs text-slate-500 mt-1">Calendar & Meet Sync</p>
            </div>
          </div>

          {/* Features & Capabilities Showcase */}
          <div className="w-full space-y-8 text-left scroll-mt-20">
            <div className="border-l-4 border-[#3ecf8e] pl-4">
              <h2 className="text-xl font-bold text-slate-900">Agent Core Capabilities & Features</h2>
              <p className="text-xs text-slate-500 mt-1">Explore how AEL coordinates workflows, schedules events, and triages bugs autonomously.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">Autonomous Incident Triaging</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Ingests real-time telemetry error logs, semantic-audits GitHub commits to find the regression commit, scans developer workload, checks for database overrides, and logs issues into Supabase.
                </p>
              </div>

              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">Remediation Sync Scheduling</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Automatically books a 15-minute 1-on-1 Google Calendar meeting with the culprit developer, attaches a Google Meet link, and registers the ticket details to prevent future SRE regressions.
                </p>
              </div>

              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87" />
                    <path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">Real-Time Team Syncs</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Handles full-team calendar meetings with Google Meet URLs, sends email invites to all developers at once, and documents standard standings in standup and weekly SRE reports.
                </p>
              </div>

              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">Direct SMTP Gmail Outreach</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Gathers sender name, target developer, project context, and custom notes. Then drafts and sends a professional email using Gmail SMTP and nodemailer instantly.
                </p>
              </div>

              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">SRE Standup Summarizer</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Collects developer git commits, Jira tickets, and pending incidents to assemble structured Standups, Today's Summaries, and Weekly SRE Performance reports dynamically.
                </p>
              </div>

              <div className="shiny-card shiny-card-hover-lift bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg w-fit">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900">Interactive HIL Dashboard</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Features a dynamic sidebar navigation system, interactive project telemetry tracking charts, live commit history logs, database telemetry records, and full-featured chatbot control.
                </p>
              </div>
            </div>
          </div>



          {/* Feature Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left">
            <div className="shiny-card shiny-card-hover-lift p-6 border border-slate-200/60 bg-white rounded-xl shadow-sm space-y-3">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Sprint Daily Standup Remediation</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Scan sprint backlogs for overdue critical items. AEL contacts authors, schedules remediation checkins, and alerts organization leads instantly.
              </p>
            </div>

            <div className="shiny-card shiny-card-hover-lift p-6 border border-slate-200/60 bg-white rounded-xl shadow-sm space-y-3">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Semantic Stack Trace Audit</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                When a system crash gets logged to Supabase, AEL compares stack traces against latest Git commits to find the exact line causing issues.
              </p>
            </div>

            <div className="shiny-card shiny-card-hover-lift p-6 border border-slate-200/60 bg-white rounded-xl shadow-sm space-y-3">
              <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Human-in-the-Loop Guardrails</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Execution pauses safely at critical thresholds. Intercepts trigger override approvals, registry additions for unmapped developers, and workload assignments.
              </p>
            </div>

            <div className="shiny-card shiny-card-hover-lift p-6 border border-slate-200/60 bg-white rounded-xl shadow-sm space-y-3">
              <div className="w-10 h-10 bg-red-50 text-red-600 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Google Calendar / Meet Integration</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Automatically books Google Meet invites, syncs calendars between teams, and populates meeting details with automated remediation tickets.
              </p>
            </div>
          </div>

          {/* Golden Test Walks / Verification Scenarios */}
          <div className="shiny-card w-full space-y-6 text-left bg-white border border-slate-200/60 p-6 rounded-2xl shadow-sm">
            <h2 className="text-base font-bold text-slate-900">Golden Paths: How to Verify & Test AEL</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex gap-2.5 items-center">
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded">Path A</span>
                  <h4 className="text-xs font-bold text-slate-900">Sprint Daily Standup Remediation</h4>
                </div>
                <ol className="list-decimal list-inside text-xs text-slate-500 space-y-1.5 leading-relaxed">
                  <li>Navigate to the <strong className="font-semibold text-slate-950">AEL Co-Pilot Chat</strong> console tab.</li>
                  <li>Type or click to auto-run: <code onClick={() => handlePromptClick("Give me a status update on the team")} className="bg-orange-50 hover:bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded text-[#c2410c] text-[10px] font-mono cursor-pointer transition-colors" title="Click to copy and switch to chat">Give me a status update on the team</code>.</li>
                  <li>Verify the agent summarizes completed vs pending sprint tasks from the database and highlights overdue items automatically.</li>
                </ol>
              </div>

              <div className="space-y-3">
                <div className="flex gap-2.5 items-center">
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded">Path B</span>
                  <h4 className="text-xs font-bold text-slate-900">Incident Remediation & Workload Override</h4>
                </div>
                <ol className="list-decimal list-inside text-xs text-slate-500 space-y-1.5 leading-relaxed">
                  <li>Click <strong className="font-semibold text-slate-950">Mock Server Crash</strong> in the header to register a fresh stack trace in Supabase.</li>
                  <li>Go to <strong className="font-semibold text-slate-950">AEL Co-Pilot Chat</strong> and click to auto-run: <code onClick={() => handlePromptClick("Investigate the latest crash")} className="bg-orange-50 hover:bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded text-[#c2410c] text-[10px] font-mono cursor-pointer transition-colors" title="Click to copy and switch to chat">Investigate the latest crash</code>.</li>
                  <li>Verify AEL fetches the log, reviews latest commits, flags a developer workload overload, and requests approval before booking.</li>
                </ol>
              </div>
            </div>
          </div>


          {/* Action Call to Launch App */}
          <div className="pt-8 border-t border-slate-200 w-full text-center space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Ready to test AEL Agent Console?</h3>
            <div className="flex justify-center">
              <Button 
                onClick={() => navigateTo("app")}
                className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-sm px-10 py-3 rounded-lg shadow-lg hover:shadow-emerald-100 transition-all"
              >
                Launch Console Dashboard
              </Button>
            </div>
          </div>

        </main>

        {/* Footer */}
        <footer className="border-t border-slate-100 bg-slate-50/50 py-8 px-6 md:px-12 w-full mt-24">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <span className="font-bold text-slate-800">AEL SRE Lead</span>
              <span className="text-[10px] text-slate-400">| Enterprise Autonomous Operations</span>
            </div>
            
            <div className="flex gap-6 items-center">
              <button onClick={() => navigateTo("app")} className="hover:text-[#3ecf8e] transition-colors cursor-pointer font-medium">
                Workspace Dashboard
              </button>
              <button onClick={() => navigateTo("architecture")} className="hover:text-[#3ecf8e] transition-colors cursor-pointer font-medium">
                System Architecture
              </button>
            </div>

            <div className="text-[10px] text-slate-400">
              &copy; {new Date().getFullYear()} AEL. All rights reserved.
            </div>
          </div>
        </footer>

        {/* Floating Chat Copilot Button */}
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => {
              switchTab("chat");
              navigateTo("app");
            }}
            className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-[#3ecf8e] to-[#45e09d] text-white shadow-xl hover:shadow-emerald-200/50 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer"
            title="Chat with AEL Copilot"
          >
            {/* Pulsing glow ring around it */}
            <span className="absolute -inset-1 rounded-full bg-[#3ecf8e]/20 blur opacity-75 group-hover:opacity-100 group-hover:-inset-1.5 transition-all duration-300 animate-pulse"></span>
            
            {/* Main Icon */}
            <svg
              className="relative w-7 h-7 text-white transition-transform group-hover:rotate-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>

            {/* Small badge or dot */}
            <span className="absolute top-0 right-0 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white"></span>
            </span>
          </button>
        </div>

      </div>
    );
  }

  // =========================================================================
  // RENDERING DEDICATED SYSTEM ARCHITECTURE PAGE
  // =========================================================================
  if (viewMode === "architecture") {
    return (
      <div className="min-h-screen bg-[#fafbfa] text-slate-800 font-sans flex flex-col justify-between selection:bg-[#3ecf8e]/20">
        
        {/* Navigation */}
        <header className="h-16 border-b border-slate-200/60 px-6 md:px-12 flex items-center justify-between bg-white/80 backdrop-blur sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-[#ecfdf5] border border-[#a7f3d0] rounded-lg cursor-pointer" onClick={() => navigateTo("landing")}>
              <svg className="w-5 h-5 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div className="cursor-pointer" onClick={() => navigateTo("landing")}>
              <span className="font-bold text-slate-900 tracking-tight text-base">AEL Autonomous Engineering Lead</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigateTo("landing")} className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors">Back to Home</button>
            <Button 
              onClick={() => navigateTo("app")}
              className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs px-4 py-2 rounded-md shadow-sm transition-all"
            >
              Launch Console
            </Button>
          </div>
        </header>

        {/* Dedicated Architecture Container */}
        <main className="flex-1 flex flex-col justify-start items-center px-6 md:px-12 py-16 text-center max-w-5xl mx-auto space-y-12 w-full">
          {/* Architecture Visual Diagram */}
          <div className="w-full space-y-6 text-left">
            <div className="border-l-4 border-[#3ecf8e] pl-4">
              <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">System Architecture & LangGraph State Flow</h1>
              <p className="text-xs md:text-sm text-slate-500 mt-1">
                How the AEL LangGraph agent integrates telemetry stores, Git commits, Google Workspace APIs, and SMTP outreach.
              </p>
            </div>
            
            <div className="bg-white border border-slate-200/60 rounded-2xl p-6 md:p-8 shadow-sm flex flex-col lg:flex-row gap-8 items-stretch">
              <div className="flex-1 space-y-6 flex flex-col justify-center">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-100">1</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Telemetry Ingestion & Database Logs</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      DB crash exceptions and SRE metrics log to `system_events`. AEL queries these logs autonomously to locate unresolved issues.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-100">2</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Git regression Mapping (Octokit)</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      AEL fetches the recent commits from GitHub and semantic-matches stack traces to locate culprit code changes.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-100">3</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">LangGraph State Machine Router</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Routes the agent state dynamically. Flags developer workload overloads or unmapped email addresses to request manual approvals.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-100">4</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Google Calendar & Google Meet Sync</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Generates dynamic calendar invite invites with `organizer` metadata to avoid spam warnings and automatically provisions Google Meet conference rooms.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 text-xs font-bold flex items-center justify-center shrink-0 border border-emerald-100">5</div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Direct SMTP Outreach (Nodemailer)</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      Sends real-time email notifications containing incident reports, checklists, and calendar links using Gmail App Passwords.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex-1 bg-slate-50 rounded-xl p-4 flex flex-col items-center justify-center border border-slate-100 min-h-[360px]">
                <div className="mb-2 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Data Flow Pipeline</span>
                </div>
                <svg className="w-full h-auto max-w-[420px]" viewBox="0 0 400 350" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Telemetry log block */}
                  <rect x="130" y="10" width="140" height="35" rx="6" fill="#1e293b" />
                  <text x="200" y="32" fill="white" fontSize="9" fontWeight="bold" textAnchor="middle">Telemetry Ingestion</text>
                  
                  <path d="M200 45V75" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  
                  {/* Git Diff matching */}
                  <rect x="130" y="75" width="140" height="35" rx="6" fill="#0f766e" />
                  <text x="200" y="97" fill="white" fontSize="9" fontWeight="bold" textAnchor="middle">Octokit Git Code Audit</text>
                  
                  <path d="M200 110V140" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  
                  {/* LangGraph Core state machine */}
                  <rect x="110" y="140" width="180" height="50" rx="8" fill="#312e81" stroke="#4338ca" strokeWidth="2" />
                  <text x="200" y="163" fill="white" fontSize="10" fontWeight="bold" textAnchor="middle">LangGraph State machine</text>
                  <text x="200" y="178" fill="#c7d2fe" fontSize="8" textAnchor="middle">Workload & Email Guardrails</text>
                  
                  {/* Branching paths from LangGraph */}
                  <path d="M150 190V230" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  <path d="M250 190V230" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  
                  {/* Human-in-the-loop validation */}
                  <rect x="50" y="230" width="130" height="40" rx="6" fill="#b45309" />
                  <text x="115" y="250" fill="white" fontSize="8" fontWeight="bold" textAnchor="middle">Human-in-the-loop Intercept</text>
                  <text x="115" y="261" fill="#fed7aa" fontSize="7" textAnchor="middle">(User overrides / approval)</text>
                  
                  {/* Google Calendar meeting scheduler */}
                  <rect x="220" y="230" width="130" height="40" rx="6" fill="#0369a1" />
                  <text x="285" y="250" fill="white" fontSize="8" fontWeight="bold" textAnchor="middle">Google Calendar & Meet</text>
                  <text x="285" y="261" fill="#e0f2fe" fontSize="7" textAnchor="middle">(Auto-provisions Meets)</text>
                  
                  <path d="M115 270V300" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  <path d="M285 270V300" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 3" />
                  
                  {/* Nodemailer SMTP Email */}
                  <rect x="110" y="300" width="180" height="35" rx="6" fill="#047857" />
                  <text x="200" y="322" fill="white" fontSize="9" fontWeight="bold" textAnchor="middle">Nodemailer SMTP Email dispatch</text>
                </svg>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200 w-full text-center">
            <button 
              onClick={() => navigateTo("landing")}
              className="text-xs font-bold text-[#3ecf8e] hover:text-[#34b27b] transition-colors"
            >
              &larr; Back to Home
            </button>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-100 bg-slate-50/50 py-8 px-6 md:px-12 w-full mt-24">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <span className="font-bold text-slate-800">AEL SRE Lead</span>
              <span className="text-[10px] text-slate-400">| Enterprise Autonomous Operations</span>
            </div>
            
            <div className="flex gap-6 items-center">
              <button onClick={() => navigateTo("app")} className="hover:text-[#3ecf8e] transition-colors cursor-pointer font-medium">
                Workspace Dashboard
              </button>
              <button onClick={() => navigateTo("architecture")} className="hover:text-[#3ecf8e] transition-colors cursor-pointer font-medium">
                System Architecture
              </button>
            </div>

            <div className="text-[10px] text-slate-400">
              &copy; {new Date().getFullYear()} AEL. All rights reserved.
            </div>
          </div>
        </footer>

      </div>
    );
  }

  // =========================================================================
  // RENDERING WORKSPACE APPLICATION
  // =========================================================================
  return (
    <div className="light">
      <div className="flex h-screen bg-[#fcfcfc] text-[#1c1c1c] font-sans antialiased overflow-hidden">
        
        {/* ========================================================================= */}
        {/* MOBILE TOP BAR — visible only on small screens                             */}
        {/* ========================================================================= */}
        <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-[#e5e7eb] flex items-center justify-between px-4 z-40 shadow-sm">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span className="text-sm font-bold tracking-tight text-[#111827]">AEL</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(prev => !prev)}
            className="p-2 rounded-md text-[#3ecf8e] hover:bg-emerald-50 hover:text-[#34b27b] transition-all"
            aria-label="Toggle sidebar"
          >
            {isSidebarOpen ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile backdrop overlay */}
        {isSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-30"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* ========================================================================= */}
        {/* 1. LEFT SIDEBAR: SUPABASE LOGO & TAB NAVIGATION                           */}
        {/* ========================================================================= */}
        {/* Desktop: static sidebar. Mobile: slide-in overlay */}
        <aside className={`
          fixed inset-y-0 left-0 z-40
          w-72 md:w-60 bg-white border-r border-[#e5e7eb] flex flex-col justify-between shrink-0
          transform transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          top-0
        `}>
          <div>
            {/* Top Logo Panel */}
            <div className="h-14 border-b border-[#e5e7eb] flex items-center px-4">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <h1 className="text-xs font-bold tracking-tight text-[#111827]">AEL</h1>
              </div>
            </div>

            {/* Navigation Menu Items */}
            <nav className="p-3 space-y-1">
              <button
                onClick={() => navigateTo("landing")}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827] transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Back to Home
              </button>

              <div className="h-[1px] bg-slate-150 my-2 bg-slate-200" />

              <p className="text-[9px] font-bold text-[#8c8c8c] uppercase tracking-wider px-2 mb-2">Workspace</p>
                         {/* Projects Tab */}
              <button
                onClick={() => switchTab("projects")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "projects"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <svg className={`w-4 h-4 transition-colors ${activeTab === "projects" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Projects
              </button>

              {/* AEL Co-Pilot Tab */}
              <button
                onClick={() => switchTab("chat")}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "chat"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <svg className={`w-4 h-4 transition-colors ${activeTab === "chat" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span>AEL Co-Pilot Chat</span>
                </div>
                {interruptionReason && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                )}
              </button>

              {/* Team Tab */}
              <button
                onClick={() => switchTab("team")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "team"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <svg className={`w-4 h-4 transition-colors ${activeTab === "team" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Team
              </button>

              {/* Integrations Tab */}
              <button
                onClick={() => switchTab("integrations")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "integrations"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <svg className={`w-4 h-4 transition-colors ${activeTab === "integrations" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 011 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                </svg>
                Integrations
              </button>

              {/* Usage Tab */}
              <button
                onClick={() => switchTab("usage")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "usage"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <svg className={`w-4 h-4 transition-colors ${activeTab === "usage" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                </svg>
                Usage
              </button>

              {/* Settings Tab */}
              <button
                onClick={() => switchTab("settings")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all group ${
                  activeTab === "settings"
                    ? "bg-emerald-50/60 text-emerald-700 font-bold border-l-2 border-l-[#3ecf8e] rounded-r-md rounded-l-none"
                    : "text-[#6b7280] hover:bg-emerald-50/20 hover:text-emerald-700 rounded-md"
                }`}
              >
                <svg className={`w-4 h-4 transition-colors ${activeTab === "settings" ? "text-emerald-600" : "text-[#8c8c8c] group-hover:text-emerald-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Organization Settings
              </button>
            </nav>
          </div>

          {/* Sidebar Bottom Metadata */}
          <div className="p-3 border-t border-[#e5e7eb] bg-[#f9fafb] text-[10px] space-y-1">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span>Active SRE Model:</span>
            </div>
            <div className="font-mono text-emerald-600 font-bold truncate max-w-full" title={selectedModel}>
              {selectedModel.replace("models/", "")}
            </div>
            <div className="h-[1px] bg-slate-100 my-1" />
            <div className="flex items-center justify-between text-[#6b7280] text-[9px]">
              <span>Checkpointer:</span>
              <span className="font-mono text-[#111827]">MemorySaver</span>
            </div>
          </div>
        </aside>

        {/* ========================================================================= */}
        {/* 2. MAIN CONTAINER: HEADER, WORKSPACE, FOOTER                              */}
        {/* ========================================================================= */}
        <div
          className="flex flex-col min-h-0 min-w-0 bg-[#fcfcfc] relative transition-all duration-300 overflow-hidden"
          style={{
            // On mobile: sidebar overlays content — no shift needed, always full width
            // On desktop: sidebar is fixed in-flow equivalent — shift content right
            marginLeft: isDesktop && isSidebarOpen ? '240px' : '0',
            width: isDesktop && isSidebarOpen ? 'calc(100% - 240px)' : '100%',
          }}
        >


          {/* Top Header Bar */}
          <header className="h-14 border-b border-[#e5e7eb] flex items-center justify-between px-4 md:px-6 bg-white shrink-0 mt-14 md:mt-0">
            <div className="flex items-center gap-3">
              {/* Sidebar toggle — visible on all screen sizes */}
              <button
                onClick={() => setIsSidebarOpen(prev => !prev)}
                className="p-1.5 rounded-md text-[#3ecf8e] hover:bg-emerald-50 hover:text-[#34b27b] transition-all"
                aria-label="Toggle sidebar"
                title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  {isSidebarOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                  )}
                </svg>
              </button>
              {/* Breadcrumb path */}
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className="text-[#6b7280] hidden sm:inline">AEL</span>
                <span className="text-[#d1d5db] hidden sm:inline">/</span>
                <span className="text-[#111827] font-semibold capitalize">
                  {activeTab === "projects" ? "Projects" : activeTab === "chat" ? "Co-Pilot" : activeTab}
                </span>
              </div>
            </div>

            {/* Right Header actions */}
            <div className="flex items-center gap-1.5 sm:gap-3">


              <Button
                onClick={handleMockServerCrash}
                disabled={inserting}
                className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-[10px] sm:text-[11px] font-bold h-7 sm:h-8 px-2 sm:px-3 rounded shadow-sm transition-all"
              >
                {inserting ? "Syncing..." : <><span className="hidden sm:inline">Mock </span>Crash</>}
              </Button>

              <Button
                onClick={() => {
                  toast.info("Injecting client UI exception trace...");
                  setTimeout(() => setShouldCrash(true), 500);
                }}
                variant="destructive"
                className="bg-red-50 hover:bg-red-100 text-red-650 border border-red-200 text-[10px] sm:text-[11px] font-bold h-7 sm:h-8 px-2 sm:px-3 rounded shadow-sm transition-all text-red-600"
              >
                <span className="hidden sm:inline">Mock </span>UI Crash
              </Button>
            </div>
          </header>

          {/* ========================================================================= */}
          {/* 3. CORE WORKSPACE: PROJECTS, CHAT, TEAM, SETTINGS, ETC                    */}
          {/* ========================================================================= */}
          <main className={`flex-1 flex flex-col min-h-0 p-3 sm:p-4 md:p-6 relative bg-[#f9fafb] ${activeTab === "chat" ? "overflow-hidden" : "overflow-y-auto"}`}>
            {/* Custom scroll support applied dynamically */}
            
            {/* PROJECTS TAB */}
            {activeTab === "projects" && (
              <div className="flex flex-col space-y-6 pr-1">
                
                {/* Header Filter Panel */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 border border-[#e5e7eb] rounded-lg shadow-sm shrink-0">
                  <div className="flex flex-wrap gap-2 w-full md:w-auto">
                    {/* Search bar */}
                    <div className="relative w-full md:w-64">
                      <Input
                        value={searchProjectQuery}
                        onChange={(e) => setSearchProjectQuery(e.target.value)}
                        placeholder="Search by project name..."
                        className="bg-white border-[#e5e7eb] text-xs h-8 pl-8 rounded text-black"
                      />
                      <svg className="w-3.5 h-3.5 text-[#8c8c8c] absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>

                    {/* Status Filter */}
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      className="border border-[#e5e7eb] rounded bg-white text-xs h-8 px-2 text-[#374151] focus-visible:outline-none"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="completed">Completed</option>
                    </select>

                    {/* Sort selector */}
                    <button
                      onClick={() => setSortBy(prev => prev === "name" ? "created" : "name")}
                      className="border border-[#e5e7eb] rounded bg-white text-xs h-8 px-3 text-[#374151] hover:bg-slate-50 font-semibold"
                    >
                      Sorted by {sortBy === "name" ? "Name" : "Created Date"}
                    </button>
                  </div>

                  <div className="flex gap-2 w-full md:w-auto justify-end">
                    {/* Layout switcher */}
                    <div className="border border-[#e5e7eb] rounded bg-white flex overflow-hidden">
                      <button
                        onClick={() => setViewLayout("grid")}
                        className={`p-1.5 ${viewLayout === "grid" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"}`}
                        title="Grid View"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setViewLayout("list")}
                        className={`p-1.5 ${viewLayout === "list" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:bg-slate-50"}`}
                        title="List View"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                    </div>

                    <Button
                      onClick={() => {
                        setIsNewProjectOpen(true);
                        if (githubRepos.length === 0) {
                          fetchGitHubRepos();
                        }
                      }}
                      className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 px-3 rounded shadow-sm font-bold"
                    >
                      + New Project
                    </Button>
                  </div>
                </div>

                {/* Dashboard Main Columns */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                  
                  {/* Left Column: Projects Grid / List */}
                  <div className="lg:col-span-3 space-y-6">
                    {projectsLoading ? (
                      <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 text-center text-slate-400 text-xs">
                        <div className="h-6 w-6 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        Syncing workspace projects from Supabase...
                      </div>
                    ) : filteredProjects.length === 0 ? (
                      <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 text-center text-slate-400 text-xs">
                        No projects match the current search or status filter.
                      </div>
                    ) : viewLayout === "grid" ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredProjects.map((p) => {
                          const isActive = selectedProjectId === p.project_id;
                          return (
                            <div 
                              key={p.project_id}
                              onClick={() => handleSelectProject(p)}
                              className={`shiny-card shiny-card-hover-lift cursor-pointer bg-white border rounded-lg p-4 shadow-sm flex flex-col justify-between min-h-[12rem] h-auto pb-3 ${
                                isActive 
                                  ? "border-[#3ecf8e] ring-2 ring-[#3ecf8e]/20 bg-emerald-50/5" 
                                  : p.status === "completed"
                                    ? "border-blue-200 bg-blue-50/5"
                                    : p.status === "paused" 
                                      ? "border-amber-250 bg-amber-50/5" 
                                      : "border-[#e5e7eb]"
                              }`}
                            >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-lg shrink-0 ${
                                  p.status === "completed" 
                                    ? "bg-blue-50 text-blue-600" 
                                    : p.status === "paused" 
                                      ? "bg-amber-50 text-amber-600" 
                                      : "bg-emerald-50 text-emerald-600"
                                }`}>
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                  </svg>
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-bold text-slate-900 text-sm truncate">{p.project_name}</h3>
                                </div>
                              </div>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border capitalize ${
                                p.status === "completed"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : p.status === "active" 
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                    : "bg-amber-50 text-amber-800 border-amber-200"
                              }`}>
                                {p.status}
                              </span>
                            </div>

                            <div className="mt-3">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Repository</p>
                              <p className="text-xs text-slate-600 font-mono truncate mt-0.5" title={p.github_repo_url}>
                                {p.github_repo_url}
                              </p>
                            </div>

                            <div className="mt-2 flex items-center justify-between text-xs" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5 min-w-0 w-full">
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider shrink-0">Jira Key:</span>
                                {editingJiraProjectId === p.project_id ? (
                                  <div className="flex items-center gap-1 w-full max-w-[150px]">
                                    <Input
                                      value={editingJiraKeyVal}
                                      onChange={(e) => setEditingJiraKeyVal(e.target.value)}
                                      placeholder="e.g. PROJ"
                                      className="h-6 text-[11px] px-1.5 py-0 border-[#e5e7eb] text-black uppercase font-mono font-bold w-full"
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          handleSaveJiraKey(p.project_id, editingJiraKeyVal);
                                          setEditingJiraProjectId(null);
                                        } else if (e.key === "Escape") {
                                          setEditingJiraProjectId(null);
                                        }
                                      }}
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => {
                                        handleSaveJiraKey(p.project_id, editingJiraKeyVal);
                                        setEditingJiraProjectId(null);
                                      }}
                                      className="text-emerald-600 hover:text-emerald-700 font-bold text-sm px-1"
                                    >
                                      ✓
                                    </button>
                                    <button
                                      onClick={() => setEditingJiraProjectId(null)}
                                      className="text-rose-600 hover:text-rose-700 font-bold text-sm px-1"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className={`font-mono text-[10px] font-bold ${p.jira_project_key ? "text-blue-700 bg-blue-50 border border-blue-150 px-1.5 py-0.5 rounded" : "text-slate-400 italic"}`}>
                                      {p.jira_project_key || "None"}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setEditingJiraProjectId(p.project_id);
                                        setEditingJiraKeyVal(p.jira_project_key || "");
                                      }}
                                      className="text-slate-400 hover:text-slate-600 text-[10px] underline shrink-0 font-medium"
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-[#e5e7eb]">
                              <span className="text-[9px] text-[#8c8c8c] font-mono">
                                Created: {new Date(p.created_at || "").toLocaleDateString()}
                              </span>
                              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                {p.status !== "completed" && (
                                  <button
                                    onClick={() => handleToggleProjectStatus(p.project_id, p.status || "active")}
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                      p.status === "active" 
                                        ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200" 
                                        : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                                    }`}
                                  >
                                    {p.status === "active" ? "Pause" : "Resume"}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleMarkProjectCompleted(p.project_id, p.status !== "completed")}
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                    p.status === "completed"
                                      ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                                      : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                                  }`}
                                >
                                  {p.status === "completed" ? "Reactivate" : "Complete"}
                                </button>
                                <button
                                  onClick={() => handleDeselectProject(p.project_id, p.project_name)}
                                  className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 transition-colors"
                                >
                                  Deselect
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    ) : (
                      <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg shadow-sm overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-[#e5e7eb]">
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Project Name</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Repository URL</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Jira Key</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Status</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredProjects.map((p) => {
                              const isActive = selectedProjectId === p.project_id;
                              return (
                                <TableRow 
                                  key={p.project_id} 
                                  onClick={() => handleSelectProject(p)}
                                  className={`cursor-pointer border-[#e5e7eb] hover:bg-slate-50 transition-colors ${
                                    isActive ? "bg-emerald-50/10 border-l-2 border-l-[#3ecf8e]" : ""
                                  }`}
                                >
                                <TableCell className="font-bold text-xs text-slate-900">{p.project_name}</TableCell>
                                <TableCell className="font-mono text-xs text-slate-600">{p.github_repo_url}</TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}>
                                  {editingJiraProjectId === p.project_id ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        value={editingJiraKeyVal}
                                        onChange={(e) => setEditingJiraKeyVal(e.target.value)}
                                        placeholder="e.g. PROJ"
                                        className="h-6 text-[11px] px-1.5 py-0 border-[#e5e7eb] text-black uppercase font-mono font-bold w-20"
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            handleSaveJiraKey(p.project_id, editingJiraKeyVal);
                                            setEditingJiraProjectId(null);
                                          } else if (e.key === "Escape") {
                                            setEditingJiraProjectId(null);
                                          }
                                        }}
                                        autoFocus
                                      />
                                      <button
                                        onClick={() => {
                                          handleSaveJiraKey(p.project_id, editingJiraKeyVal);
                                          setEditingJiraProjectId(null);
                                        }}
                                        className="text-emerald-600 hover:text-emerald-700 font-bold text-sm px-1"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        onClick={() => setEditingJiraProjectId(null)}
                                        className="text-rose-600 hover:text-rose-700 font-bold text-sm px-1"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <span className={`font-mono text-[10px] font-bold ${p.jira_project_key ? "text-blue-700 bg-blue-50 border border-blue-150 px-1.5 py-0.5 rounded" : "text-slate-400 italic"}`}>
                                        {p.jira_project_key || "None"}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setEditingJiraProjectId(p.project_id);
                                          setEditingJiraKeyVal(p.jira_project_key || "");
                                        }}
                                        className="text-slate-400 hover:text-slate-600 text-[10px] underline"
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border capitalize ${
                                    p.status === "completed"
                                      ? "bg-blue-50 text-blue-700 border-blue-200"
                                      : p.status === "active" 
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                        : "bg-amber-50 text-amber-800 border-amber-200"
                                  }`}>
                                    {p.status}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center justify-end gap-1.5">
                                    {p.status !== "completed" && (
                                      <button
                                        onClick={() => handleToggleProjectStatus(p.project_id, p.status || "active")}
                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                          p.status === "active" 
                                            ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200" 
                                            : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
                                        }`}
                                      >
                                        {p.status === "active" ? "Pause" : "Resume"}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleMarkProjectCompleted(p.project_id, p.status !== "completed")}
                                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                                        p.status === "completed"
                                          ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                                          : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                                      }`}
                                    >
                                      {p.status === "completed" ? "Reactivate" : "Complete"}
                                    </button>
                                    <button
                                      onClick={() => handleDeselectProject(p.project_id, p.project_name)}
                                      className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 transition-colors"
                                    >
                                      Deselect
                                    </button>
                                  </div>
                                </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Live Git Commit History Dashboard Panel */}
                  <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900 text-xs">Live Repository Activity</h3>
                        <p className="text-[10px] text-[#6b7280] mt-0.5">Real-time commit audit feed</p>
                      </div>
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3ecf8e] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3ecf8e]"></span>
                      </span>
                    </div>

                    <div className="border-t border-[#e5e7eb] pt-3">
                      {activeProjectCommitsLoading ? (
                        <div className="py-12 flex flex-col items-center justify-center space-y-2">
                          <div className="h-5 w-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin" />
                          <span className="text-[10px] text-slate-400">Fetching live commits...</span>
                        </div>
                      ) : activeProjectCommits.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 text-[11px] leading-relaxed">
                          No commits loaded. Select a project or verify your GITHUB_PAT integration.
                        </div>
                      ) : (
                        <div className="max-h-[380px] overflow-y-auto pr-1 pl-3">
                          {activeProjectCommits.slice(0, 6).map((commit: any, commitIdx: number) => (
                            <div key={commit.sha} className="relative pl-5 pb-4 last:pb-0">
                              {/* Vertical Line */}
                              {commitIdx < activeProjectCommits.slice(0, 6).length - 1 && (
                                <div 
                                  className="absolute bg-[#3ecf8e]/25"
                                  style={{ left: "4px", top: "9px", bottom: "-9px", width: "2px" }}
                                />
                              )}
                              {/* Timeline indicator node */}
                              <div 
                                className="absolute bg-[#3ecf8e] border-2 border-white shadow-sm"
                                style={{ left: "0px", top: "4px", width: "10px", height: "10px", borderRadius: "50%" }}
                              />
                              
                              <div className="space-y-1">
                                <p className="text-[11px] font-semibold text-slate-900 leading-snug break-words">
                                  {commit.message}
                                </p>
                                
                                <div className="flex items-center gap-1.5 text-[9px] text-[#8c8c8c] font-mono">
                                  <span className="font-semibold text-slate-600">@{commit.githubUsername}</span>
                                  <span className="h-1 w-1 rounded-full bg-slate-300 shrink-0" />
                                  <span className="bg-slate-50 text-slate-500 border border-slate-100 px-1 py-0.2 rounded text-[8px] font-bold">
                                    {commit.sha.substring(0, 7)}
                                  </span>
                                </div>

                                {commit.filesChanged && commit.filesChanged.length > 0 && (
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Modified:</span>
                                    {commit.filesChanged.slice(0, 3).map((f: string, fIdx: number) => {
                                      const basename = f.split('/').pop() || f;
                                      return (
                                        <span 
                                          key={fIdx} 
                                          title={f} 
                                          className="text-[8px] bg-slate-50 text-slate-600 border border-slate-100 px-1 rounded truncate max-w-[80px]"
                                        >
                                          {basename}
                                        </span>
                                      );
                                    })}
                                    {commit.filesChanged.length > 3 && (
                                      <span className="text-[8px] text-slate-400 font-bold">+{commit.filesChanged.length - 3} more</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Database Diagnostics Table (Real-time telemetry log panel integrated) */}
                <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg overflow-hidden flex flex-col shadow-sm">
                  <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between">
                    <div>
                      <h2 className="text-xs font-bold text-[#111827]">System Diagnostics Logs</h2>
                      <p className="text-[10px] text-[#6b7280] mt-0.5">Real-time system events gathered from active backend and frontend logs.</p>
                    </div>
                    <Button
                      onClick={fetchLogs}
                      disabled={logsLoading}
                      variant="outline"
                      className="border-[#e5e7eb] hover:bg-[#f9fafb] text-xs h-7 text-[#374151] font-semibold"
                    >
                      {logsLoading ? "Reloading..." : "Sync Logs"}
                    </Button>
                  </div>

                  <div className="bg-white overflow-auto max-h-[500px] border-t border-[#e5e7eb]">
                    {logsLoading && logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-[200px] text-[#6b7280] text-xs">
                        <div className="h-5 w-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-3" />
                        Streaming system diagnostics logs...
                      </div>
                    ) : logs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                        <p className="text-[#6b7280] text-xs font-semibold">No Telemetry Events Recorded</p>
                        <p className="text-[#8c8c8c] text-[10px] max-w-xs mt-1">
                          Use the seed scripts or click "Mock Server Crash" in the header to register logs.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] sticky top-0 z-10">
                          <tr>
                            <th className="text-[11px] font-bold text-[#6b7280] px-4 py-3 whitespace-nowrap w-[15%] min-w-[150px]">Timestamp</th>
                            <th className="text-[11px] font-bold text-[#6b7280] px-4 py-3 whitespace-nowrap w-[15%] min-w-[150px]">Project Name</th>
                            <th className="text-[11px] font-bold text-[#6b7280] px-4 py-3 whitespace-nowrap w-[10%] min-w-[100px]">Severity</th>
                            <th className="text-[11px] font-bold text-[#6b7280] px-4 py-3 w-[60%] min-w-[500px]">Error Context Trace</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e5e7eb]">
                          {logs.map((log) => (
                            <tr key={log.event_id} className="hover:bg-[#f9fafb] transition-colors align-top">
                              <td className="text-[10px] font-mono text-[#6b7280] px-4 py-3 whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td className="font-bold text-xs text-[#111827] px-4 py-3 whitespace-nowrap">
                                {Array.isArray(log.active_projects)
                                  ? (log.active_projects[0]?.project_name || "Unknown Project")
                                  : (log.active_projects?.project_name || "Unknown Project")}
                              </td>
                              <td className="px-4 py-3">
                                {getSeverityBadge(log.error_trace)}
                              </td>
                              <td className="px-4 py-3">
                                <pre className="text-[10px] text-[#374151] font-mono bg-[#f9fafb] p-2.5 border border-[#e5e7eb] rounded whitespace-pre-wrap leading-relaxed break-all max-w-[800px]">
                                  {log.error_trace}
                                </pre>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    )}
                  </div>
                </div>
                
              </div>
            )}

            {/* CO-PILOT CHAT CONSOLE TAB */}
            {activeTab === "chat" && (
              <div className="flex-1 min-h-0 flex flex-col sm:flex-row gap-3 sm:gap-4 overflow-hidden min-w-0">
                
                {/* Chat Session History Left Column (Gemini Style) */}
                <div className="w-full sm:w-52 md:w-56 bg-white border border-[#e5e7eb] rounded-lg flex flex-col overflow-hidden shrink-0 shadow-sm max-h-40 sm:max-h-none">
                  {/* New Chat Button */}
                  <div className="p-3 border-b border-[#e5e7eb]">
                    <Button
                      onClick={() => handleStartNewChat()}
                      className="w-full bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs h-9 rounded flex items-center justify-center gap-1.5 shadow-sm transition-all"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      New Chat
                    </Button>
                  </div>

                  {/* Sessions Scroll Area */}
                  <div className="flex-1 min-h-0 py-2 flex flex-col">
                    <ScrollArea className="flex-1 min-h-0">
                      {sessions.length === 0 ? (
                        <p className="text-[10px] text-[#8c8c8c] text-center mt-5">No active sessions</p>
                      ) : (
                        <div className="px-2 space-y-1">
                          {sessions.map((s) => (
                            <div
                              key={s.threadId}
                              onClick={() => handleSwitchSession(s.threadId)}
                              className={`group w-full flex items-center justify-between px-2.5 py-2 rounded text-xs font-medium cursor-pointer transition-all ${
                                s.threadId === threadId
                                  ? "bg-[#f3f4f6] text-[#111827] font-bold"
                                  : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <svg className="w-3.5 h-3.5 text-[#8c8c8c] group-hover:text-[#3ecf8e] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                <span className="truncate pr-1 text-[11px]">{s.title}</span>
                              </div>
                              <button
                                onClick={(e) => handleDeleteSession(s.threadId, e)}
                                className="opacity-0 group-hover:opacity-100 text-[#8c8c8c] hover:text-red-500 p-0.5 rounded transition-opacity"
                                title="Delete Chat"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>

                {/* Active Chat Dialogue Panel */}
                <div className="shiny-card flex-1 bg-white border border-[#e5e7eb] rounded-lg overflow-hidden flex flex-col shadow-sm min-w-0">
                  
                  {/* Panel Header */}
                  <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between bg-[#f9fafb]">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#3ecf8e] animate-pulse" />
                      <h2 className="text-xs font-bold text-[#111827]">
                        Console Stream
                      </h2>
                    </div>
                    {/* Selected Model display badge */}
                    <span className="text-[10px] font-semibold bg-[#e8fbf2] text-[#047857] px-2 py-0.5 rounded border border-[#a7f3d0]">
                      Using: {selectedModel.replace("models/", "")}
                    </span>
                  </div>

                  {/* Messages Stream */}
                  <div className="flex-1 min-h-0 overflow-hidden bg-[#fafbfa] min-w-0 flex flex-col">
                    <ScrollArea className="flex-1 min-h-0 w-full [&>[data-slot=scroll-area-viewport]]:overflow-x-hidden">
                      <div className={`${isSidebarOpen ? 'max-w-5xl' : 'max-w-[1400px]'} mx-auto w-full px-4 md:px-8 py-6 space-y-6 flex flex-col transition-all duration-300`}>
                        {messages.length === 0 ? (
                          <div className="flex flex-col items-center w-full py-6 px-3">
                            {/* Header */}
                            <div className="flex items-center gap-2 mb-1">
                              <div className="h-7 w-7 rounded-full bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center">
                                <svg className="w-4 h-4 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                </svg>
                              </div>
                              <p className="text-sm font-bold text-[#111827]">AEL — Autonomous Engineering Lead</p>
                            </div>
                            <p className="text-[11px] text-[#6b7280] mb-5 text-center max-w-sm">
                              Your AI-powered SRE agent. Click a chip below or type a command to get started.
                            </p>

                            {/* Feature Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl">
                              {[
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                  ),
                                  title: "Sprint Daily Standup",
                                  desc: "Generate an AI standup report from today's commits, open tickets, and team activity.",
                                  chip: "Sprint Daily Standup",
                                  color: "bg-purple-50 border-purple-200 text-purple-700",
                                },
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                  ),
                                  title: "Triage Latest Crash",
                                  desc: "Detect the latest system crash, auto-assign it to the responsible developer, and open a Jira ticket.",
                                  chip: "Triage Latest Crash",
                                  color: "bg-red-50 border-red-200 text-red-700",
                                },
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                      <line x1="16" y1="2" x2="16" y2="6" />
                                      <line x1="8" y1="2" x2="8" y2="6" />
                                      <line x1="3" y1="10" x2="21" y2="10" />
                                    </svg>
                                  ),
                                  title: "Today's Summary",
                                  desc: "View all incidents, meetings, and actions taken by AEL today in one SRE report.",
                                  chip: "Show me a summary of today",
                                  color: "bg-blue-50 border-blue-200 text-blue-700",
                                },
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="18" y1="20" x2="18" y2="10" />
                                      <line x1="12" y1="20" x2="12" y2="4" />
                                      <line x1="6" y1="20" x2="6" y2="14" />
                                    </svg>
                                  ),
                                  title: "Weekly Summary",
                                  desc: "Full weekly SRE performance report — incidents, uptime, developer contributions, and meetings.",
                                  chip: "Show me a summary of this week",
                                  color: "bg-indigo-50 border-indigo-200 text-indigo-700",
                                },
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                  ),
                                  title: "Direct Email",
                                  desc: "Select a team member, provide context, and AEL drafts and sends a professional email via Gmail.",
                                  chip: "Send a direct email to a team member",
                                  color: "bg-emerald-50 border-emerald-200 text-emerald-700",
                                },
                                {
                                  icon: (
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                      <path d="M23 21v-2a4 4 0 00-3-3.87" />
                                      <path d="M16 3.13a4 4 0 010 7.75" />
                                    </svg>
                                  ),
                                  title: "Schedule Team Meeting",
                                  desc: "Book a Google Meet for the entire team, generate the link, and send calendar invites automatically.",
                                  chip: "Schedule a team meeting",
                                  color: "bg-amber-50 border-amber-200 text-amber-700",
                                },
                              ].map((f) => (
                                <button
                                  key={f.title}
                                  onClick={() => triggerAgentMessage(f.chip)}
                                  disabled={sendingMessage}
                                  className="text-left p-3 rounded-lg border bg-white hover:shadow-md transition-all group cursor-pointer border-[#e5e7eb] hover:border-[#3ecf8e]"
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border flex items-center gap-1.5 ${f.color}`}>
                                      {f.icon}
                                      <span>{f.title}</span>
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-[#6b7280] leading-relaxed group-hover:text-[#374151] transition-colors">
                                    {f.desc}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          messages.map((m, idx) => {
                            const isUser = m.role === "user";
                            return (
                              <div
                                key={idx}
                                className={`flex flex-col group ${isUser ? "items-end self-end w-full" : "items-start self-start w-full"}`}
                              >
                                {/* Label row */}
                                <div className={`flex items-center gap-1.5 mb-1 ${isUser ? "justify-end" : ""}`}>
                                  <span className="text-[10px] text-[#8c8c8c] font-semibold">
                                    {isUser ? "Developer Override" : "Autonomous Lead"}
                                  </span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(m.content);
                                      toast.success("Message copied to clipboard!");
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-slate-600 rounded"
                                    title="Copy message text"
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                  </button>
                                </div>

                                {/* Bubble */}
                                <div
                                  className={`rounded-2xl px-4 py-3 text-xs leading-relaxed break-words shadow-sm border min-w-0 overflow-hidden ${
                                    isUser
                                      ? "w-fit max-w-[75%] bg-[#3ecf8e]/10 text-slate-850 border-[#3ecf8e]/20 self-end"
                                      : "w-fit max-w-[85%] md:max-w-[75%] bg-white text-slate-700 border-slate-200/80 self-start"
                                  }`}
                                >
                                  {m.role === "assistant" ? (
                                    <div
                                      className="prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-100 prose-pre:text-slate-800 prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto prose-table:w-full w-full min-w-0"
                                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                                    />
                                  ) : (
                                    <span className="whitespace-pre-wrap break-words">{m.content}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}

                        {/* Interruption overrides */}
                        {interruptionReason && (
                          <div className={`border rounded-md p-4 space-y-3 mt-3 ${
                            interruptionReason.startsWith("email_")
                              ? "bg-emerald-50/40 border-emerald-200"
                              : "bg-amber-50/50 border-amber-200"
                          }`}>
                            <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
                              interruptionReason.startsWith("email_")
                                ? "text-emerald-700"
                                : "text-amber-700"
                            }`}>
                              <span>{interruptionReason.startsWith("email_") ? "✉️" : "⚡"}</span>{" "}
                              {interruptionReason.startsWith("email_") 
                                ? "Email Co-Pilot Assistant" 
                                : "Interrupt Intercepted (HIL Action)"}
                            </div>

                            {/* Ticket Approval Panel */}
                            {interruptionReason === "human_approval_required" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] leading-relaxed">
                                  AEL SRE is waiting for confirmation to proceed. Schedule Google Calendar Sync meeting and record Incident Ticket in Supabase?
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => handleApprovalDecision(true)}
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 flex-1 font-bold rounded shadow-sm"
                                    disabled={sendingMessage}
                                  >
                                    Approve & Write Ticket
                                  </Button>
                                  <Button
                                    onClick={() => handleApprovalDecision(false)}
                                    variant="outline"
                                    className="border-[#e5e7eb] hover:bg-[#f9fafb] text-red-650 text-xs h-8 flex-1 rounded bg-white text-red-650"
                                    disabled={sendingMessage}
                                  >
                                    Decline / Cancel
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Unmapped Identity Panel */}
                            {interruptionReason === "unmapped_identity" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151]">
                                  Identified git author is missing from corporate registry database. Enter email to resolve:
                                </p>
                                <div className="flex gap-2">
                                  <Input
                                    type="email"
                                    placeholder="developer@company.com"
                                    value={customEmail}
                                    onChange={(e) => setCustomEmail(e.target.value)}
                                    className="bg-white border-[#e5e7eb] text-xs h-8 flex-1 rounded text-black"
                                    disabled={sendingMessage}
                                  />
                                  <Button
                                    onClick={handleEmailSubmission}
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 font-bold rounded shadow-sm"
                                    disabled={sendingMessage}
                                  >
                                    Resolve
                                  </Button>
                                </div>
                              </div>
                            )}

                            {/* Workload Warning Panel */}
                            {interruptionReason === "workload_overload" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] leading-relaxed">
                                  Warning: Culprit developer currently has multiple overdue/critical tasks in this sprint.
                                </p>
                                <div className="flex flex-col gap-2">
                                  <Button
                                    onClick={() => {
                                      triggerAgentMessage("yes");
                                    }}
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 font-bold rounded shadow-sm"
                                    disabled={sendingMessage}
                                  >
                                    Override & Assign Anyway
                                  </Button>
                                  <div className="border-t border-[#e5e7eb] pt-2.5 space-y-1.5">
                                    <p className="text-[9px] text-[#6b7280]">Or reassign to alternative email address:</p>
                                    <div className="flex gap-2">
                                      <Input
                                        type="email"
                                        placeholder="dev@company.com"
                                        value={customEmail}
                                        onChange={(e) => setCustomEmail(e.target.value)}
                                        className="bg-white border-[#e5e7eb] text-xs h-8 flex-1 rounded text-black"
                                        disabled={sendingMessage}
                                      />
                                      <Button
                                        onClick={() => {
                                          if (customEmail.includes("@")) {
                                            triggerAgentMessage(customEmail);
                                            setCustomEmail("");
                                          } else {
                                            toast.error("Invalid email address.");
                                          }
                                        }}
                                        className="bg-white border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] text-xs h-8 rounded shadow-sm font-semibold"
                                        disabled={sendingMessage}
                                      >
                                        Reassign
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                            {/* Standup Remediation Approval Panel */}
                            {interruptionReason === "standup_remediation_approval" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] leading-relaxed">
                                  AEL found Critical overdue tasks and recommends scheduling follow-up sync meetings for all affected developers. Approve to proceed?
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => triggerAgentMessage("yes")}
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 flex-1 font-bold rounded shadow-sm flex items-center justify-center gap-1.5"
                                    disabled={sendingMessage}
                                  >
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Yes, Schedule All Syncs
                                  </Button>
                                  <Button
                                    onClick={() => triggerAgentMessage("no")}
                                    variant="outline"
                                    className="border-[#e5e7eb] hover:bg-[#f9fafb] text-red-600 text-xs h-8 flex-1 rounded bg-white flex items-center justify-center gap-1.5"
                                    disabled={sendingMessage}
                                  >
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Skip / Dismiss
                                  </Button>
                                </div>
                              </div>
                            )}
                            {/* Project Selection Panel */}
                            {interruptionReason === "project_selection_required" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] font-semibold leading-relaxed">
                                  Multiple projects found. Please select which project this scheduling request belongs to:
                                </p>
                                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                  {projects.map((p, idx) => (
                                    <Button
                                      key={p.project_id}
                                      onClick={() => triggerAgentMessage(p.project_name)}
                                      className="bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] text-xs h-8 justify-start font-semibold rounded shadow-sm text-left px-3 flex items-center gap-2"
                                      disabled={sendingMessage}
                                    >
                                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                                        {idx + 1}
                                      </span>
                                      <span className="truncate">{p.project_name}</span>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* Jira Assignee Selection Panel */}
                            {interruptionReason === "jira_assignee_selection_required" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] font-semibold leading-relaxed">
                                  Select a developer to assign this Jira issue to:
                                </p>
                                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                  {team.map((member, idx) => (
                                    <Button
                                      key={member.dev_id}
                                      onClick={() => triggerAgentMessage(member.name)}
                                      className="bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] text-xs h-8 justify-start font-semibold rounded shadow-sm text-left px-3 flex items-center gap-2"
                                      disabled={sendingMessage}
                                    >
                                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                                        {idx + 1}
                                      </span>
                                      <span className="truncate">{member.name} ({member.email_address})</span>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Direct Email Target Selection Panel */}
                            {interruptionReason === "email_target_selection" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] font-semibold leading-relaxed">
                                  Select a team member to email:
                                </p>
                                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                                  {team.map((member, idx) => (
                                    <Button
                                      key={member.dev_id}
                                      onClick={() => triggerAgentMessage(member.name)}
                                      className="bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] text-xs h-8 justify-start font-semibold rounded shadow-sm text-left px-3 flex items-center gap-2"
                                      disabled={sendingMessage}
                                    >
                                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                                        {idx + 1}
                                      </span>
                                      <span className="truncate">{member.name} ({member.email_address})</span>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Direct Email Topic Input Suggestions Panel */}
                            {interruptionReason === "email_topic_required" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] font-semibold leading-relaxed">
                                  Select a common email topic or type a custom one in the chat input below:
                                </p>
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {[
                                    "Sprint Status Update",
                                    "Code Review Request",
                                    "Production Crash Resolution",
                                    "Meeting Schedule Alignment"
                                  ].map((topic) => (
                                    <Button
                                      key={topic}
                                      onClick={() => triggerAgentMessage(topic)}
                                      className="bg-white border border-[#e5e7eb] hover:bg-[#f9fafb] text-[#111827] text-xs h-8 font-semibold rounded shadow-sm px-3"
                                      disabled={sendingMessage}
                                    >
                                      {topic}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Direct Email Send Approval Panel */}
                            {interruptionReason === "email_send_approval" && (
                              <div className="space-y-2">
                                <p className="text-[11px] text-[#374151] leading-relaxed">
                                  A professional email has been generated. Ready to deliver the email?
                                </p>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => triggerAgentMessage("yes")}
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 flex-1 font-bold rounded shadow-sm flex items-center justify-center gap-1.5"
                                    disabled={sendingMessage}
                                  >
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    Send Email
                                  </Button>
                                  <Button
                                    onClick={() => triggerAgentMessage("no")}
                                    variant="outline"
                                    className="border-[#e5e7eb] hover:bg-[#f9fafb] text-red-650 text-xs h-8 flex-1 rounded bg-white flex items-center justify-center gap-1.5 text-red-650"
                                    disabled={sendingMessage}
                                  >
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                    Cancel Draft
                                  </Button>
                                </div>
                              </div>
                            )}

                          </div>
                        )}

                        {sendingMessage && (
                          <div className="flex items-center gap-1.5 text-[#6b7280] text-[10px] font-mono">
                            <span className="h-1 w-1 bg-[#3ecf8e] rounded-full animate-bounce" />
                            <span className="h-1 w-1 bg-[#3ecf8e] rounded-full animate-bounce delay-75" />
                            <span className="h-1 w-1 bg-[#3ecf8e] rounded-full animate-bounce delay-150" />
                            AEL is processing...
                          </div>
                        )}
                        <div ref={chatEndRef} />
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Suggestion Chips */}
                  {!interruptionReason && (
                    <div className="px-4 py-3 border-t border-[#e5e7eb] bg-[#f9fafb]">
                      <div className={`${isSidebarOpen ? 'max-w-5xl' : 'max-w-[1400px]'} mx-auto w-full flex flex-wrap gap-2 justify-center sm:justify-start transition-all duration-300`}>
                        <button
                          onClick={() => triggerAgentMessage("Give me a status update on the team")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2" />
                          </svg>
                          Sprint Daily Standup
                        </button>
                        <button
                          onClick={() => triggerAgentMessage("Investigate the latest crash")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          Triage Latest Crash
                        </button>
                        <button
                          onClick={() => triggerAgentMessage("Show me a summary of today")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          Today's Summary
                        </button>
                        <button
                          onClick={() => triggerAgentMessage("Show me a summary of this week")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                          </svg>
                          Weekly Summary
                        </button>
                        <button
                          onClick={() => triggerAgentMessage("Send a direct email to a team member")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Direct Email
                        </button>
                        <button
                          onClick={() => triggerAgentMessage("Schedule a team meeting")}
                          className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                          disabled={sendingMessage}
                        >
                          <svg className="w-3 h-3 text-[#3ecf8e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          Team Meeting
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Chat Input Form — always enabled; free-text resumes the agent graph */}
                  <form onSubmit={handleSendMessage} className="border-t border-[#e5e7eb] py-4 px-4 md:px-8 bg-white flex flex-col gap-2">
                    <div className={`${isSidebarOpen ? 'max-w-5xl' : 'max-w-[1400px]'} mx-auto w-full flex flex-col gap-2 transition-all duration-300`}>
                      {/* Cancel bar — shown whenever a workflow is in progress */}
                      {interruptionReason && (
                        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                          <span className="text-[10px] font-medium text-amber-700 flex items-center gap-1.5">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Workflow in progress — type a reply or cancel
                          </span>
                          <button
                            type="button"
                            onClick={() => triggerAgentMessage("exit")}
                            disabled={sendingMessage}
                            className="text-[10px] font-bold text-red-650 hover:text-red-800 hover:bg-red-50 border border-red-200 rounded px-2 py-0.5 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel / Exit
                          </button>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Input
                          value={inputMessage}
                          onChange={(e) => setInputMessage(e.target.value)}
                          placeholder={
                            interruptionReason
                              ? "Reply to continue the workflow, or type 'exit' to cancel..."
                              : "Ask AEL to schedule a meeting, update a task, investigate a crash..."
                          }
                          className="bg-white border-[#e5e7eb] text-xs h-9 flex-1 focus-visible:ring-[#3ecf8e] rounded text-black"
                          disabled={sendingMessage}
                        />
                        <Button
                          type="submit"
                          className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs h-9 px-4 rounded shadow-sm"
                          disabled={sendingMessage || !inputMessage.trim()}
                        >
                          Send
                        </Button>
                      </div>
                    </div>
                  </form>
                </div>

              </div>
            )}

            {/* TEAM TAB */}
            {activeTab === "team" && (
              <div className="shiny-card flex flex-col space-y-5 bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Corporate Team Directory</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Manage team members, update registration settings, or schedule incident/remediation meetings.</p>
                  </div>
                  <Button
                    onClick={() => setIsNewTeamOpen(true)}
                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs font-bold px-3 py-1.5 h-auto rounded flex items-center gap-1.5 shadow-sm transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Team Member
                  </Button>
                </div>

                <div>
                  {teamLoading ? (
                    <div className="flex flex-col items-center justify-center h-48 text-xs text-slate-400">
                      <div className="h-5 w-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-2" />
                      Loading team members...
                    </div>
                  ) : team.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-10">No team members registered. Please run migrations/seed scripts.</p>
                  ) : (
                    <div className="border border-[#e5e7eb] rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-slate-50">
                          <TableRow className="border-[#e5e7eb]">
                            <TableHead className="text-xs font-bold text-slate-700">Developer Name</TableHead>
                            <TableHead className="text-xs font-bold text-slate-700">Corporate Email</TableHead>
                            <TableHead className="text-xs font-bold text-slate-700">GitHub Username</TableHead>
                            <TableHead className="text-xs font-bold text-slate-700">Role</TableHead>
                            <TableHead className="text-xs font-bold text-slate-700">Status</TableHead>
                            <TableHead className="text-xs font-bold text-slate-700">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {team.map((member) => (
                            <TableRow key={member.dev_id} className="border-[#e5e7eb] hover:bg-slate-50">
                              <TableCell className="font-bold text-xs text-slate-900">{member.name}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-600">{member.email_address}</TableCell>
                              <TableCell className="font-mono text-xs text-emerald-600">@{member.github_username}</TableCell>
                              <TableCell className="text-xs text-slate-600">{member.role || "Software Engineer"}</TableCell>
                              <TableCell>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Registry Synced
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {/* Remove member */}
                                  <button
                                    onClick={() => handleDeleteMember(member.dev_id, member.name)}
                                    className="text-[10px] px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-semibold transition-colors"
                                  >
                                    Remove
                                  </button>
                                  {/* Schedule sync via chat */}
                                  <button
                                    onClick={() => {
                                      switchTab("chat");
                                      setTimeout(() => {
                                        triggerAgentMessage(`Schedule a follow-up sync meeting with ${member.name} at ${member.email_address} for overdue task review`);
                                      }, 200);
                                    }}
                                    className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 font-semibold transition-colors"
                                  >
                                    📅 Schedule Sync
                                  </button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* INTEGRATIONS TAB */}
            {activeTab === "integrations" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Third-Party Integration Modules</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Control live connectivity APIs linked to the AEL agent loop.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GitHub */}
                  <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-950 text-white flex items-center justify-center font-bold text-lg">
                          G
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-950">GitHub REST API</h3>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded font-bold">Connected</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">v3 REST</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Syncs latest repository branches and audits commit histories. Resolves commits for semantic crash triaging.
                    </p>
                    <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-[#e5e7eb]">
                       <span>Calls GET /user on GitHub API v3</span>
                       <button
                         onClick={() => verifyIntegration("github")}
                         disabled={integrationChecking["github"]}
                         className="text-[#3ecf8e] font-bold hover:underline disabled:opacity-50 disabled:cursor-wait"
                       >
                         {integrationChecking["github"] ? "Verifying..." : "Verify Key"}
                       </button>
                    </div>
                  </div>

                  {/* Supabase */}
                  <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-50 text-[#3ecf8e] flex items-center justify-center font-bold text-lg">
                          S
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-950">Supabase DB Client</h3>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded font-bold">Active</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">PostgreSQL</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Persists active team registries, sprint task databases, and monitors the incoming diagnostic system events telemetry logs.
                    </p>
                    <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-[#e5e7eb]">
                       <span>Measures query round-trip latency</span>
                       <button
                         onClick={() => verifyIntegration("supabase")}
                         disabled={integrationChecking["supabase"]}
                         className="text-[#3ecf8e] font-bold hover:underline disabled:opacity-50 disabled:cursor-wait"
                       >
                         {integrationChecking["supabase"] ? "Pinging..." : "Test Ping"}
                       </button>
                    </div>
                  </div>

                  {/* Google Workspace */}
                  <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
                          G
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-950">Google Workspace (Calendar)</h3>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded font-bold">Enabled</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">OAuth2</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Schedules Google Meet video calls automatically and sends calendar invites to culprit developers upon standup remediation approval.
                    </p>
                    <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-[#e5e7eb]">
                       <span>Calendar Scope: Read/Write</span>
                       <button
                         onClick={() => {
                           toast.info("Redirecting to Google OAuth consent screen...");
                           setTimeout(() => { window.location.href = "/api/auth/google"; }, 800);
                         }}
                         className="text-[#3ecf8e] font-bold hover:underline"
                       >
                         Re-Auth
                       </button>
                    </div>
                  </div>

                  {/* Jira */}
                  <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                          J
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-950">Jira REST API</h3>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded font-bold">Connected</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">REST v3</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Reads sprint boards and task statuses for all team members. Creates incident tickets and assigns them to developers during the triage workflow.
                    </p>
                    <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-[#e5e7eb]">
                       <span>Calls /rest/agile/1.0 & /rest/api/3</span>
                       <button
                         onClick={() => verifyIntegration("jira")}
                         disabled={integrationChecking["jira"]}
                         className="text-[#3ecf8e] font-bold hover:underline disabled:opacity-50 disabled:cursor-wait"
                       >
                         {integrationChecking["jira"] ? "Verifying..." : "Verify Key"}
                       </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* USAGE TAB — REAL SUPABASE DATA */}
            {activeTab === "usage" && (
              <div className="space-y-5">
                {/* Header */}
                <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Workspace Usage Analytics</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Live data pulled from Supabase database tables.
                      {usageData && (
                        <span className="text-[10px] text-slate-400 ml-2 font-mono">
                          Last synced: {new Date(usageData.generatedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    onClick={fetchUsage}
                    disabled={usageLoading}
                    variant="outline"
                    className="border-[#e5e7eb] hover:bg-[#f9fafb] text-xs h-7 text-[#374151] font-semibold"
                  >
                    {usageLoading ? "Syncing..." : "\u21BB Refresh"}
                  </Button>
                </div>

                {usageLoading && !usageData ? (
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 flex flex-col items-center text-slate-400 text-xs">
                    <div className="h-6 w-6 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-3" />
                    Querying Supabase tables for live usage data...
                  </div>
                ) : (
                  <>
                    {/* — Row 1: Event & Record Counts — */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">System Events</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalEvents.toLocaleString() ?? "\u2014"}
                        </p>
                        <div className="flex items-center gap-1">
                          {(usageData?.weeklyChangePercent ?? 0) >= 0 ? (
                            <span className="text-[9px] text-emerald-600 font-bold">
                              {"\u2191"} {Math.abs(usageData?.weeklyChangePercent ?? 0)}% this week
                            </span>
                          ) : (
                            <span className="text-[9px] text-red-500 font-bold">
                              {"\u2193"} {Math.abs(usageData?.weeklyChangePercent ?? 0)}% this week
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400">Total rows in system_events</p>
                      </div>

                      <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Sprint Tasks</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalTasks.toLocaleString() ?? "\u2014"}
                        </p>
                        <p className="text-[9px] text-amber-600 font-semibold">
                          {usageData?.overdueTasks ?? 0} overdue / critical
                        </p>
                        <p className="text-[9px] text-slate-400">Total rows in sprint_tasks</p>
                      </div>

                      <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Team Members</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalMembers.toLocaleString() ?? "\u2014"}
                        </p>
                        <p className="text-[9px] text-emerald-600 font-semibold">Registered in corporate registry</p>
                        <p className="text-[9px] text-slate-400">Total rows in team_members</p>
                      </div>

                      <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Projects</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalProjects.toLocaleString() ?? "\u2014"}
                        </p>
                        <p className="text-[9px] text-emerald-600 font-semibold">Linked GitHub repos</p>
                        <p className="text-[9px] text-slate-400">Total rows in active_projects</p>
                      </div>
                    </div>

                    {/* — Row 2: Week-over-Week Comparison — */}
                    <div className="shiny-card shiny-card-hover-lift bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm">
                      <h3 className="text-xs font-bold text-slate-900 mb-4">Week-over-Week Event Activity</h3>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-slate-600 uppercase">This Week</span>
                            <span className="text-sm font-extrabold text-slate-950">{(usageData?.thisWeekEvents ?? 0).toLocaleString()}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="bg-[#3ecf8e] h-full rounded-full transition-all duration-700"
                              style={{
                                width: usageData && (usageData.thisWeekEvents + usageData.lastWeekEvents) > 0
                                  ? `${(usageData.thisWeekEvents / (usageData.thisWeekEvents + usageData.lastWeekEvents)) * 100}%`
                                  : "0%"
                              }}
                            />
                          </div>
                          <p className="text-[9px] text-slate-400">Events logged in the past 7 days</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-slate-600 uppercase">Last Week</span>
                            <span className="text-sm font-extrabold text-slate-950">{(usageData?.lastWeekEvents ?? 0).toLocaleString()}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="bg-slate-300 h-full rounded-full transition-all duration-700"
                              style={{
                                width: usageData && (usageData.thisWeekEvents + usageData.lastWeekEvents) > 0
                                  ? `${(usageData.lastWeekEvents / (usageData.thisWeekEvents + usageData.lastWeekEvents)) * 100}%`
                                  : "0%"
                              }}
                            />
                          </div>
                          <p className="text-[9px] text-slate-400">Events logged in the 7 days prior</p>
                        </div>
                      </div>
                    </div>

                    {/* — Row 3: Real Hourly Event Chart — */}
                    <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">System Event Distribution (Last 24 Hours)</h3>
                          <p className="text-[10px] text-slate-400 mt-0.5">Each bar = 1 hour of system_events timestamps from Supabase</p>
                        </div>
                        <span className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded">
                          {(usageData?.hourlyCounts ?? []).reduce((a, b) => a + b, 0)} events
                        </span>
                      </div>
                      {(() => {
                        const counts = usageData?.hourlyCounts ?? Array(24).fill(0);
                        const maxVal = Math.max(...counts, 1);
                        const now = new Date();
                        const CHART_HEIGHT = 140; // px
                        return (
                          <div style={{ height: `${CHART_HEIGHT}px` }} className="relative flex items-end gap-[3px] mt-2">
                            {counts.map((val, idx) => {
                              const hourLabel = new Date(now.getTime() - (23 - idx) * 60 * 60 * 1000)
                                .getHours()
                                .toString()
                                .padStart(2, "0") + "h";
                              const barPx = val > 0
                                ? Math.max(Math.round((val / maxVal) * (CHART_HEIGHT - 18)), 6)
                                : 2;
                              return (
                                <div
                                  key={idx}
                                  className="flex-1 flex flex-col items-center justify-end group relative"
                                  style={{ height: "100%" }}
                                >
                                  {/* Tooltip */}
                                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                                    {val} event{val !== 1 ? "s" : ""} at {hourLabel}
                                  </div>
                                  {/* Bar */}
                                  <div
                                    className={`w-full rounded-t-sm transition-all duration-500 ${
                                      val === 0
                                        ? "bg-slate-100"
                                        : "bg-[#3ecf8e]/80 group-hover:bg-[#3ecf8e]"
                                    }`}
                                    style={{ height: `${barPx}px` }}
                                  />
                                  {/* Hour label */}
                                  <span className="text-[7px] text-slate-400 mt-0.5 leading-none hidden md:block">{hourLabel}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                      {(usageData?.hourlyCounts ?? []).every(v => v === 0) && (
                        <p className="text-[10px] text-slate-400 text-center mt-2">
                          No system events in the past 24 hours. Click "Mock Server Crash" to generate one.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}



            {/* ORGANIZATION SETTINGS TAB */}
            {activeTab === "settings" && (
              <div className="space-y-6">
                
                {/* 1. Dynamic Model Selection Panel */}
                <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                  <div>
                    <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-700">Dynamic Gemini Model Config</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Select the target AI model dynamically for parsing intents and diagnosing crash dumps.</p>
                  </div>

                  {/* Dropdown Input with Filter */}
                  <div className="space-y-3">
                    <div className="flex gap-2 items-center">
                      <select
                        value={selectedModel}
                        onChange={(e) => handleModelChange(e.target.value)}
                        className="flex-1 border border-[#e5e7eb] rounded bg-white text-xs h-9 px-3 text-[#374151] font-semibold focus-visible:outline-none focus:border-[#3ecf8e]"
                      >
                        {AVAILABLE_MODELS.map((modelName) => (
                          <option key={modelName} value={modelName}>
                            {modelName}
                          </option>
                        ))}
                      </select>

                      <Button
                        onClick={() => handleModelChange(DEFAULT_MODEL)}
                        variant="outline"
                        className="border-[#e5e7eb] text-xs h-9 font-semibold text-slate-700"
                      >
                        Reset Default
                      </Button>
                    </div>

                    {/* Filter and Quick list */}
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Search Models List</label>
                      <Input
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search all Gemini / Antigravity models..."
                        className="bg-white border-[#e5e7eb] text-xs h-8 rounded text-black"
                      />

                      {/* Scrollable list of models for quick selection */}
                      <div className="border border-slate-100 rounded-md overflow-hidden bg-slate-50">
                        <ScrollArea className="h-40">
                          <div className="p-2 space-y-1">
                            {filteredModels.map((m) => (
                              <div
                                key={m}
                                onClick={() => handleModelChange(m)}
                                className={`text-[11px] px-2.5 py-1.5 rounded cursor-pointer transition-colors flex items-center justify-between font-mono ${
                                  selectedModel === m
                                    ? "bg-emerald-50 text-emerald-800 font-bold border border-emerald-100"
                                    : "text-slate-600 hover:bg-slate-100"
                                }`}
                              >
                                <span>{m}</span>
                                {selectedModel === m && <span className="text-[10px] text-emerald-600">{"\u2713"} Active</span>}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Live GitHub Repositories Panel */}
                <div className="shiny-card bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider text-slate-700">GitHub Repositories</h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Live repos from your GitHub PAT. Select one as the active agent context.
                        {githubRepos.length > 0 && (
                          <span className="ml-2 text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 rounded">{githubRepos.length} repos found</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={fetchGitHubRepos}
                      disabled={githubReposLoading}
                      className="text-[11px] text-[#3ecf8e] font-bold hover:underline disabled:opacity-50"
                    >
                      {githubReposLoading ? "Fetching..." : "\u21BB Refresh"}
                    </button>
                  </div>

                  {/* Search */}
                  {githubRepos.length > 0 && (
                    <Input
                      value={githubRepoSearch}
                      onChange={(e) => setGithubRepoSearch(e.target.value)}
                      placeholder="Search repositories..."
                      className="bg-white border-[#e5e7eb] text-xs h-8 rounded text-black"
                    />
                  )}

                  {/* Repo list */}
                  {githubReposLoading && githubRepos.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 py-6 justify-center">
                      <div className="h-4 w-4 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin" />
                      Fetching repositories from GitHub API...
                    </div>
                  ) : githubRepos.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4 text-center">
                      No repositories found. Check that GITHUB_PAT is set in .env.local
                    </p>
                  ) : (
                    <div className="border border-slate-100 rounded-md overflow-hidden bg-slate-50">
                      <ScrollArea className="h-64">
                        <div className="p-2 space-y-1">
                          {githubRepos
                            .filter(r =>
                              r.full_name.toLowerCase().includes(githubRepoSearch.toLowerCase()) ||
                              (r.description || "").toLowerCase().includes(githubRepoSearch.toLowerCase())
                            )
                            .map((repo) => {
                              const matchedProject = projects.find(p => p.github_repo_url === repo.html_url);
                              const isAdded = !!matchedProject;
                              const isActive = matchedProject ? (selectedProjectId === matchedProject.project_id) : false;
                              return (
                                <div
                                  key={repo.id}
                                  onClick={() => {
                                    if (matchedProject) {
                                      handleSelectProject(matchedProject);
                                    }
                                  }}
                                  className={`px-3 py-2.5 rounded transition-colors flex items-start justify-between gap-3 ${
                                    isActive
                                      ? "bg-emerald-50 border border-emerald-100"
                                      : isAdded
                                        ? "hover:bg-slate-100 border border-transparent bg-slate-50/50"
                                        : "hover:bg-slate-100 border border-dashed border-slate-200"
                                  } ${isAdded ? "cursor-pointer" : "cursor-default"}`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] shrink-0" />}
                                      <span className={`text-[11px] font-mono font-bold truncate ${
                                        isActive ? "text-emerald-800" : "text-slate-800"
                                      }`}>
                                        {repo.full_name}
                                      </span>
                                      {repo.private && (
                                        <span className="text-[9px] bg-slate-200 text-slate-600 px-1 rounded font-semibold shrink-0">Private</span>
                                      )}
                                      {matchedProject && (
                                        <span className={`text-[9px] font-bold border px-1.5 py-0.2 rounded uppercase shrink-0 ${
                                          matchedProject.status === "completed"
                                            ? "bg-blue-50 text-blue-700 border-blue-200"
                                            : matchedProject.status === "paused"
                                              ? "bg-amber-50 text-amber-800 border-amber-200"
                                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                        }`}>
                                          {matchedProject.status || "active"}
                                        </span>
                                      )}
                                    </div>
                                    {repo.description && (
                                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{repo.description}</p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-400">
                                      {repo.language && <span>{repo.language}</span>}
                                      <span>{"\u2605"} {repo.stars}</span>
                                      <span>{"\u2146"} {repo.forks}</span>
                                      {repo.open_issues > 0 && (
                                        <span className="text-amber-500">{"\u25CF"} {repo.open_issues} open issues</span>
                                      )}
                                      <span>Pushed {new Date(repo.pushed_at).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center gap-1">
                                      {isAdded ? (
                                        <>
                                          {!isActive && (
                                            <button
                                              onClick={() => handleSelectProject(matchedProject)}
                                              className="text-[9px] font-bold bg-[#3ecf8e] text-white hover:bg-[#32af76] px-1.5 py-0.5 rounded transition-colors"
                                            >
                                              Select
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleMarkProjectCompleted(matchedProject.project_id, matchedProject.status !== "completed")}
                                            className={`text-[9px] font-bold border px-1.5 py-0.5 rounded transition-colors ${
                                              matchedProject.status === "completed"
                                                ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                                                : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
                                            }`}
                                          >
                                            {matchedProject.status === "completed" ? "Reactivate" : "Complete"}
                                          </button>
                                          <button
                                            onClick={() => handleDeselectGithubRepoProject(repo.html_url, repo.name)}
                                            className="text-[9px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded transition-colors"
                                          >
                                            Deselect
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          onClick={() => handleSelectGithubRepoAsProject(repo)}
                                          className="text-[9px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded transition-colors"
                                        >
                                          + Add Project
                                        </button>
                                      )}
                                    </div>
                                    <a
                                      href={repo.html_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[9px] text-slate-400 hover:text-[#3ecf8e] hover:underline"
                                    >
                                      Open â†—
                                    </a>
                                  </div>
                                </div>
                              );
                            })
                          }
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>


              </div>
            )}

          </main>

          {/* ========================================================================= */}
          {/* 4. FOOTER: SUPABASE STATUS BAR                                            */}
          {/* ========================================================================= */}
          <footer className="h-9 border-t border-[#e5e7eb] bg-white flex items-center justify-between px-6 text-[10px] text-[#6b7280] shrink-0">
            <div className="flex items-center gap-2">
              <span>AEL SRE Agent v1.5.0</span>
              <span className="h-1 w-1 rounded-full bg-slate-300 inline-block shrink-0" />
              <span className="font-mono bg-slate-100 text-slate-600 px-1 rounded">Active Model: {selectedModel.replace("models/", "")}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
              <span>Telemetry: Streaming</span>
            </div>
          </footer>

        </div>
      </div>

      {/* ========================================================================= */}
      {/* 5. NEW PROJECT MODAL DIALOG (MODERN REACT OVERLAY)                        */}
      {/* ========================================================================= */}
      {isNewProjectOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#e5e7eb] rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-950 text-xs uppercase tracking-wider">Register New Workspace Project</h3>
              <button 
                onClick={() => setIsNewProjectOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 flex items-center justify-center"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Select GitHub Repository</label>
                {githubReposLoading ? (
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 h-9 px-3 border border-[#e5e7eb] rounded bg-slate-50 font-medium">
                    <div className="h-3.5 w-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    Loading your repositories...
                  </div>
                ) : githubRepos.length === 0 ? (
                  <div className="text-[10px] text-amber-600 border border-amber-100 rounded bg-amber-50/50 p-2.5 leading-relaxed font-semibold">
                    No repositories found. Ensure your GITHUB_PAT token in the environment settings is valid.
                  </div>
                ) : (
                  <select
                    onChange={(e) => {
                      const repo = githubRepos.find(r => r.html_url === e.target.value);
                      if (repo) {
                        setNewProjName(repo.name);
                        setNewProjRepo(repo.html_url);
                      }
                    }}
                    value={newProjRepo}
                    className="w-full border border-[#e5e7eb] rounded bg-white text-xs h-9 px-2.5 text-black font-semibold focus-visible:outline-none focus:border-[#3ecf8e] focus:ring-1 focus:ring-[#3ecf8e]"
                  >
                    <option value="">-- Select repository to auto-fill --</option>
                    {githubRepos.map((repo) => (
                      <option key={repo.id} value={repo.html_url}>
                        {repo.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Project Name</label>
                <Input
                  required
                  placeholder="e.g. website, core-api, backend-db"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">GitHub Repository URL</label>
                <Input
                  required
                  placeholder="e.g. https://github.com/org/repo"
                  value={newProjRepo}
                  onChange={(e) => setNewProjRepo(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Jira Project Key (Optional)</label>
                <Input
                  placeholder="e.g. PROJ"
                  value={newProjJiraKey}
                  onChange={(e) => setNewProjJiraKey(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold uppercase"
                />
                <p className="text-[9px] text-slate-400">Maps incident alerts and tasks to this specific Jira project board.</p>
              </div>

              <div className="flex gap-2 pt-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsNewProjectOpen(false)}
                  className="border-[#e5e7eb] text-xs h-9 font-semibold text-slate-700 bg-white hover:bg-slate-50"
                  disabled={isCreatingProject}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-9 font-bold px-4"
                  disabled={isCreatingProject}
                >
                  {isCreatingProject ? "Creating..." : "Register Project"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. NEW TEAM MEMBER MODAL DIALOG                                           */}
      {/* ========================================================================= */}
      {isNewTeamOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-[#e5e7eb] rounded-lg shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-950 text-xs uppercase tracking-wider">Register New Team Member</h3>
              <button 
                onClick={() => setIsNewTeamOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 flex items-center justify-center"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCreateTeamSubmit} className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Full Name</label>
                <Input
                  required
                  placeholder="e.g. John Doe"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Email Address</label>
                <Input
                  required
                  type="email"
                  placeholder="e.g. john.doe@company.com"
                  value={newTeamEmail}
                  onChange={(e) => setNewTeamEmail(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">GitHub Username</label>
                <Input
                  placeholder="e.g. johndoe-dev"
                  value={newTeamGithub}
                  onChange={(e) => setNewTeamGithub(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Role / Title</label>
                <Input
                  placeholder="e.g. Senior SRE, Backend Developer"
                  value={newTeamRole}
                  onChange={(e) => setNewTeamRole(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black font-semibold"
                />
              </div>

              <div className="flex gap-2 pt-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsNewTeamOpen(false)}
                  className="border-[#e5e7eb] text-xs h-9 font-semibold text-slate-700 bg-white hover:bg-slate-50"
                  disabled={isCreatingTeam}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-9 font-bold px-4"
                  disabled={isCreatingTeam}
                >
                  {isCreatingTeam ? "Creating..." : "Add Member"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

