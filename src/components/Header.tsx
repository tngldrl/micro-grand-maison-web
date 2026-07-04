"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { auth, onAuthStateChanged, signOut } from "../lib/firebase";
import type { User } from "firebase/auth";

const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    if (window.location.hostname.endsWith("micro-grandmaison.com")) {
      return "https://api.micro-grandmaison.com";
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
};
const API_BASE_URL = getApiBaseUrl();

interface WebhookDelivery {
  id: string;
  repository_url: string | null;
  project_id: string;
  branch: string;
  commit_sha: string | null;
  received_at: string | null;
}

function repoDisplayName(url: string | null): string {
  if (!url) return "Unknown";
  try {
    const parts = url.replace(/\.git$/, "").split("/");
    return parts.slice(-2).join("/");
  } catch {
    return url;
  }
}

function timeAgo(dateString: string | null): string {
  if (!dateString) return "";
  const now = new Date();
  const past = new Date(dateString);
  const diffMs = now.getTime() - past.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDays}d ago`;
}

interface HeaderProps {
  projectName?: string | null;
  activeTab?: "create" | "projects" | "samples";
  onTabChange?: (tab: "create" | "projects" | "samples") => void;
}

export default function Header({ projectName, activeTab, onTabChange }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [projectNotifications, setProjectNotifications] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [newsFeedOpen, setNewsFeedOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync user state
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
      } else {
        if (localStorage.getItem("guest_mode") === "true") {
          setUser({ isAnonymous: true, uid: "mock-guest" } as any);
        } else {
          setUser(null);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch project notifications from localStorage
  useEffect(() => {
    if (!user) {
      setProjectNotifications([]);
      return;
    }
    const savedNotifications = localStorage.getItem(`project_notifications_${user.uid}`);
    if (savedNotifications) {
      try {
        setProjectNotifications(JSON.parse(savedNotifications));
      } catch (e) {
        console.error("Failed to parse project notifications", e);
      }
    } else {
      setProjectNotifications([]);
    }
  }, [user]);

  // Sync project notifications to localStorage on change
  const updateNotifications = (newNotifs: any[]) => {
    setProjectNotifications(newNotifs);
    if (user) {
      localStorage.setItem(`project_notifications_${user.uid}`, JSON.stringify(newNotifs));
    }
  };

  const handleRemoveProjectNotification = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = projectNotifications.filter((n) => n.id !== id);
    updateNotifications(updated);
  };

  // Poll notifications from localStorage in case dashboard updates it
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      const savedNotifications = localStorage.getItem(`project_notifications_${user.uid}`);
      if (savedNotifications) {
        try {
          const parsed = JSON.parse(savedNotifications);
          if (parsed.length !== projectNotifications.length) {
            setProjectNotifications(parsed);
          }
        } catch (e) { }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [user, projectNotifications]);

  // Fetch git push deliveries
  const fetchDeliveries = async () => {
    if (!user || user.isAnonymous) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/webhook-deliveries`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDeliveries(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch webhook deliveries", err);
    }
  };

  useEffect(() => {
    if (!user || user.isAnonymous) return;
    fetchDeliveries();
    pollTimerRef.current = setInterval(fetchDeliveries, 30000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [user]);

  const handleLogout = async () => {
    localStorage.removeItem("guest_mode");
    localStorage.removeItem("firebase_token");
    if (auth) {
      await signOut(auth);
    }
    router.push("/");
  };

  if (!user) return null; // Only show when logged in

  const githubUsername = user ? (user as any).reloadUserInfo?.screenName : null;
  const displayLabel = user
    ? user.isAnonymous
      ? "Guest User"
      : githubUsername
        ? `${githubUsername}`
        : user.displayName || user.email || "GitHub User"
    : "";

  const allNotifications = [
    ...projectNotifications.map((n) => ({
      id: n.id,
      projectId: n.projectId,
      type: "project",
      title: n.name,
      status: n.status,
      message: n.status === "ready" ? "Project analysis completed successfully!" : "Project analysis failed.",
      timestamp: n.timestamp,
    })),
    ...deliveries.map((d) => ({
      id: d.id,
      projectId: undefined,
      type: "git",
      title: repoDisplayName(d.repository_url),
      status: "git",
      message: `New push to ${d.branch}${d.commit_sha ? ` (${d.commit_sha.substring(0, 7)})` : ""}`,
      timestamp: d.received_at || new Date().toISOString(),
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const isProjectPage = pathname.startsWith("/project/");

  return (
    <header className="w-full h-20 bg-slate-900 border-b border-slate-800 px-8 flex justify-between items-center z-30 shadow-sm relative">
      {/* Left side: Logo */}
      <div className="flex items-center gap-4">
        <Link href="/" className="text-[25px] font-bold text-white hover:opacity-90 transition-opacity">
          Micro Grand Maison
        </Link>
      </div>

      {/* Center: Navigation Tabs (Only shown on Dashboard root page when user is logged in) */}
      {pathname === "/" && onTabChange && activeTab && user && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-8 h-full">
          <button
            type="button"
            onClick={() => onTabChange("create")}
            className={`h-full px-1 text-[17px] font-semibold border-b-2 transition-all flex items-center gap-2.5 ${
              activeTab === "create"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <img 
              src="/_i_icon_14903_icon_149030_256.png" 
              alt="" 
              className="w-[25px] h-[25px] object-contain" 
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span>Create Project</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("projects")}
            className={`h-full px-1 text-[17px] font-semibold border-b-2 transition-all flex items-center gap-2.5 ${
              activeTab === "projects"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <img 
              src="/_i_icon_13536_icon_135360_256.png" 
              alt="" 
              className="w-[25px] h-[25px] object-contain" 
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span>Projects</span>
          </button>
          <button
            type="button"
            onClick={() => onTabChange("samples")}
            className={`h-full px-1 text-[17px] font-semibold border-b-2 transition-all flex items-center gap-2.5 ${
              activeTab === "samples"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <img 
              src="/_i_icon_11173_icon_111730_256.png" 
              alt="" 
              className="w-[25px] h-[25px] object-contain" 
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <span>Samples</span>
          </button>
        </div>
      )}

      {/* Right side: Notifications + User profile */}
      <div className="flex items-center gap-8">
        {/* Notifications Bell */}
        {user && !user.isAnonymous && (
          <div className="relative">
            <button
              id="header-news-feed-toggle"
              onClick={() => setNewsFeedOpen((v) => !v)}
              className="relative p-2.5 rounded-full hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-200"
              title="Notifications"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-[34px] h-[34px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              {allNotifications.length > 0 && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border border-slate-900"></span>
              )}
            </button>

            {/* Notifications Dropdown */}
            {newsFeedOpen && (
              <div className="absolute right-0 top-15 w-[384px] bg-slate-900 rounded-xl shadow-2xl border border-slate-800 z-50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <span className="text-sm font-semibold text-slate-100">Notifications</span>
                  <button
                    onClick={() => setNewsFeedOpen(false)}
                    className="text-slate-500 hover:text-slate-300 text-lg font-bold leading-none"
                  >
                    &times;
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/40">
                  {allNotifications.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-8 px-4">
                      Notifications will appear here when events occur.
                    </p>
                  ) : (
                    allNotifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (n.type === "project" && n.status === "ready") {
                            router.push(`/project/${n.projectId}`);
                            setNewsFeedOpen(false);
                          }
                        }}
                        className={`px-4 py-3 hover:bg-slate-800/50 transition-colors flex gap-2 items-start ${n.type === "project" && n.status === "ready" ? "cursor-pointer" : ""
                          }`}
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {n.type === "git" && <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>}
                          {n.type === "project" && n.status === "ready" && (
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
                          )}
                          {n.type === "project" && n.status === "error" && (
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-200 truncate">{n.title}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{n.message}</p>
                          <span className="text-[10px] text-slate-500 block mt-1">{timeAgo(n.timestamp)}</span>
                        </div>
                        {n.type === "project" && (
                          <button
                            onClick={(e) => handleRemoveProjectNotification(n.id, e)}
                            className="text-slate-500 hover:text-red-400 text-xs px-1 font-bold leading-none self-center hover:bg-slate-800 rounded p-1 transition-colors"
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

        {/* User profile dropdown button */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center justify-center p-1.5 rounded-full hover:bg-slate-800 transition-colors text-slate-400 hover:text-slate-200"
            title="User Settings"
          >
            {user && !user.isAnonymous && githubUsername ? (
              <img src="/github-header.png" alt="GitHub" className="w-[34px] h-[34px] object-contain" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-[34px] h-[34px] text-slate-400 hover:text-slate-200"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            )}
          </button>

          {/* User Menu Dropdown */}
          {userMenuOpen && (
            <div className="absolute right-0 top-15 w-56 bg-slate-900 rounded-xl shadow-2xl border border-slate-800 z-50 overflow-hidden py-2 flex flex-col">
              <div className="px-4 py-2 border-b border-slate-800">
                <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Signed in as</p>
                <p className="text-sm font-bold text-slate-200 truncate mt-0.5" title={displayLabel}>
                  {displayLabel}
                </p>
              </div>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  handleLogout();
                }}
                className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-slate-800 transition-colors font-semibold"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
