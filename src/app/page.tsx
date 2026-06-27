"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { auth, GithubAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut } from "../lib/firebase";
import type { User } from "firebase/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string | null;
  status: string;
  has_update: boolean;
  created_at: string | null;
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
      setUser(u);
      if (u && !u.isAnonymous) {
        const token = await u.getIdToken();
        localStorage.setItem("firebase_token", token);
        await syncUserWithBackend(u, token);
      } else {
        localStorage.setItem("firebase_token", "guest");
        setIsAdmin(false);
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

  // Load active analyses and project notifications from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("active_analyses");
    if (saved) {
      try {
        setActiveAnalyses(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse active analyses", e);
      }
    }
    const savedNotifications = localStorage.getItem("project_notifications");
    if (savedNotifications) {
      try {
        setProjectNotifications(JSON.parse(savedNotifications));
      } catch (e) {
        console.error("Failed to parse project notifications", e);
      }
    }
  }, []);

  // Sync active analyses to localStorage on change
  useEffect(() => {
    localStorage.setItem("active_analyses", JSON.stringify(activeAnalyses));
  }, [activeAnalyses]);

  // Sync project notifications to localStorage on change
  useEffect(() => {
    localStorage.setItem("project_notifications", JSON.stringify(projectNotifications));
  }, [projectNotifications]);

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
    setIsAdmin(false);
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    }
    setUser(null);
    localStorage.setItem("firebase_token", "guest");
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
      <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">Architecture World</h1>
          <p className="text-gray-500 text-center mb-8 text-sm">Visualize your microservices as a living ecosystem.</p>
          <button onClick={handleGitHubLogin} className="w-full bg-gray-900 text-white font-medium py-3 rounded-md mb-4 hover:bg-gray-800 transition-colors flex justify-center items-center gap-2">
            Sign in with GitHub
          </button>
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-gray-300"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">Or</span>
            <div className="flex-grow border-t border-gray-300"></div>
          </div>
          <button onClick={handleGuestLogin} className="w-full bg-blue-50 text-blue-600 font-medium py-3 rounded-md border border-blue-200 hover:bg-blue-100 transition-colors">
            Try Demo as Guest
          </button>
          {error && <p className="mt-4 text-red-500 text-sm text-center">{error}</p>}
        </div>
      </main>
    );
  }

  const githubUsername = user ? (user as any).reloadUserInfo?.screenName : null;
  const displayLabel = user
    ? user.isAnonymous ? "Guest User"
      : githubUsername ? `GitHub: @${githubUsername}`
        : (user.displayName || user.email || "GitHub User")
    : "";

  // ─── Main dashboard ──────────────────────────────────────────────────────

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
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 relative">

      {/* ── Top-right: user info + notifications bell ── */}
      <div className="absolute top-4 right-4 flex items-center gap-3">
        {/* Notifications Button (only for logged-in non-guest) */}
        {user && !user.isAnonymous && (
          <div className="relative">
            <button
              id="news-feed-toggle"
              onClick={() => setNewsFeedOpen(v => !v)}
              className="relative p-2 rounded-full hover:bg-gray-200 transition-colors text-gray-600"
              title="Notifications"
            >
              {/* Bell icon */}
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {allNotifications.length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-white"></span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {newsFeedOpen && (
              <div className="absolute right-0 top-10 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-800">Notifications</span>
                  <button onClick={() => setNewsFeedOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg font-bold leading-none">&times;</button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                  {allNotifications.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8 px-4">
                      Notifications will appear here when events occur.
                    </p>
                  ) : (
                    allNotifications.map(n => (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (n.type === "project" && n.status === "ready") {
                            router.push(`/project/${n.projectId}`);
                            setNewsFeedOpen(false);
                          }
                        }}
                        className={`px-4 py-3 hover:bg-gray-50 transition-colors flex gap-2 items-start ${
                          n.type === "project" && n.status === "ready" ? "cursor-pointer" : ""
                        }`}
                      >
                        {/* Status Icon Indicator */}
                        <div className="mt-0.5 flex-shrink-0">
                          {n.type === "git" && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" title="Git Push"></span>
                          )}
                          {n.type === "project" && n.status === "ready" && (
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" title="Success"></span>
                          )}
                          {n.type === "project" && n.status === "error" && (
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Failed"></span>
                          )}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-700 truncate">{n.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {n.message}
                          </p>
                          <span className="text-[10px] text-gray-400 block mt-1">{timeAgo(n.timestamp)}</span>
                        </div>

                        {/* Close / Dismiss Action for Project Notifications */}
                        {n.type === "project" && (
                          <button
                            onClick={(e) => handleRemoveProjectNotification(n.id, e)}
                            className="text-gray-400 hover:text-red-500 text-xs px-1 font-bold leading-none self-center hover:bg-gray-100 rounded p-1 transition-colors"
                            title="Dismiss Notification"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <span className="text-sm text-gray-600">{displayLabel}</span>
        <button onClick={handleLogout} className="text-sm text-red-500 hover:underline">Logout</button>
      </div>

      {/* ── Active Analyses Progress Banner ── */}
      {activeAnalyses.length > 0 && (
        <div className="w-full max-w-lg mb-4 space-y-2 z-40">
          {activeAnalyses.map((analysis) => {
            const isTerminal = analysis.status === "ready" || analysis.status === "error" || analysis.status === "cancelled";
            const statusBg = analysis.status === "ready" ? "bg-green-50 border-green-200" :
              analysis.status === "error" ? "bg-red-50 border-red-200" :
                analysis.status === "cancelled" ? "bg-gray-50 border-gray-200" :
                  "bg-blue-50 border-blue-200";

            return (
              <div key={analysis.id} className={`p-4 rounded-xl border flex flex-col gap-2 shadow-sm transition-all ${statusBg}`}>
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-gray-800 truncate">
                      {analysis.name}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                      {(!isTerminal) && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                      )}
                      <span>Status: <strong className="capitalize">{analysis.status}</strong></span>
                      {analysis.current_phase && (
                        <span className="text-gray-400">| {analysis.current_phase}</span>
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
                        className="text-xs bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                    {/* Close/Dismiss button if terminal */}
                    {isTerminal && (
                      <button
                        onClick={() => handleDismissAnalysis(analysis.id)}
                        className="text-gray-400 hover:text-gray-600 font-bold px-2 py-1 text-sm"
                        title="Dismiss"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
                {/* Progress bar simulation for active state */}
                {!isTerminal && (
                  <div className="w-full bg-gray-200/60 rounded-full h-1.5 overflow-hidden mt-1">
                    <div className="bg-blue-500 h-full animate-pulse" style={{ width: '100%' }}></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Main card ── */}
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full mt-10">
        <h1 className="text-2xl font-bold mb-2 text-center text-gray-800">Architecture as a World</h1>
        <p className="text-gray-500 text-center mb-6 text-sm">
          {user?.isAnonymous
            ? "Explore microservice templates and chat with service avatars in the demo worlds below."
            : "Enter the GitHub repository clone URLs you want to analyze."}
        </p>

        {user?.isAnonymous ? (
          <div className="p-5 rounded-xl border border-blue-100 bg-blue-50/20 text-center text-sm text-blue-900 mb-6">
            <p className="font-semibold mb-1">Guest Mode Active</p>
            <p className="text-xs text-blue-700 leading-relaxed">
              You are signed in as a guest. Project creation is disabled. Please sign in via GitHub to analyze your own repositories.
            </p>
          </div>
        ) : (
          <>
            {/* GitHub App connection */}
            {user && !user.isAnonymous && (
              <div className="mb-6 p-4 rounded-xl border border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                <div>
                  {installationId ? (
                    <div className="flex items-center gap-1.5 text-green-600 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      GitHub App Connected (ID: {installationId})
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      {installUrl ? "Connect GitHub App to analyze private repositories." : "GitHub App is not configured. Set GITHUB_APP_INSTALL_URL in backend env."}
                    </div>
                  )}
                </div>
                {installUrl ? (
                  <a href={installUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white font-medium px-3 py-1.5 rounded-md transition-all self-start sm:self-auto">
                    {installationId ? "Reconnect" : "Connect GitHub App"}
                  </a>
                ) : (
                  <button disabled className="inline-flex items-center justify-center bg-gray-300 text-gray-400 font-medium px-3 py-1.5 rounded-md cursor-not-allowed self-start sm:self-auto"
                    title="GitHub App is not configured on the API server.">
                    Connect GitHub App
                  </button>
                )}
              </div>
            )}

            {/* Project name */}
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Project Name (Optional)</label>
              <input type="text"
                className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Microservices Project"
              />
            </div>

            {/* Repository URLs with webhook settings */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Repository URLs</label>
              {repositories.map((repo, idx) => (
                <div key={idx} className="mb-4 border border-gray-200 rounded-lg p-3 bg-gray-50/30">
                  {/* URL row */}
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      className="flex-grow border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                      value={repo.url}
                      onChange={(e) => handleUrlChange(idx, e.target.value)}
                      placeholder="https://github.com/owner/repo.git"
                    />
                    {repositories.length > 1 && (
                      <button type="button" onClick={() => handleRemoveUrl(idx)}
                        className="text-red-400 hover:text-red-600 font-bold p-2 transition-colors">✕</button>
                    )}
                  </div>

                  {/* Checking indicator */}
                  {repo.checking_access && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-500">
                      <span className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></span>
                      Checking webhook access...
                    </div>
                  )}

                  {/* Webhook toggle – render conditionally based on access */}
                  {repo.has_webhook_access && !repo.checking_access && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`webhook-enabled-${idx}`}
                        checked={repo.webhook_enabled}
                        onChange={(e) => handleWebhookToggle(idx, e.target.checked)}
                        className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                      />
                      <label htmlFor={`webhook-enabled-${idx}`} className="text-xs text-gray-600 cursor-pointer select-none">
                        Receive update notifications on push
                      </label>
                    </div>
                  )}

                  {/* Branch input – animates in/out */}
                  <div
                    className={`overflow-hidden transition-all duration-200 ${repo.webhook_enabled ? "max-h-16 opacity-100 mt-2" : "max-h-0 opacity-0"}`}
                  >
                    <input
                      type="text"
                      className="w-full border border-emerald-300 rounded-md p-2 text-xs focus:ring-2 focus:ring-emerald-400 focus:outline-none bg-white placeholder-gray-400"
                      value={repo.watch_branch}
                      onChange={(e) => handleBranchChange(idx, e.target.value)}
                      placeholder="Branch to monitor (e.g. main)"
                      disabled={!repo.webhook_enabled}
                    />
                  </div>
                </div>
              ))}
              <button type="button" onClick={handleAddUrl}
                className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1 mt-1">
                + Add Repository
              </button>
            </div>

            {/* Demo project checkbox (Admin only) */}
            {isAdmin && (
              <div className="mb-5 p-3 rounded-lg border border-blue-100 bg-blue-50/20 flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <input
                  type="checkbox"
                  id="is-demo-checkbox"
                  checked={isDemo}
                  onChange={(e) => setIsDemo(e.target.checked)}
                  className="w-4 h-4 accent-blue-600 cursor-pointer"
                />
                <label htmlFor="is-demo-checkbox" className="text-sm text-blue-950 font-medium cursor-pointer select-none">
                  Register as Demo Project (Public Layout Template)
                </label>
              </div>
            )}

            {/* Generate button */}
            <button onClick={handleGenerate} disabled={loading}
              className={`w-full py-3 rounded-md font-medium text-white transition-colors ${loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}>
              {loading ? "Processing..." : "Generate World"}
            </button>

            {status && loading && (
              <div className="mt-4 text-sm text-blue-600 text-center flex flex-col items-center animate-pulse">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                {status}
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-md break-words">{error}</div>
            )}
          </>
        )}

        {/* Your Past Worlds */}
        {projects.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{user?.isAnonymous ? "Demo Worlds" : "Your Past Worlds"}</h2>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {projects.map((proj) => (
                <div key={proj.id}
                  onClick={() => {
                    if (proj.status === "ready") {
                      router.push(`/project/${proj.id}`);
                    }
                  }}
                  className={`flex justify-between items-center p-3 rounded-lg border border-gray-200 transition-all ${proj.status === "ready"
                      ? "hover:border-blue-500 hover:bg-blue-50/20 cursor-pointer"
                      : "cursor-default opacity-85"
                    }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {proj.name || `World (${proj.id.substring(0, 8)})`}
                      </span>
                      {/* New Update badge */}
                      {proj.has_update && (
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          New Update
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {proj.created_at ? new Date(proj.created_at).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <div className="flex items-center">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ml-2 ${proj.status === "ready" ? "bg-green-50 text-green-700 border border-green-200" :
                        proj.status === "analyzing" ? "bg-blue-50 text-blue-700 border border-blue-200 animate-pulse" :
                          proj.status === "pending" ? "bg-amber-50 text-amber-700 border border-amber-200 animate-pulse" :
                            proj.status === "cancelled" ? "bg-gray-50 text-gray-600 border border-gray-200" :
                              "bg-red-50 text-red-700 border border-red-200"
                      }`}>
                      {proj.status}
                    </span>
                    {!user?.isAnonymous && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(proj);
                        }}
                        className="text-gray-400 hover:text-red-500 p-1.5 rounded-md transition-colors ml-2 flex-shrink-0 hover:bg-gray-100"
                        title="Delete Project"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Premium Glassmorphism Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-300">
          <div className="bg-white/95 border border-gray-150 shadow-2xl rounded-2xl max-w-sm w-full p-6 mx-4 relative animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Admin Authentication</h3>
            <p className="text-xs text-gray-500 mb-4">
              You are registering a Demo Project (Layout Template). Please enter the admin password to authorize this action.
            </p>

            <input
              type="password"
              className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none mb-4 bg-white text-gray-900"
              placeholder="Enter admin password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleVerifyPassword();
              }}
              autoFocus
            />

            {modalError && (
              <p className="text-xs text-red-500 mb-4 bg-red-50 p-2 rounded-md border border-red-100">{modalError}</p>
            )}

            <div className="flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setAdminPassword("");
                  setModalError(null);
                }}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity duration-300">
          <div className="bg-white/95 border border-red-100 shadow-2xl rounded-2xl max-w-sm w-full p-6 mx-4 relative animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-red-600 mb-2">Delete Project</h3>
            <p className="text-xs text-gray-500 mb-4 text-left">
              Are you sure you want to permanently delete project <strong className="text-gray-800">"{projectToDelete.name || `World (${projectToDelete.id.substring(0, 8)})`}"</strong>? This action will permanently remove all associated repositories, microservices, dependencies, GCS avatars, and chat history.
            </p>

            <div className="flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setProjectToDelete(null);
                }}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
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
  );
}
