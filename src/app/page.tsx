"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth, GithubAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut } from "../lib/firebase";
import type { User } from "firebase/auth";
import Header from "../components/Header";

const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:8000";
    }
    if (window.location.hostname.endsWith("micro-grandmaison.com")) {
      return "https://api.micro-grandmaison.com";
    }
    if (window.location.hostname.endsWith("run.app")) {
      return window.location.origin.replace("-web-", "-api-");
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
};
const API_BASE_URL = getApiBaseUrl();

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string | null;
  status: string;
  has_update: boolean;
  is_demo?: boolean;
  user_id?: string | null;
  copyrights_description?: string | null;
  created_at: string | null;
  repositories?: { id: string; url: string }[];
}

interface RepositoryInput {
  url: string;
  webhook_enabled: boolean;
  watch_branch: string;
  has_webhook_access?: boolean | null;
  checking_access?: boolean;
}


interface WebhookDelivery {
  id: string;
  repository_url: string | null;
  project_id: string;
  branch: string;
  commit_sha: string | null;
  received_at: string | null;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function repoDisplayName(url: string | null): string {
  if (!url) return "Unknown";
  try {
    const parts = url.replace(/\.git$/, "").split("/");
    return parts.slice(-2).join("/");
  } catch {
    return url;
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Main Component Helper ───────────────────────────────────────────────────

const ImagePlaceholder = ({ label, icon, className = "" }: { label: string; icon: React.ReactNode; className?: string }) => (
  <div className={`w-full aspect-[4/3] rounded-2xl border border-slate-850 bg-slate-900/30 relative overflow-hidden flex flex-col items-center justify-center gap-3 group hover:border-blue-500/50 transition-all duration-300 shadow-inner ${className}`}>
    {/* Subtle grid pattern background */}
    <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-10" />
    {/* Inner glow */}
    <div className="absolute inset-0 bg-gradient-to-t from-blue-950/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

    <div className="p-4 rounded-full bg-slate-950/50 border border-slate-800/80 text-slate-500 group-hover:text-blue-400 group-hover:border-blue-500/30 transition-all duration-300 shadow-md">
      {icon}
    </div>
    <span className="text-xs font-semibold text-slate-450 group-hover:text-slate-300 transition-colors uppercase tracking-wider text-center px-4">{label}</span>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [repositories, setRepositories] = useState<RepositoryInput[]>([
    { url: "", webhook_enabled: false, watch_branch: "", has_webhook_access: null, checking_access: false },
  ]);

  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);

  // Admin authentication state
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [copyrightsDescription, setCopyrightsDescription] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [activeAnalyses, setActiveAnalyses] = useState<{ id: string, name: string, status: string, current_phase: string | null }[]>([]);
  const [refreshProjectsTrigger, setRefreshProjectsTrigger] = useState(0);
  const [projectNotifications, setProjectNotifications] = useState<{ id: string, projectId: string, name: string, status: string, timestamp: string }[]>([]);

  // Project deletion state
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // News feed state
  const [newsFeedOpen, setNewsFeedOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [dashboardTab, setDashboardTab] = useState<"create" | "projects" | "samples">("create");
  const checkTimers = useRef<{ [key: number]: ReturnType<typeof setTimeout> }>({});
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Trigger initial access checks for pre-filled repositories
  useEffect(() => {
    if (user) {
      repositories.forEach((repo, idx) => {
        if (repo.url.trim() && repo.has_webhook_access === null) {
          triggerAccessCheck(idx, repo.url);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);


  // ─── Auth & init ─────────────────────────────────────────────────────────

  const syncUserWithBackend = async (firebaseUser: User, token: string) => {
    try {
      const githubUsername = (firebaseUser as any).reloadUserInfo?.screenName || "";
      const res = await fetch(`${API_BASE_URL}/api/users/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ github_username: githubUsername })
      });
      if (res.ok) {
        const data = await res.json();
        setIsAdmin(data.is_admin);
      }
    } catch (err) {
      console.error("Failed to sync user with backend", err);
    }
  };

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        if (!u.isAnonymous) {
          const token = await u.getIdToken();
          localStorage.setItem("firebase_token", token);
          localStorage.removeItem("guest_mode");
          await syncUserWithBackend(u, token);
        } else {
          localStorage.setItem("firebase_token", "guest");
          setIsAdmin(false);
        }
      } else {
        if (localStorage.getItem("guest_mode") === "true") {
          setUser({ isAnonymous: true, uid: "mock-guest" } as any);
          localStorage.setItem("firebase_token", "guest");
          setIsAdmin(false);
        } else {
          setUser(null);
          localStorage.setItem("firebase_token", "guest");
          setIsAdmin(false);
        }
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const instId = params.get("installation_id");
      if (instId) {
        setInstallationId(instId);
        localStorage.setItem("github_installation_id", instId);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const cached = localStorage.getItem("github_installation_id");
        if (cached) setInstallationId(cached);
      }
    }
  }, []);

  useEffect(() => {
    if (user && !user.isAnonymous && installationId) {
      const currentUser = user;
      async function saveInstallation() {
        try {
          const token = await currentUser.getIdToken();
          await fetch(`${API_BASE_URL}/api/github-app/save-installation`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ installation_id: installationId }),
          });
        } catch (err) { console.error("Failed to save github app installation", err); }
      }
      saveInstallation();
    }
  }, [user, installationId]);

  useEffect(() => {
    if (user && !user.isAnonymous) {
      const currentUser = user;
      async function fetchInstallUrl() {
        try {
          const token = await currentUser.getIdToken();
          const res = await fetch(`${API_BASE_URL}/api/github-app/install-url`, {
            headers: { "Authorization": `Bearer ${token}` },
          });
          if (res.ok) { const data = await res.json(); setInstallUrl(data.install_url); }
        } catch (err) { console.error("Failed to fetch GitHub App install url", err); }
      }
      fetchInstallUrl();
    }
  }, [user]);

  // Fetch project list
  useEffect(() => {
    if (!user) { setProjects([]); return; }
    const currentUser = user;
    async function fetchProjects() {
      try {
        const token = currentUser && auth && !currentUser.isAnonymous ? await currentUser.getIdToken() : "guest";
        const res = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (res.ok) { const data = await res.json(); setProjects(data || []); }
      } catch (err) { console.error("Failed to fetch projects history", err); }
    }
    fetchProjects();
  }, [user, refreshProjectsTrigger]);

  // Load active analyses and project notifications from localStorage when user changes
  useEffect(() => {
    if (!user) {
      setActiveAnalyses([]);
      setProjectNotifications([]);
      return;
    }
    const saved = localStorage.getItem(`active_analyses_${user.uid}`);
    if (saved) {
      try {
        setActiveAnalyses(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse active analyses", e);
        setActiveAnalyses([]);
      }
    } else {
      setActiveAnalyses([]);
    }
    const savedNotifications = localStorage.getItem(`project_notifications_${user.uid}`);
    if (savedNotifications) {
      try {
        setProjectNotifications(JSON.parse(savedNotifications));
      } catch (e) {
        console.error("Failed to parse project notifications", e);
        setProjectNotifications([]);
      }
    } else {
      setProjectNotifications([]);
    }
  }, [user]);

  // Sync active analyses to localStorage on change
  useEffect(() => {
    if (user) {
      localStorage.setItem(`active_analyses_${user.uid}`, JSON.stringify(activeAnalyses));
    }
  }, [activeAnalyses, user]);

  // Sync project notifications to localStorage on change
  useEffect(() => {
    if (user) {
      localStorage.setItem(`project_notifications_${user.uid}`, JSON.stringify(projectNotifications));
    }
  }, [projectNotifications, user]);

  // Poll active analyses statuses
  useEffect(() => {
    if (activeAnalyses.length === 0) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      const updated = await Promise.all(activeAnalyses.map(async (analysis) => {
        if (analysis.status !== "pending" && analysis.status !== "analyzing") {
          return analysis;
        }
        try {
          const res = await fetch(`${API_BASE_URL}/api/projects/${analysis.id}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status !== analysis.status) {
              setRefreshProjectsTrigger(prev => prev + 1);
              if (data.status === "ready" || data.status === "error") {
                const newNotification = {
                  id: `${analysis.id}-${Date.now()}`,
                  projectId: analysis.id,
                  name: analysis.name || data.name,
                  status: data.status,
                  timestamp: new Date().toISOString()
                };
                setProjectNotifications(prev => [newNotification, ...prev]);
              }
            }
            return {
              id: analysis.id,
              name: analysis.name || data.name,
              status: data.status,
              current_phase: data.current_phase || null
            };
          }
        } catch (e) {
          console.error("Polling active analysis error", e);
        }
        return analysis;
      }));

      if (isMounted) {
        setActiveAnalyses(updated);
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeAnalyses, user, projectNotifications]);

  const handleCancelAnalysis = async (projectId: string) => {
    try {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/cancel`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        setActiveAnalyses(prev => prev.map(a => a.id === projectId ? { ...a, status: "cancelled", current_phase: "Cancelled by user" } : a));
        setRefreshProjectsTrigger(prev => prev + 1);
      } else {
        alert("Failed to cancel: " + (await res.text()));
      }
    } catch (e: any) {
      alert("Error cancelling: " + e.message);
    }
  };

  const handleDismissAnalysis = (projectId: string) => {
    setActiveAnalyses(prev => prev.filter(a => a.id !== projectId));
  };

  const handleRemoveProjectNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjectNotifications(prev => prev.filter(n => n.id !== id));
  };

  // ─── News Feed polling ──────────────────────────────────────────────────

  const fetchDeliveries = async () => {
    if (!user || user.isAnonymous) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/webhook-deliveries`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) { const data = await res.json(); setDeliveries(data || []); }
    } catch (err) { console.error("Failed to fetch webhook deliveries", err); }
  };

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    fetchDeliveries();
    pollTimerRef.current = setInterval(fetchDeliveries, 30000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ─── Auth handlers ───────────────────────────────────────────────────────

  const handleGitHubLogin = async () => {
    if (!auth) { setError("Firebase is not configured. Please set environment variables."); return; }
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) { setError("GitHub Login failed: " + err.message); }
  };

  const handleGuestLogin = async () => {
    setUser({ isAnonymous: true, uid: "mock-guest" } as any);
    localStorage.setItem("firebase_token", "guest");
    localStorage.setItem("guest_mode", "true");
    setIsAdmin(false);
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    }
    setUser(null);
    localStorage.setItem("firebase_token", "guest");
    localStorage.removeItem("guest_mode");
  };

  // ─── Repository input handlers ───────────────────────────────────────────

  const triggerAccessCheck = (idx: number, val: string) => {
    const cleanUrl = val.trim().replace(/\.git$/, "");
    const githubUrlRegex = /^(https:\/\/github\.com\/|git@github\.com:)[^\/]+\/[^\/]+$/;

    if (!githubUrlRegex.test(cleanUrl)) {
      setRepositories(prev => {
        if (prev[idx]) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], has_webhook_access: false, checking_access: false };
          return updated;
        }
        return prev;
      });
      return;
    }

