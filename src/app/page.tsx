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
  status?: "active" | "paused";
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
  // Navigation: "landing" | "app"
  const [viewMode, setViewMode] = useState<"landing" | "app">("landing");

  // Sidebar Tab Navigation: "projects" | "chat" | "team" | "integrations" | "usage" | "billing" | "settings"
  const [activeTab, setActiveTab] = useState<"projects" | "chat" | "team" | "integrations" | "usage" | "billing" | "settings">("projects");

  // Dynamic Selected Gemini Model (Persisted)
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [modelSearch, setModelSearch] = useState("");

  // Projects list (from DB + Mock region/sizes matching screenshot)
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [searchProjectQuery, setSearchProjectQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [sortBy, setSortBy] = useState<"name" | "created">("name");
  const [viewLayout, setViewLayout] = useState<"grid" | "list">("grid");

  // Team list (from DB)
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  // Usage stats (from /api/usage — real Supabase data)
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Integration verification loading states
  const [integrationChecking, setIntegrationChecking] = useState<Record<string, boolean>>({});

  // Active project selector (for agent context — like the model selector)
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

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

  const [inputMessage, setInputMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  
  // Custom Inputs for Interruptions
  const [customEmail, setCustomEmail] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load and fetch database details on mount
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

      // Restore selected model
      const savedModel = localStorage.getItem("ael_selected_model");
      if (savedModel) setSelectedModel(savedModel);
      // Restore selected project
      const savedProject = localStorage.getItem("ael_selected_project");
      if (savedProject) setSelectedProjectId(savedProject);
      
      // Restore chat sessions
      const savedSessions = localStorage.getItem("ael_sessions");
      if (savedSessions) {
        try {
          const parsed = JSON.parse(savedSessions);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSessions(parsed);
            setThreadId(parsed[0].threadId);
            setMessages(parsed[0].messages || []);
            setInterruptionReason(parsed[0].interruptionReason || null);
            return;
          }
        } catch (e) {
          console.error("Failed to load local storage sessions", e);
        }
      }
      // Start a default session if empty
      handleStartNewChat([]);
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
          let status: "active" | "paused" = "active";

          if (p.project_name.toLowerCase().includes("pulse")) {
            region = "ap-southeast-1";
            status = "paused";
          } else if (p.project_name.toLowerCase().includes("website")) {
            region = "ap-northeast-1";
            status = "active";
          } else {
            // cycle regions
            const regions = ["us-east-1", "eu-central-1", "ap-southeast-2"];
            region = regions[idx % regions.length];
          }

          return {
            ...p,
            region,
            size,
            status
          };
        });
        setProjects(dbProjects);
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

  // Toggle active/paused state on projects
  const handleToggleProjectStatus = (projectId: string, currentStatus: "active" | "paused") => {
    const nextStatus = currentStatus === "active" ? "paused" : "active";
    setProjects(prev => prev.map(p => {
      if (p.project_id === projectId) {
        return { ...p, status: nextStatus };
      }
      return p;
    }));
    toast.success(`Project ${nextStatus === "active" ? "resumed" : "paused"} successfully.`);
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
          github_repo_url: newProjRepo.trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Project '${newProjName}' registered in Supabase!`);
        setIsNewProjectOpen(false);
        setNewProjName("");
        setNewProjRepo("");
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
  const handleStartNewChat = (currentSessions = sessions) => {
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
  };

  // Switch to selected session
  const handleSwitchSession = (id: string) => {
    const session = sessions.find((s) => s.threadId === id);
    if (session) {
      setThreadId(id);
      setMessages(session.messages || []);
      setInterruptionReason(session.interruptionReason || null);
    }
  };

  // Delete session
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sessions.filter((s) => s.threadId !== id);
    saveSessions(updated);
    if (threadId === id) {
      if (updated.length > 0) {
        setThreadId(updated[0].threadId);
        setMessages(updated[0].messages || []);
        setInterruptionReason(updated[0].interruptionReason || null);
      } else {
        handleStartNewChat(updated);
      }
    }
  };

  // Update messages, interruption, and smart title in active session
  const updateSessionData = (newMessages: ChatMessage[], newInterruption: string | null) => {
    setMessages(newMessages);
    setInterruptionReason(newInterruption);

    const updated = sessions.map((s) => {
      if (s.threadId === threadId) {
        let title = s.title;
        if (title === "New Conversation" && newMessages.length > 0) {
          const firstUser = newMessages.find((m) => m.role === "user");
          if (firstUser) {
            title = firstUser.content.substring(0, 24) + (firstUser.content.length > 24 ? "..." : "");
          }
        }
        return {
          ...s,
          title,
          messages: newMessages,
          interruptionReason: newInterruption,
        };
      }
      return s;
    });
    saveSessions(updated);
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
    updateSessionData([...messages, userMessage], null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          approvalDecision: approve ? "approve" : "reject",
          modelName: selectedModel, // Pass model dynamically
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
    updateSessionData([...messages, userMessage], null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          emailInput: email,
          modelName: selectedModel, // Pass model dynamically
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

  // Render markdown-like text as formatted HTML (no external dep)
  const renderMarkdown = (text: string): string => {
    return text
      // Bold
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      // Italic
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // Inline code
      .replace(/`(.+?)`/g, "<code class='bg-slate-100 text-slate-700 px-1 rounded font-mono text-[10px]'>$1</code>")
      // Bullet lines: lines that start with '  - ' or '- '
      .replace(/^[ ]*- (.+)$/gm, "<li class='ml-4 list-disc leading-relaxed'>$1</li>")
      // Wrap consecutive <li> in <ul>
      .replace(/(<li[^>]*>.*<\/li>\n?)+/g, (m) => `<ul class='space-y-0.5 my-1'>${m}</ul>`)
      // Newlines to <br> (not inside list items)
      .replace(/\n(?!<\/?(ul|li))/g, "<br />");
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
      <div className="min-h-screen bg-white text-slate-800 font-sans flex flex-col justify-between selection:bg-[#3ecf8e]/20 select-none">
        
        {/* Navigation */}
        <header className="h-16 border-b border-slate-100 px-6 md:px-12 flex items-center justify-between bg-white/80 backdrop-blur sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <svg className="w-6 h-6 text-[#3ecf8e] fill-current" viewBox="0 0 24 24">
              <path d="M21.36 9.8a1.05 1.05 0 00-1-1H14.1l2.5-6.83a1.05 1.05 0 00-1.85-.92L5.87 11.23a1.05 1.05 0 00.78 1.77h6.26l-2.5 6.83a1.05 1.05 0 001.85.92L21.23 11a1.05 1.05 0 00.13-1.2z" />
            </svg>
            <span className="font-bold text-slate-900 tracking-tight text-lg">Autonomous Engineering Lead (AEL)</span>
          </div>
          <Button 
            onClick={() => setViewMode("app")}
            className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-semibold text-xs px-4 py-2 rounded-md shadow-sm transition-all"
          >
            Launch Console
          </Button>
        </header>

        {/* Hero Section */}
        <main className="flex-1 flex flex-col justify-center items-center px-6 md:px-12 py-16 text-center max-w-5xl mx-auto space-y-12">
          
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Say hello to the first <br/>
              <span className="bg-gradient-to-r from-emerald-600 to-[#3ecf8e] bg-clip-text text-transparent">
                Autonomous Site Reliability Agent
              </span>
            </h1>
            <p className="text-base md:text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
              AEL monitors your Supabase backend telemetry logs, semantic audits git commits to pinpoint code regressions, coordinates daily standup remediations, and manages live stakeholder coordination loops.
            </p>
          </div>

          {/* Quick Stats Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-4xl bg-slate-50 p-6 rounded-2xl border border-slate-100">
            <div>
              <p className="text-2xl font-bold text-slate-900">100%</p>
              <p className="text-xs text-slate-500 mt-1">Autonomous Triaging</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">&lt; 30s</p>
              <p className="text-xs text-slate-500 mt-1">Average Response Time</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">4 / 4</p>
              <p className="text-xs text-slate-500 mt-1">Subsystems Connected</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">Active</p>
              <p className="text-xs text-slate-500 mt-1">Calendar & Git API Sync</p>
            </div>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-left mt-8">
            <div className="p-6 border border-slate-100 bg-white rounded-xl shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center font-bold">📊</div>
              <h3 className="font-bold text-slate-900 text-sm">Sprint Daily Standup Remediation</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Scan sprint backlogs for overdue critical items. AEL contacts authors, schedules remediation checkins, and alerts organization leads instantly.
              </p>
            </div>

            <div className="p-6 border border-slate-100 bg-white rounded-xl shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center font-bold">🔍</div>
              <h3 className="font-bold text-slate-900 text-sm">Semantic Stack Trace Audit</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                When a system crash gets logged to Supabase, AEL compares stack traces against latest Git commits to find the exact line causing issues.
              </p>
            </div>

            <div className="p-6 border border-slate-100 bg-white rounded-xl shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center font-bold">⚡</div>
              <h3 className="font-bold text-slate-900 text-sm">Human-in-the-Loop Guardrails</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Execution pauses safely at critical thresholds. Intercepts trigger override approvals, registry additions for unmapped developers, and workload assignments.
              </p>
            </div>

            <div className="p-6 border border-slate-100 bg-white rounded-xl shadow-sm hover:shadow-md transition-all space-y-3">
              <div className="w-10 h-10 bg-red-50 text-red-600 rounded-lg flex items-center justify-center font-bold">📅</div>
              <h3 className="font-bold text-slate-900 text-sm">Google Calendar / Meet Integration</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Automatically books Google Meet invites, syncs calendars between teams, and populates meeting details with automated remediation tickets.
              </p>
            </div>
          </div>

          <div className="pt-6">
            <Button 
              onClick={() => setViewMode("app")}
              className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-sm px-8 py-3 rounded-lg shadow-lg hover:shadow-emerald-100 transition-all flex items-center gap-2"
            >
              Launch Workspace Dashboard
              <span className="text-lg">→</span>
            </Button>
          </div>

        </main>

        {/* Footer */}
        <footer className="h-16 border-t border-slate-100 px-6 md:px-12 flex items-center justify-between text-xs text-slate-400 bg-slate-55 bg-[#fcfcfc]">
          <span>Autonomous Engineering Lead Agent Project</span>
          <span>© 2026. All Rights Reserved.</span>
        </footer>

      </div>
    );
  }

  // =========================================================================
  // RENDERING WORKSPACE APPLICATION
  // =========================================================================
  return (
    <div className="light select-none">
      <div className="flex h-screen bg-[#fcfcfc] text-[#1c1c1c] font-sans antialiased overflow-hidden">
        
        {/* ========================================================================= */}
        {/* 1. LEFT SIDEBAR: SUPABASE LOGO & TAB NAVIGATION                           */}
        {/* ========================================================================= */}
        <aside className="w-60 bg-white border-r border-[#e5e7eb] flex flex-col justify-between shrink-0 z-20">
          <div>
            {/* Top Logo Panel */}
            <div className="h-14 border-b border-[#e5e7eb] flex items-center justify-between px-4">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-[#3ecf8e] fill-current" viewBox="0 0 24 24">
                  <path d="M21.36 9.8a1.05 1.05 0 00-1-1H14.1l2.5-6.83a1.05 1.05 0 00-1.85-.92L5.87 11.23a1.05 1.05 0 00.78 1.77h6.26l-2.5 6.83a1.05 1.05 0 001.85.92L21.23 11a1.05 1.05 0 00.13-1.2z" />
                </svg>
                <div>
                  <h1 className="text-xs font-bold tracking-tight text-[#111827]">z360-ael-agent</h1>
                  <p className="text-[9px] text-[#6b7280]">malikabdullah1786's Org</p>
                </div>
              </div>
              <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">FREE</span>
            </div>

            {/* Navigation Menu Items */}
            <nav className="p-3 space-y-1">
              <button
                onClick={() => setViewMode("landing")}
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
                onClick={() => setActiveTab("projects")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "projects"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Projects
              </button>

              {/* AEL Co-Pilot Tab */}
              <button
                onClick={() => setActiveTab("chat")}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "chat"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
                onClick={() => setActiveTab("team")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "team"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Team
              </button>

              {/* Integrations Tab */}
              <button
                onClick={() => setActiveTab("integrations")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "integrations"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                </svg>
                Integrations
              </button>

              {/* Usage Tab */}
              <button
                onClick={() => setActiveTab("usage")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "usage"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                </svg>
                Usage
              </button>



              {/* Settings Tab */}
              <button
                onClick={() => setActiveTab("settings")}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                  activeTab === "settings"
                    ? "bg-[#f3f4f6] text-[#111827] font-bold"
                    : "text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]"
                }`}
              >
                <svg className="w-4 h-4 text-[#8c8c8c]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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
        <div className="flex-1 flex flex-col min-w-0 bg-[#fcfcfc] relative">

          {/* Incident Alert Bar (Matches screenshot style) */}
          <div className="bg-[#fff7ed] border-b border-[#ffedd5] px-6 py-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs text-[#c2410c] font-medium">
              <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>We are investigating a technical issue with SRE Calendar Webhooks. Follow the status page for updates.</span>
            </div>
            <button 
              onClick={() => toast.info("Status page is operational.")}
              className="text-[10px] text-[#c2410c] hover:underline font-bold"
            >
              Status Page
            </button>
          </div>
          
          {/* Top Header Bar */}
          <header className="h-14 border-b border-[#e5e7eb] flex items-center justify-between px-6 bg-white shrink-0">
            {/* Breadcrumb path */}
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="text-[#6b7280]">z360-ael-agent</span>
              <span className="text-[#d1d5db]">/</span>
              <span className="text-[#111827] font-semibold capitalize">
                {activeTab === "projects" ? "Projects Dashboard" : activeTab === "chat" ? "AEL Co-Pilot Chat" : activeTab}
              </span>
            </div>

            {/* Right Header actions */}
            <div className="flex items-center gap-3">
              {/* Database Pulse Dot */}
              <div className="flex items-center gap-1.5 bg-[#f9fafb] border border-[#e5e7eb] rounded px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e] animate-pulse" />
                Supabase Connection Active
              </div>

              <div className="h-4 w-[1px] bg-[#e5e7eb]" />

              <Button
                onClick={handleMockServerCrash}
                disabled={inserting}
                className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-[11px] font-bold h-8 px-3 rounded shadow-sm transition-all"
              >
                {inserting ? "Syncing..." : "Mock Server Crash"}
              </Button>

              <Button
                onClick={() => {
                  toast.info("Injecting client UI exception trace...");
                  setTimeout(() => setShouldCrash(true), 500);
                }}
                variant="destructive"
                className="bg-red-50 hover:bg-red-100 text-red-650 border border-red-200 text-[11px] font-bold h-8 px-3 rounded shadow-sm transition-all text-red-600"
              >
                Mock UI Crash
              </Button>
            </div>
          </header>

          {/* ========================================================================= */}
          {/* 3. CORE WORKSPACE: PROJECTS, CHAT, TEAM, SETTINGS, ETC                    */}
          {/* ========================================================================= */}
          <main className="flex-1 overflow-hidden p-6 relative bg-[#f9fafb]">
            
            {/* PROJECTS TAB */}
            {activeTab === "projects" && (
              <div className="h-full flex flex-col space-y-6 overflow-y-auto pr-1">
                
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
                      onClick={() => setIsNewProjectOpen(true)}
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
                        {filteredProjects.map((p) => (
                          <div 
                            key={p.project_id}
                            className={`bg-white border rounded-lg p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between h-40 ${
                              p.status === "paused" ? "border-amber-250 bg-amber-50/10 border-amber-200" : "border-[#e5e7eb]"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`p-2.5 rounded-lg shrink-0 ${p.status === "paused" ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                  </svg>
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-bold text-slate-900 text-sm truncate">{p.project_name}</h3>
                                  <p className="text-[10px] text-[#6b7280] font-mono mt-0.5 truncate">{p.region} | {p.size}</p>
                                </div>
                              </div>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border capitalize ${
                                p.status === "active" 
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-250 border-emerald-250" 
                                  : "bg-amber-50 text-amber-800 border-amber-250"
                              }`}>
                                {p.status}
                              </span>
                            </div>

                            <div className="mt-4">
                              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Repository</p>
                              <p className="text-xs text-slate-600 font-mono truncate mt-0.5" title={p.github_repo_url}>
                                {p.github_repo_url}
                              </p>
                            </div>

                            <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-[#e5e7eb]">
                              <span className="text-[9px] text-[#8c8c8c] font-mono">
                                Created: {new Date(p.created_at || "").toLocaleDateString()}
                              </span>
                              <button
                                onClick={() => handleToggleProjectStatus(p.project_id, p.status || "active")}
                                className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${
                                  p.status === "active" 
                                    ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-250" 
                                    : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-250"
                                }`}
                              >
                                {p.status === "active" ? "Pause Project" : "Resume"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bg-white border border-[#e5e7eb] rounded-lg shadow-sm overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-[#e5e7eb]">
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Project Name</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Region</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Instance</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Repository URL</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Status</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredProjects.map((p) => (
                              <TableRow key={p.project_id} className="border-[#e5e7eb] hover:bg-slate-50">
                                <TableCell className="font-bold text-xs text-slate-900">{p.project_name}</TableCell>
                                <TableCell className="font-mono text-[10px] text-slate-500">{p.region}</TableCell>
                                <TableCell className="font-mono text-[10px] text-slate-500">{p.size}</TableCell>
                                <TableCell className="font-mono text-xs text-slate-600">{p.github_repo_url}</TableCell>
                                <TableCell>
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border capitalize ${
                                    p.status === "active" 
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                      : "bg-amber-50 text-amber-800 border-amber-200"
                                  }`}>
                                    {p.status}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right">
                                  <button
                                    onClick={() => handleToggleProjectStatus(p.project_id, p.status || "active")}
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                      p.status === "active" 
                                        ? "bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-250" 
                                        : "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-250"
                                    }`}
                                  >
                                    {p.status === "active" ? "Pause" : "Resume"}
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Free Plan Usage Dashboard Panel */}
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-5">
                    <div>
                      <h3 className="font-bold text-slate-900 text-xs">Free Plan Usage</h3>
                      <p className="text-[10px] text-[#6b7280] mt-0.5">Current billing cycle</p>
                    </div>

                    <div className="space-y-4">
                      {/* Egress */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-semibold">
                          <span className="text-slate-700">EGRESS</span>
                          <span className="text-slate-500">47 MB / 5 GB</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="bg-[#3ecf8e] h-full rounded-full" style={{ width: "1%" }} />
                        </div>
                      </div>

                      {/* Database Size */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-semibold">
                          <span className="text-slate-700">DATABASE SIZE</span>
                          <span className="text-slate-500">30 MB / 500 MB</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="bg-[#3ecf8e] h-full rounded-full" style={{ width: "6%" }} />
                        </div>
                      </div>

                      {/* Monthly Active Users */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-semibold">
                          <span className="text-slate-700">MONTHLY ACTIVE USERS</span>
                          <span className="text-slate-500">10 / 50,000</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="bg-[#3ecf8e] h-full rounded-full" style={{ width: "0.1%" }} />
                        </div>
                      </div>

                      {/* File Storage */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[10px] font-semibold">
                          <span className="text-slate-700">FILE STORAGE</span>
                          <span className="text-slate-500">0 GB / 1 GB</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="bg-[#3ecf8e] h-full rounded-full" style={{ width: "0%" }} />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-[#e5e7eb] pt-4">
                      <Button
                        onClick={() => toast.info("Redirecting to upgrade checkout...")}
                        className="w-full bg-[#3ecf8e] hover:bg-[#34b27b] text-white font-bold text-xs h-8 rounded shadow-sm"
                      >
                        Upgrade to Pro
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Database Diagnostics Table (Real-time telemetry log panel integrated) */}
                <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden flex flex-col shadow-sm">
                  <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between">
                    <div>
                      <h2 className="text-xs font-bold text-[#111827]">Supabase Diagnostics Table</h2>
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

                  <div className="min-h-[250px] bg-white">
                    <ScrollArea className="h-[320px]">
                      {logsLoading && logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[200px] text-[#6b7280] text-xs">
                          <div className="h-5 w-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-3" />
                          Streaming Supabase database tables...
                        </div>
                      ) : logs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[200px] text-center px-4">
                          <p className="text-[#6b7280] text-xs font-semibold">No Telemetry Events Recorded</p>
                          <p className="text-[#8c8c8c] text-[10px] max-w-xs mt-1">
                            Use the seed scripts or click "Mock Server Crash" in the header to register logs.
                          </p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader className="bg-[#f9fafb] sticky top-0 backdrop-blur-md z-10 border-b border-[#e5e7eb]">
                            <TableRow className="border-[#e5e7eb]">
                              <TableHead className="text-[11px] font-bold text-[#6b7280] w-[180px]">Timestamp</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280] w-[200px]">Project Name</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280] w-[90px]">Severity</TableHead>
                              <TableHead className="text-[11px] font-bold text-[#6b7280]">Error Context Trace</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {logs.map((log) => (
                              <TableRow key={log.event_id} className="border-[#e5e7eb] hover:bg-[#f9fafb] transition-colors">
                                <TableCell className="text-[10px] font-mono text-[#6b7280]">
                                  {new Date(log.timestamp).toLocaleString()}
                                </TableCell>
                                <TableCell className="font-bold text-xs text-[#111827]">
                                  {log.active_projects?.project_name || "Unknown Project"}
                                </TableCell>
                                <TableCell>
                                  {getSeverityBadge(log.error_trace)}
                                </TableCell>
                                <TableCell>
                                  <pre className="text-[10px] text-[#374151] font-mono bg-[#f9fafb] p-2.5 border border-[#e5e7eb] rounded overflow-x-auto whitespace-pre-wrap leading-relaxed max-w-[620px]">
                                    {log.error_trace}
                                  </pre>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </ScrollArea>
                  </div>
                </div>
                
              </div>
            )}

            {/* CO-PILOT CHAT CONSOLE TAB */}
            {activeTab === "chat" && (
              <div className="h-full flex gap-4 overflow-hidden min-w-0">
                
                {/* Chat Session History Left Column (Gemini Style) */}
                <div className="w-56 bg-white border border-[#e5e7eb] rounded-lg flex flex-col overflow-hidden shrink-0 shadow-sm">
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
                  <div className="flex-1 min-h-0 py-2">
                    <ScrollArea className="h-full">
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
                <div className="flex-1 bg-white border border-[#e5e7eb] rounded-lg overflow-hidden flex flex-col shadow-sm">
                  
                  {/* Panel Header */}
                  <div className="p-4 border-b border-[#e5e7eb] flex items-center justify-between bg-[#f9fafb]">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#3ecf8e] animate-pulse" />
                      <h2 className="text-xs font-bold text-[#111827]">
                        Console Stream: <span className="font-mono text-[#6b7280]">{threadId}</span>
                      </h2>
                    </div>
                    {/* Selected Model display badge */}
                    <span className="text-[10px] font-semibold bg-[#e8fbf2] text-[#047857] px-2 py-0.5 rounded border border-[#a7f3d0]">
                      Using: {selectedModel.replace("models/", "")}
                    </span>
                  </div>

                  {/* Messages Stream */}
                  <div className="flex-1 min-h-0 bg-[#fcfcfc] p-4">
                    <ScrollArea className="h-full">
                      <div className="space-y-4">
                        {messages.length === 0 ? (
                          <div className="flex flex-col items-center justify-center text-center h-[260px] text-[#6b7280] px-6">
                            <div className="h-8 w-8 rounded-full border border-[#e5e7eb] flex items-center justify-center text-[#3ecf8e] mb-3 font-mono text-xs">
                              &gt;_
                            </div>
                            <p className="text-xs font-bold text-[#111827]">Terminal Active</p>
                            <p className="text-[10px] text-[#6b7280] max-w-[320px] mt-1 leading-relaxed">
                              Ask AEL to schedule a status update, daily standup, or investigate the latest backend database crash.
                            </p>
                          </div>
                        ) : (
                          messages.map((m, idx) => (
                            <div
                              key={idx}
                              className={`flex flex-col ${
                                m.role === "user" ? "items-end" : "items-start"
                              }`}
                            >
                              <span className="text-[9px] text-[#6b7280] font-semibold mb-0.5">
                                {m.role === "user" ? "Developer Override" : "Autonomous Lead"}
                              </span>
                              <div
                                className={`rounded-lg px-3.5 py-2.5 text-xs max-w-[85%] leading-relaxed ${
                                  m.role === "user"
                                    ? "bg-white text-[#111827] border border-[#e5e7eb] shadow-sm"
                                    : "bg-[#f9fafb] text-[#374151] border border-[#e5e7eb]"
                                }`}
                              >
                                {m.role === "assistant" ? (
                                  <div
                                    className="prose-sm"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                                  />
                                ) : (
                                  <span>{m.content}</span>
                                )}
                              </div>
                            </div>
                          ))
                        )}

                        {/* Interruption overrides */}
                        {interruptionReason && (
                          <div className="border bg-amber-50/50 border-amber-200 rounded-md p-4 space-y-3 mt-3">
                            <div className="flex items-center gap-1.5 text-[10px] text-amber-700 font-bold uppercase tracking-wider">
                              <span>⚡</span> Interrupt Intercepted (HIL Action)
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
                                    className="bg-[#3ecf8e] hover:bg-[#34b27b] text-white text-xs h-8 flex-1 font-bold rounded shadow-sm"
                                    disabled={sendingMessage}
                                  >
                                    ✓ Yes, Schedule All Syncs
                                  </Button>
                                  <Button
                                    onClick={() => triggerAgentMessage("no")}
                                    variant="outline"
                                    className="border-[#e5e7eb] hover:bg-[#f9fafb] text-red-600 text-xs h-8 flex-1 rounded bg-white"
                                    disabled={sendingMessage}
                                  >
                                    ✕ Skip / Dismiss
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
                    <div className="px-4 py-2 border-t border-[#e5e7eb] bg-[#f9fafb] flex flex-wrap gap-2">
                      <button
                        onClick={() => triggerAgentMessage("Give me a status update on the team")}
                        className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm"
                        disabled={sendingMessage}
                      >
                        📊 Sprint Daily Standup
                      </button>
                      <button
                        onClick={() => triggerAgentMessage("Investigate the latest crash")}
                        className="text-[10px] px-2.5 py-1.5 rounded-md bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] text-[#374151] font-medium transition-colors cursor-pointer shadow-sm"
                        disabled={sendingMessage}
                      >
                        🔍 Triage Latest Crash
                      </button>
                    </div>
                  )}

                  {/* Chat Input Form — always enabled; free-text resumes the agent graph */}
                  <form onSubmit={handleSendMessage} className="border-t border-[#e5e7eb] p-3 bg-white flex gap-2">
                    <Input
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder={
                        interruptionReason
                          ? "Reply to continue the workflow (or click a button above)..."
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
                  </form>
                </div>

              </div>
            )}

            {/* TEAM TAB */}
            {activeTab === "team" && (
              <div className="h-full flex flex-col space-y-5 bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">Corporate Team Directory</h2>
                    <p className="text-xs text-slate-500 mt-0.5">Click <strong>Assign to Project</strong> on any member to link them to an active project via the agent.</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {teamLoading ? (
                    <div className="flex flex-col items-center justify-center h-48 text-xs text-slate-400">
                      <div className="h-5 w-5 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-2" />
                      Loading team members...
                    </div>
                  ) : team.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-10">No team members registered. Please run migrations/seed scripts.</p>
                  ) : (
                    <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
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
                                  {/* Assign to Project via chat */}
                                  <button
                                    onClick={() => {
                                      const repoName = localStorage.getItem("ael_selected_repo_name") || "[select a project in Settings]";
                                      setActiveTab("chat");
                                      setTimeout(() => {
                                        const prompt = `Assign ${member.name} (${member.email_address}) to the project ${repoName}`;
                                        triggerAgentMessage(prompt);
                                      }, 200);
                                    }}
                                    className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-semibold transition-colors"
                                  >
                                    + Assign to Project
                                  </button>
                                  {/* Schedule sync via chat */}
                                  <button
                                    onClick={() => {
                                      setActiveTab("chat");
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
              <div className="h-full overflow-y-auto space-y-6">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">Third-Party Integration Modules</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Control live connectivity APIs linked to the AEL agent loop.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GitHub */}
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
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
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
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
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
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

                  {/* Slack Webhooks */}
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center font-bold text-lg">
                          S
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-slate-950">Slack Webhooks</h3>
                          <span className="text-[9px] bg-yellow-50 text-yellow-800 border border-yellow-100 px-1.5 py-0.2 rounded font-bold">Standby</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">Webhooks</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Sends automated reminders, warnings, and escalation alerts directly to team communication channels.
                    </p>
                    <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400 border-t border-[#e5e7eb]">
                       <span>Posts to SLACK_WEBHOOK_URL env var</span>
                       <button
                         onClick={() => verifyIntegration("slack")}
                         disabled={integrationChecking["slack"]}
                         className="text-[#3ecf8e] font-bold hover:underline disabled:opacity-50 disabled:cursor-wait"
                       >
                         {integrationChecking["slack"] ? "Sending..." : "Send Test Alert"}
                       </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* USAGE TAB — REAL SUPABASE DATA */}
            {activeTab === "usage" && (
              <div className="h-full overflow-y-auto space-y-5">
                {/* Header */}
                <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm flex items-start justify-between">
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
                    {usageLoading ? "Syncing..." : "↻ Refresh"}
                  </Button>
                </div>

                {usageLoading && !usageData ? (
                  <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 flex flex-col items-center text-slate-400 text-xs">
                    <div className="h-6 w-6 border-2 border-[#3ecf8e] border-t-transparent rounded-full animate-spin mb-3" />
                    Querying Supabase tables for live usage data...
                  </div>
                ) : (
                  <>
                    {/* ── Row 1: Event & Record Counts ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">System Events</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalEvents.toLocaleString() ?? "—"}
                        </p>
                        <div className="flex items-center gap-1">
                          {(usageData?.weeklyChangePercent ?? 0) >= 0 ? (
                            <span className="text-[9px] text-emerald-600 font-bold">
                              ↑ {Math.abs(usageData?.weeklyChangePercent ?? 0)}% this week
                            </span>
                          ) : (
                            <span className="text-[9px] text-red-500 font-bold">
                              ↓ {Math.abs(usageData?.weeklyChangePercent ?? 0)}% this week
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-slate-400">Total rows in system_events</p>
                      </div>

                      <div className="bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Sprint Tasks</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalTasks.toLocaleString() ?? "—"}
                        </p>
                        <p className="text-[9px] text-amber-600 font-semibold">
                          {usageData?.overdueTasks ?? 0} overdue / critical
                        </p>
                        <p className="text-[9px] text-slate-400">Total rows in sprint_tasks</p>
                      </div>

                      <div className="bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Team Members</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalMembers.toLocaleString() ?? "—"}
                        </p>
                        <p className="text-[9px] text-emerald-600 font-semibold">Registered in corporate registry</p>
                        <p className="text-[9px] text-slate-400">Total rows in team_members</p>
                      </div>

                      <div className="bg-white border border-[#e5e7eb] p-4 rounded-lg shadow-sm space-y-1">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Projects</p>
                        <p className="text-2xl font-extrabold text-slate-950">
                          {usageData?.totalProjects.toLocaleString() ?? "—"}
                        </p>
                        <p className="text-[9px] text-emerald-600 font-semibold">Linked GitHub repos</p>
                        <p className="text-[9px] text-slate-400">Total rows in active_projects</p>
                      </div>
                    </div>

                    {/* ── Row 2: Week-over-Week Comparison ── */}
                    <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm">
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

                    {/* ── Row 3: Real Hourly Event Chart ── */}
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
                        const maxVal = Math.max(...counts, 1); // avoid division by zero
                        const now = new Date();
                        return (
                          <div className="flex items-end gap-1 h-40">
                            {counts.map((val, idx) => {
                              const hourLabel = new Date(now.getTime() - (23 - idx) * 60 * 60 * 1000)
                                .getHours()
                                .toString()
                                .padStart(2, "0") + "h";
                              const heightPct = Math.max((val / maxVal) * 100, val > 0 ? 4 : 1);
                              return (
                                <div key={idx} className="flex-1 flex flex-col items-center gap-1 group relative">
                                  {/* Tooltip */}
                                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                                    {val} event{val !== 1 ? "s" : ""} at {hourLabel}
                                  </div>
                                  <div
                                    className={`w-full rounded-t-sm transition-all duration-500 ${
                                      val === 0
                                        ? "bg-slate-100"
                                        : "bg-[#3ecf8e]/80 group-hover:bg-[#3ecf8e]"
                                    }`}
                                    style={{ height: `${heightPct}%` }}
                                  />
                                  <span className="text-[7px] text-slate-400 hidden md:inline">{hourLabel}</span>
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
              <div className="h-full overflow-y-auto space-y-6">
                
                {/* 1. Dynamic Model Selection Panel */}
                <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
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
                                {selectedModel === m && <span className="text-[10px] text-emerald-600">✓ Active</span>}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Live GitHub Repositories Panel */}
                <div className="bg-white border border-[#e5e7eb] rounded-lg p-5 shadow-sm space-y-4">
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
                      {githubReposLoading ? "Fetching..." : "↻ Refresh"}
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
                              const isActive = selectedProjectId === String(repo.id);
                              return (
                                <div
                                  key={repo.id}
                                  onClick={() => {
                                    setSelectedProjectId(String(repo.id));
                                    localStorage.setItem("ael_selected_project", String(repo.id));
                                    localStorage.setItem("ael_selected_repo_url", repo.html_url);
                                    localStorage.setItem("ael_selected_repo_name", repo.full_name);
                                    toast.success(`Agent context: ${repo.full_name}`);
                                  }}
                                  className={`px-3 py-2.5 rounded cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                                    isActive
                                      ? "bg-emerald-50 border border-emerald-100"
                                      : "hover:bg-slate-100"
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] shrink-0" />}
                                      <span className={`text-[11px] font-mono font-bold truncate ${
                                        isActive ? "text-emerald-800" : "text-slate-800"
                                      }`}>
                                        {repo.full_name}
                                      </span>
                                      {repo.private && (
                                        <span className="text-[9px] bg-slate-200 text-slate-600 px-1 rounded font-semibold shrink-0">Private</span>
                                      )}
                                    </div>
                                    {repo.description && (
                                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{repo.description}</p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-[9px] text-slate-400">
                                      {repo.language && <span>{repo.language}</span>}
                                      <span>★ {repo.stars}</span>
                                      <span>⑂ {repo.forks}</span>
                                      {repo.open_issues > 0 && (
                                        <span className="text-amber-500">● {repo.open_issues} open issues</span>
                                      )}
                                      <span>Pushed {new Date(repo.pushed_at).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex flex-col items-end gap-1">
                                    {isActive && (
                                      <span className="text-[9px] text-emerald-600 font-bold">✓ Active</span>
                                    )}
                                    <a
                                      href={repo.html_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-[9px] text-slate-400 hover:text-[#3ecf8e] hover:underline"
                                    >
                                      Open ↗
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
              <span>•</span>
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
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProjectSubmit} className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Project Name</label>
                <Input
                  required
                  placeholder="e.g. website, core-api, backend-db"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">GitHub Repository URL</label>
                <Input
                  required
                  placeholder="e.g. https://github.com/org/repo"
                  value={newProjRepo}
                  onChange={(e) => setNewProjRepo(e.target.value)}
                  className="bg-white border-[#e5e7eb] text-xs h-9 rounded text-black"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">AWS Deploy Region</label>
                  <select
                    value={newProjRegion}
                    onChange={(e) => setNewProjRegion(e.target.value)}
                    className="w-full border border-[#e5e7eb] rounded bg-white text-xs h-9 px-2.5 text-[#374151] focus-visible:outline-none"
                  >
                    <option value="us-east-1">us-east-1 (N. Virginia)</option>
                    <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                    <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                    <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Instance Size</label>
                  <select
                    value={newProjSize}
                    onChange={(e) => setNewProjSize(e.target.value)}
                    className="w-full border border-[#e5e7eb] rounded bg-white text-xs h-9 px-2.5 text-[#374151] focus-visible:outline-none"
                  >
                    <option value="NANO">NANO (0.5 vCPU, 512MB RAM)</option>
                    <option value="MICRO">MICRO (1 vCPU, 1GB RAM)</option>
                    <option value="SMALL">SMALL (1 vCPU, 2GB RAM)</option>
                  </select>
                </div>
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
    </div>
  );
}