    setRepositories(prev => {
      if (prev[idx]) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], checking_access: true };
        return updated;
      }
      return prev;
    });

    if (checkTimers.current[idx]) {
      clearTimeout(checkTimers.current[idx]);
    }

    checkTimers.current[idx] = setTimeout(async () => {
      try {
        const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
        const payload: any = { url: val.trim() };
        if (installationId) {
          payload.installation_id = installationId;
        }

        const res = await fetch(`${API_BASE_URL}/api/github-app/check-access`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          setRepositories(prev => {
            if (prev[idx] && prev[idx].url === val) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                has_webhook_access: data.has_access,
                checking_access: false
              };
              return updated;
            }
            return prev;
          });
        } else {
          setRepositories(prev => {
            if (prev[idx] && prev[idx].url === val) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], has_webhook_access: false, checking_access: false };
              return updated;
            }
            return prev;
          });
        }
      } catch (err) {
        console.error("Failed to check repository access", err);
        setRepositories(prev => {
          if (prev[idx] && prev[idx].url === val) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], has_webhook_access: false, checking_access: false };
            return updated;
          }
          return prev;
        });
      }
    }, 600);
  };

  const handleUrlChange = (idx: number, val: string) => {
    const next = [...repositories];
    next[idx] = {
      ...next[idx],
      url: val,
      webhook_enabled: false,
      watch_branch: "",
      has_webhook_access: null,
      checking_access: false
    };
    setRepositories(next);
    triggerAccessCheck(idx, val);
  };

  const handleWebhookToggle = (idx: number, checked: boolean) => {
    const next = [...repositories];
    next[idx] = { ...next[idx], webhook_enabled: checked, watch_branch: checked ? next[idx].watch_branch : "" };
    setRepositories(next);
  };

  const handleBranchChange = (idx: number, val: string) => {
    const next = [...repositories];
    next[idx] = { ...next[idx], watch_branch: val };
    setRepositories(next);
  };

  const handleAddUrl = () => {
    setRepositories([...repositories, { url: "", webhook_enabled: false, watch_branch: "", has_webhook_access: null, checking_access: false }]);
  };

  const handleRemoveUrl = (idx: number) => {
    if (checkTimers.current[idx]) {
      clearTimeout(checkTimers.current[idx]);
    }
    setRepositories(repositories.filter((_, i) => i !== idx));
  };


  // ─── Generate handler ────────────────────────────────────────────────────

  const handleVerifyPassword = async () => {
    setModalError(null);
    try {
      const passwordHash = await sha256(adminPassword);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const digest = await sha256(passwordHash + timestamp);

      const res = await fetch(`${API_BASE_URL}/api/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest, timestamp })
      });

      if (!res.ok) {
        throw new Error("Invalid password or verification failed");
      }

      const data = await res.json();
      setAdminToken(data.token);
      setShowPasswordModal(false);
      setAdminPassword("");

      await startAnalysisWithParams(data.token);
    } catch (err: any) {
      setModalError(err.message || "Verification failed");
    }
  };

  const startAnalysisWithParams = async (tokenForAdmin: string | null) => {
    const filteredRepos = repositories.filter(r => r.url.trim());
    setLoading(true);
    setError(null);
    try {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      const headers: any = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      };
      if (isDemo && tokenForAdmin) {
        headers["X-Admin-Session-Token"] = tokenForAdmin;
      }

      const res = await fetch(`${API_BASE_URL}/api/projects/analyze`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          repositories: filteredRepos.map(r => ({
            url: r.url.trim(),
            webhook_enabled: r.webhook_enabled,
            watch_branch: r.webhook_enabled ? r.watch_branch.trim() : null,
          })),
          project_name: projectName.trim() || null,
          github_installation_id: installationId || null,
          is_demo: isDemo,
          copyrights_description: isDemo ? copyrightsDescription : null,
        }),
      });
      if (!res.ok) { throw new Error(await res.text()); }
      const data = await res.json();
      const projectId = data.project_id;

      // Add to active analyses list for background tracking
      const finalName = projectName.trim() || `World (${projectId.substring(0, 8)})`;
      setActiveAnalyses(prev => [
        ...prev,
        { id: projectId, name: finalName, status: "pending", current_phase: "Waiting in queue..." }
      ]);

      // Reset form fields immediately so they can create another project
      setProjectName("");
      setRepositories([
        { url: "", webhook_enabled: false, watch_branch: "", has_webhook_access: null, checking_access: false },
      ]);
      setRefreshProjectsTrigger(prev => prev + 1);
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!projectName.trim()) {
      setError("Please enter a Project Name.");
      return;
    }
    const filteredRepos = repositories.filter(r => r.url.trim());
    if (filteredRepos.length === 0) { setError("Please enter at least one repository URL."); return; }

    // Validate webhook settings
    for (const r of filteredRepos) {
      if (r.webhook_enabled && !r.watch_branch.trim()) {
        setError(`Please enter a branch name for update notifications on: ${r.url}`);
        return;
      }
    }

    if (isDemo && !adminToken) {
      setShowPasswordModal(true);
      return;
    }

    await startAnalysisWithParams(adminToken);
  };

  const handleDeleteClick = (project: Project) => {
    setProjectToDelete(project);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    try {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectToDelete.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }

      setProjects(prev => prev.filter(p => p.id !== projectToDelete.id));
      setShowDeleteModal(false);
      setProjectToDelete(null);
    } catch (err: any) {
      alert("Failed to delete project: " + err.message);
    }
  };

  // ─── Auth screen ─────────────────────────────────────────────────────────

  if (authLoading) {
    return <main className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</main>;
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative overflow-x-hidden">
        {/* Decorative background glow */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] aspect-square rounded-full bg-blue-900/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] aspect-square rounded-full bg-indigo-900/10 blur-[120px] pointer-events-none" />

        {/* Landing Header */}
        <header className="w-full h-20 border-b border-slate-900/80 px-8 flex justify-between items-center z-10 bg-slate-950/60 backdrop-blur-md sticky top-0">
          <span className="text-[25px] font-extrabold tracking-tight text-white">
            Micro Grand Maison
          </span>
        </header>

        {/* Hero Section */}
        <section className="max-w-6xl w-full mx-auto px-6 pt-16 pb-20 grid grid-cols-1 md:grid-cols-12 gap-12 items-center z-10">
          <div className="md:col-span-7 flex flex-col items-start text-left space-y-6">
            <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight tracking-tight">
              Visualize Microservices <br />
              as a <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Living Ecosystem</span>
            </h1>
            <p className="text-slate-400 text-base sm:text-lg leading-relaxed max-w-xl">
              Micro Grand Maisonは、マイクロサービスアーキテクチャを構成する一つ一つのサービスを親近感のあるキャラクターアバターに変換し、アーキテクチャ全体を反映したヴァーチャル空間を創出します。
            </p>

            {/* Login Box inside Hero */}
            <div className="bg-slate-900/50 p-8 rounded-2xl border border-slate-800/80 backdrop-blur-sm max-w-[528px] w-full shadow-xl flex flex-col gap-5 mt-4">
              <button
                onClick={handleGitHubLogin}
                className="w-full bg-white hover:bg-slate-100 text-slate-950 font-bold py-4 px-6 rounded-xl transition-all flex justify-center items-center gap-3 shadow-md text-lg active:scale-[0.98]"
              >
                <img src="/icons8-github-48.png" alt="GitHub" className="w-[26px] h-[26px] object-contain" />
                Sign in with GitHub
              </button>

              <div className="relative flex items-center justify-center py-2">
                <div className="w-full border-t border-slate-800/80"></div>
                <span className="absolute bg-slate-900 px-4 text-xs uppercase font-bold text-slate-500 tracking-widest">Or</span>
              </div>

              <button
                onClick={handleGuestLogin}
                className="w-full bg-blue-955/30 hover:bg-blue-950/50 text-blue-400 font-bold py-4 px-6 rounded-xl border border-blue-900/30 hover:border-blue-800/50 transition-all shadow-sm text-lg active:scale-[0.98]"
              >
                Try Demo as Guest
              </button>

              {error && (
                <p className="text-red-400 text-sm text-center font-semibold bg-red-955/20 border border-red-900/30 p-2.5 rounded-lg mt-2">
                  {error}
                </p>
              )}
            </div>
          </div>

          <div className="md:col-span-5 w-full">
            <img
              src="/web_avatar.png"
              alt="Micro Grand Maison Web Character"
              className="w-full max-h-[380px] object-contain mx-auto transform hover:scale-[1.03] transition-all duration-300 filter drop-shadow-[0_16px_32px_rgba(0,0,0,0.4)]"
            />
          </div>
        </section>

        {/* Feature Section 1: Diagram (Text next to Image 2) */}
        <section className="border-t border-slate-900 py-20 bg-slate-900/20 relative z-10">
          <div className="max-w-6xl w-full mx-auto px-6 grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
            {/* Left side: Image 2 */}
            <div className="md:col-span-6 order-last md:order-first">
              <img
                src="/diagram.png"
                alt="2D Component Diagram Overview"
                className="w-full rounded-2xl border border-slate-800/80 shadow-2xl object-cover bg-slate-900 aspect-[4/3] transform hover:scale-[1.02] transition-transform duration-300"
              />
            </div>
            {/* Right side: Text 1 */}
            <div className="md:col-span-6 flex flex-col justify-center space-y-4">
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                2D Component Mapping
              </h2>
              <p className="text-slate-350 text-base sm:text-lg leading-relaxed font-medium">
                マイクロサービスのリポジトリURLを入力するだけで、構成コンポーネントが『動物たちが働くレストランの個性豊かなスタッフ』へと変身し、2Dダイアグラム上に描き出されます。<br />ホールやキッチンでの役割分担を模したビジュアルにより、コンポーネント同士の関係性とそれぞれの役割を直感的に理解することができます。<br /><br /> Githubへのpushを検知してダイアグラムを更新でき、日々進化するアーキテクチャを反映させることが可能です。
              </p>
            </div>
          </div>
        </section>

        {/* Feature Section 2: Chat (Text next to Image 3) */}
        <section className="border-t border-slate-900 py-20 z-10 relative">
          <div className="max-w-6xl w-full mx-auto px-6 grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
            {/* Left side: Text 2 */}
            <div className="md:col-span-6 flex flex-col justify-center space-y-4">
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                Interactive Avatar Conversations
              </h2>
              <p className="text-slate-355 text-base sm:text-lg leading-relaxed font-medium">
                キャラクターとのチャットでの対話を通してアーキテクチャの仕組みを学ぶことができ、複雑化の進むマイクロサービスアーキテクチャを理解するための全く新しい体験を提供します。
              </p>
            </div>
            {/* Right side: Image 3 */}
            <div className="md:col-span-6 w-full">
              <img
                src="/chat.png"
                alt="Interactive Avatar Conversations Chat Interface"
                className="w-full rounded-2xl border border-slate-800/80 shadow-2xl h-auto object-contain transform scale-[1.2] translate-x-[10%] hover:scale-[1.22] transition-transform duration-300 origin-center"
              />
            </div>
          </div>
        </section>
      </main>
    );
  }

  const githubUsername = user ? (user as any).reloadUserInfo?.screenName : null;
  const displayLabel = user
    ? user.isAnonymous ? "Guest User"
      : githubUsername ? `${githubUsername}`
        : (user.displayName || user.email || "GitHub User")
    : "";

  // ─── Main dashboard ──────────────────────────────────────────────────────

  const demoProjects = projects
    .filter(p => p.is_demo)
    .sort((a, b) => {
      const nameA = (a.name || "").toLowerCase().trim();
      const nameB = (b.name || "").toLowerCase().trim();
      const isMGM_A = nameA === "micro-grand-maison" || nameA === "micro grand maison";
      const isMGM_B = nameB === "micro-grand-maison" || nameB === "micro grand maison";

      if (isMGM_A && !isMGM_B) return -1;
      if (!isMGM_A && isMGM_B) return 1;

      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateA - dateB;
    });
  const personalProjects = projects.filter(p => !p.is_demo || p.user_id === user?.uid);

  const allNotifications = [
    ...projectNotifications.map(n => ({
      id: n.id,
      projectId: n.projectId,
      type: "project",
      title: n.name,
      status: n.status,
      message: n.status === "ready" ? "Project analysis completed successfully!" : "Project analysis failed.",
      timestamp: n.timestamp
    })),
    ...deliveries.map(d => ({
      id: d.id,
      projectId: undefined,
      type: "git",
      title: repoDisplayName(d.repository_url),
      status: "git",
      message: `New push to ${d.branch}${d.commit_sha ? ` (${d.commit_sha.substring(0, 7)})` : ""}`,
      timestamp: d.received_at || new Date().toISOString()
    }))
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col w-full">
      <Header activeTab={dashboardTab} onTabChange={setDashboardTab} />
      <main className="flex-1 flex flex-col items-center justify-center p-6 relative">

        {/* ── Active Analyses Progress Banner ── */}
        {activeAnalyses.length > 0 && (
          <div className="w-full max-w-lg mb-4 space-y-2 z-40">
            {activeAnalyses.map((analysis) => {
              const isTerminal = analysis.status === "ready" || analysis.status === "error" || analysis.status === "cancelled";
              const statusBg = analysis.status === "ready" ? "bg-green-950/30 border-green-900/50 text-green-300" :
                analysis.status === "error" ? "bg-red-955/30 border-red-900/50 text-red-300" :
                  analysis.status === "cancelled" ? "bg-slate-800/80 border-slate-700 text-slate-400" :
                    "bg-blue-955/30 border-blue-900/50 text-blue-300";

              return (
                <div key={analysis.id} className={`p-4 rounded-xl border flex flex-col gap-2 shadow-md transition-all ${statusBg}`}>
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {analysis.name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                        {(!isTerminal) && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                        )}
                        <span>Status: <strong className="capitalize text-slate-200">{analysis.status}</strong></span>
                        {analysis.current_phase && (
                          <span className="text-slate-500">| {analysis.current_phase}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* View project button if ready */}
                      {analysis.status === "ready" && (
                        <button
                          onClick={() => {
                            handleDismissAnalysis(analysis.id);
                            router.push(`/project/${analysis.id}`);
                          }}
                          className="text-xs bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                        >
                          View World
                        </button>
                      )}
                      {/* Cancel button if pending or analyzing */}
                      {(analysis.status === "pending" || analysis.status === "analyzing") && (
                        <button
                          onClick={() => handleCancelAnalysis(analysis.id)}
                          className="text-xs bg-red-950/40 hover:bg-red-955/60 text-red-400 border border-red-900/50 font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                      {/* Close/Dismiss button if terminal */}
                      {isTerminal && (
                        <button
                          onClick={() => handleDismissAnalysis(analysis.id)}
                          className="text-slate-500 hover:text-slate-300 font-bold px-2 py-1 text-sm"
                          title="Dismiss"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Progress bar simulation for active state */}
                  {!isTerminal && (
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mt-1">
                      <div className="bg-blue-500 h-full animate-pulse" style={{ width: '100%' }}></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Main card ── */}
        <div className="bg-slate-900 p-8 rounded-xl shadow-2xl max-w-2xl w-full mt-10 border border-slate-800">
          <h1 className="text-2xl font-bold mb-2 text-center text-white">Micro Grand Maison</h1>
          <p className="text-slate-400 text-center mb-6 text-sm">
            Visualize your microservices as a living ecosystem.
          </p>

          {/* Tab Contents: Create Project */}
          {dashboardTab === "create" && (
            <div className="h-[480px] overflow-y-auto pr-1 flex flex-col justify-between">
              {user?.isAnonymous ? (
                <div className="p-5 rounded-xl border border-blue-900/50 bg-blue-950/20 text-center text-sm text-blue-300 my-auto">
                  <p className="font-semibold mb-1 text-white">Guest Mode Active</p>
                  <p className="text-xs text-blue-400 leading-relaxed">
                    You are signed in as a guest. Project creation is disabled. Please sign in via GitHub to analyze your own repositories.
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    {/* GitHub App connection */}
                    {user && !user.isAnonymous && (
                      <div className="mb-5 p-4 rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                        <div>
                          {installationId ? (
                            <div className="flex items-center gap-1.5 text-green-400 font-semibold">
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                              GitHub App Connected (ID: {installationId})
                            </div>
                          ) : (
                            <div className="text-slate-400">
                              {installUrl ? "Connect GitHub App to analyze private repositories." : "GitHub App is not configured. Set GITHUB_APP_INSTALL_URL in backend env."}
                            </div>
                          )}
                        </div>
                        {installUrl ? (
                          <a href={installUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center justify-center bg-white hover:bg-slate-100 text-slate-950 font-semibold px-3 py-1.5 rounded-md transition-all self-start sm:self-auto shadow-sm">
                            {installationId ? "Reconnect" : "Connect GitHub App"}
                          </a>
                        ) : (
                          <button disabled className="inline-flex items-center justify-center bg-slate-800 text-slate-500 font-medium px-3 py-1.5 rounded-md cursor-not-allowed self-start sm:self-auto"
                            title="GitHub App is not configured on the API server.">
                            Connect GitHub App
                          </button>
                        )}
                      </div>
                    )}

                    {/* Project name */}
                    <div className="mb-5">
                      <label className="block text-sm font-medium text-slate-300 mb-2">Project Name</label>
                      <input type="text"
                        className="w-full border border-slate-800 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-950 text-white placeholder-slate-500"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="My Microservices Project"
                      />
                    </div>

                    {/* Repository URLs with webhook settings */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-slate-300 mb-2">Repository URLs</label>
                      {repositories.map((repo, idx) => (
                        <div key={idx} className="mb-4 border border-slate-800 rounded-lg p-3 bg-slate-950/30">
                          {/* URL row */}
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              className="flex-grow border border-slate-800 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-950 text-white placeholder-slate-500"
                              value={repo.url}
                              onChange={(e) => handleUrlChange(idx, e.target.value)}
                              placeholder="https://github.com/owner/repo.git"
                            />
                            {repositories.length > 1 && (
                              <button type="button" onClick={() => handleRemoveUrl(idx)}
                                className="text-red-400 hover:text-red-300 font-bold p-2 transition-colors">✕</button>
                            )}
                          </div>

                          {/* Checking indicator */}
                          {repo.checking_access && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-400">
                              <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></span>
                              Checking webhook access...
                            </div>
                          )}

                          {/* Webhook toggle */}
                          {repo.has_webhook_access && !repo.checking_access && (
                            <div className="mt-2.5 flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`webhook-enabled-${idx}`}
                                checked={repo.webhook_enabled}
                                onChange={(e) => handleWebhookToggle(idx, e.target.checked)}
                                className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                              />
                              <label htmlFor={`webhook-enabled-${idx}`} className="text-xs text-slate-400 cursor-pointer select-none">
                                Receive update notifications on push
                              </label>
                            </div>
                          )}

                          {/* Branch input */}
                          <div
                            className={`overflow-hidden transition-all duration-200 ${repo.webhook_enabled ? "max-h-16 opacity-100 mt-2" : "max-h-0 opacity-0"}`}
                          >
                            <input
                              type="text"
                              className="w-full border border-slate-800 rounded-md p-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-slate-950 text-white placeholder-slate-650"
                              value={repo.watch_branch}
                              onChange={(e) => handleBranchChange(idx, e.target.value)}
                              placeholder="Branch to monitor (e.g. main)"
                              disabled={!repo.webhook_enabled}
                            />
                          </div>
                        </div>
                      ))}
                      <button type="button" onClick={handleAddUrl}
                        className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-1 mt-1">
                        + Add Repository
                      </button>
                    </div>

                    {/* Demo project checkbox (Admin only) */}
                    {isAdmin && (
                      <>
                        <div className="mb-5 p-3 rounded-lg border border-blue-900/40 bg-blue-950/20 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="is-demo-checkbox"
                            checked={isDemo}
                            onChange={(e) => setIsDemo(e.target.checked)}
                            className="w-4 h-4 accent-blue-600 cursor-pointer"
                          />
                          <label htmlFor="is-demo-checkbox" className="text-sm text-blue-300 font-medium cursor-pointer select-none">
                            Register as Demo Project (Public Layout Template)
                          </label>
                        </div>
                        {isDemo && (
                          <div className="mb-5">
                            <label className="block text-sm font-medium text-slate-300 mb-2">Copyrights / License Description</label>
                            <textarea
                              rows={3}
                              className="w-full border border-slate-800 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-slate-950 text-white placeholder-slate-500"
                              placeholder="e.g. Copyright 2016 Eventuate, Inc. Licensed under Apache 2.0"
                              value={copyrightsDescription}
                              onChange={(e) => setCopyrightsDescription(e.target.value)}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="mt-auto pt-4">
                    {/* Generate button */}
                    <button onClick={handleGenerate} disabled={loading}
                      className={`w-full py-3 rounded-md font-medium text-white transition-colors ${loading ? "bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}>
                      {loading ? "Processing..." : "Generate World"}
                    </button>

                    {status && loading && (
                      <div className="mt-4 text-sm text-blue-400 text-center flex flex-col items-center animate-pulse">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                        {status}
                      </div>
                    )}

                    {error && (
                      <div className="mt-4 p-3 bg-red-955/30 border border-red-900/50 text-red-400 text-sm rounded-md break-words">{error}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab Contents: Projects */}
          {dashboardTab === "projects" && (
            <div className="h-[480px] overflow-y-auto pr-1 flex flex-col">
              {user?.isAnonymous ? (
                <div className="p-5 rounded-xl border border-blue-900/50 bg-blue-950/20 text-center text-sm text-blue-300 my-auto">
                  <p className="font-semibold mb-1 text-white">GitHub Account Required</p>
                  <p className="text-xs text-blue-400 leading-relaxed">
                    Please sign in via GitHub to save, view, and analyze your personal projects.
                  </p>
                </div>
              ) : personalProjects.length === 0 ? (
                <div className="p-5 rounded-xl border border-slate-800 bg-slate-950/30 text-center text-sm text-slate-400 my-auto">
                  No personal projects found. Start by creating a project under the "Create Project" tab.
                </div>
              ) : (
                <div className="space-y-2 flex-1">
                  {personalProjects.map((proj) => (
                    <div key={proj.id}
                      onClick={() => {
                        if (proj.status === "ready") {
                          router.push(`/project/${proj.id}`);
                        }
                      }}
                      className={`flex justify-between items-center p-3 rounded-lg border border-slate-800 transition-all ${proj.status === "ready"
                        ? "hover:border-blue-500 hover:bg-blue-955/20 cursor-pointer"
                        : "cursor-default opacity-85"
                        }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {proj.name || `World (${proj.id.substring(0, 8)})`}
                          </span>
                          {proj.has_update && (
                            <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-955/30 text-emerald-400 border border-emerald-900/50">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              New Update
                            </span>
                          )}
                        </div>
                        {proj.repositories && proj.repositories.length > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {proj.repositories.map((repo) => (
                              <a
                                key={repo.id}
                                href={repo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[90%] font-mono"
                              >
                                {repo.url}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-slate-500 mt-1">
                          {proj.created_at ? new Date(proj.created_at).toLocaleDateString() : ""}
                        </div>
                      </div>
                      <div className="flex items-center">
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ml-2 ${proj.status === "ready" ? "bg-green-955/30 text-green-400 border border-green-900/50" :
                          proj.status === "analyzing" ? "bg-blue-955/30 text-blue-400 border border-blue-900/50 animate-pulse" :
                            proj.status === "pending" ? "bg-amber-955/30 text-amber-400 border border-amber-900/50 animate-pulse" :
                              proj.status === "cancelled" ? "bg-slate-800 text-slate-400 border border-slate-700" :
                                "bg-red-955/30 text-red-400 border border-red-900/50"
                          }`}>
                          {proj.status}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(proj);
                          }}
                          className="text-slate-500 hover:text-red-400 p-1.5 rounded-md transition-colors ml-2 flex-shrink-0 hover:bg-slate-800"
                          title="Delete Project"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab Contents: Samples */}
          {dashboardTab === "samples" && (
            <div className="h-[480px] overflow-y-auto pr-1 flex flex-col">
              {demoProjects.length === 0 ? (
                <div className="p-5 rounded-xl border border-slate-800 bg-slate-950/30 text-center text-sm text-slate-400 my-auto">
                  No sample projects available.
                </div>
              ) : (
                <div className="space-y-2 flex-1">
                  {demoProjects.map((proj) => (
                    <div key={proj.id}
                      onClick={() => {
                        if (proj.status === "ready") {
                          router.push(`/project/${proj.id}`);
                        }
                      }}
                      className={`flex justify-between items-center p-3 rounded-lg border border-slate-800 transition-all ${proj.status === "ready"
                        ? "hover:border-blue-500 hover:bg-blue-955/20 cursor-pointer"
                        : "cursor-default opacity-85"
                        }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200 truncate">
                            {proj.name || `World (${proj.id.substring(0, 8)})`}
                          </span>
                        </div>
                        {proj.repositories && proj.repositories.length > 0 && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {proj.repositories.map((repo) => (
                              <a
                                key={repo.id}
                                href={repo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-blue-400 hover:text-blue-300 hover:underline truncate max-w-[90%] font-mono"
                              >
                                {repo.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center">
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ml-2 ${proj.status === "ready" ? "bg-green-955/30 text-green-400 border border-green-900/50" :
                          proj.status === "analyzing" ? "bg-blue-955/30 text-blue-400 border border-blue-900/50 animate-pulse" :
                            proj.status === "pending" ? "bg-amber-955/30 text-amber-400 border border-amber-900/50 animate-pulse" :
                              proj.status === "cancelled" ? "bg-slate-800 text-slate-400 border border-slate-700" :
                                "bg-red-955/30 text-red-400 border border-red-900/50"
                          }`}>
                          {proj.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Premium Glassmorphism Password Modal */}
        {showPasswordModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300">
            <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl max-w-sm w-full p-6 mx-4 relative animate-in fade-in zoom-in-95 duration-200">
              <h3 className="text-lg font-bold text-white mb-2">Admin Authentication</h3>
              <p className="text-xs text-slate-400 mb-4">
                You are registering a Demo Project (Layout Template). Please enter the admin password to authorize this action.
              </p>

              <input
                type="password"
                className="w-full border border-slate-800 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none mb-4 bg-slate-950 text-white placeholder-slate-650"
                placeholder="Enter admin password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleVerifyPassword();
                }}
                autoFocus
              />

              {modalError && (
                <p className="text-xs text-red-400 mb-4 bg-red-955/30 p-2 rounded-md border border-red-900/50">{modalError}</p>
              )}

              <div className="flex justify-end gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setAdminPassword("");
                    setModalError(null);
                  }}
                  className="px-4 py-2 border border-slate-800 text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyPassword}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
                >
                  Verify & Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Premium Glassmorphism Delete Confirmation Modal */}
        {showDeleteModal && projectToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300">
            <div className="bg-slate-900 border border-slate-800 shadow-2xl rounded-2xl max-w-sm w-full p-6 mx-4 relative animate-in fade-in zoom-in-95 duration-200">
              <h3 className="text-lg font-bold text-red-500 mb-2">Delete Project</h3>
              <p className="text-xs text-slate-400 mb-4 text-left">
                Are you sure you want to permanently delete project <strong className="text-slate-200">"{projectToDelete.name || `World (${projectToDelete.id.substring(0, 8)})`}"</strong>? This action will permanently remove all associated repositories, microservices, dependencies, GCS avatars, and chat history.
              </p>

              <div className="flex justify-end gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setProjectToDelete(null);
                  }}
                  className="px-4 py-2 border border-slate-800 text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors"
                >
                  Permanently Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
