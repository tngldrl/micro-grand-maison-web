"use client";

import { useEffect, useState } from "react";
import Header from "../../components/Header";

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

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

interface Project {
  id: string;
  name: string;
  status: string;
  has_update: boolean;
  created_at: string | null;
}

interface UserData {
  uid: string;
  email: string;
  display_name: string | null;
  github_username: string | null;
  created_at: string | null;
  projects: Project[];
}

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserData[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Check login state on component mount
  useEffect(() => {
    const token = localStorage.getItem("admin_session_token");
    if (token) {
      setIsAdmin(true);
      fetchUsersAndProjects(token);
    }
  }, []);

  const fetchUsersAndProjects = async (token: string) => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users-projects`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        // Token expired
        handleLogout();
        setError("Admin session expired. Please log in again.");
        return;
      }
      if (!res.ok) {
        throw new Error("Failed to fetch users and projects.");
      }
      const data = await res.json();
      setUsers(data.data.users);
      setError(null);
    } catch (err: any) {
      setError(err.message || "An error occurred.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Hash raw password (matches python's admin_password_hash)
      const passwordHash = await sha256(password);
      // 2. Generate current epoch timestamp
      const timestamp = String(Math.floor(Date.now() / 1000));
      // 3. Generate digest signature: SHA256(passwordHash + timestamp)
      const digest = await sha256(passwordHash + timestamp);

      const res = await fetch(`${API_BASE_URL}/api/admin/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ digest, timestamp }),
      });

      if (!res.ok) {
        throw new Error("Invalid password or unauthorized access.");
      }

      const data = await res.json();
      localStorage.setItem("admin_session_token", data.token);
      setIsAdmin(true);
      fetchUsersAndProjects(data.token);
    } catch (err: any) {
      setError(err.message || "Failed to log in.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_session_token");
    setIsAdmin(false);
    setUsers([]);
  };

  const handleReanalyze = async (projectId: string) => {
    const token = localStorage.getItem("admin_session_token");
    if (!token) return;

    if (!confirm("Are you sure you want to trigger re-analysis for this project?")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/projects/${projectId}/reanalyze`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to trigger re-analysis.");
      }
      alert("Re-analysis queued successfully.");
      fetchUsersAndProjects(token);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const token = localStorage.getItem("admin_session_token");
    if (!token) return;

    if (!confirm("WARNING: Are you sure you want to DELETE this project and all its associated microservices/dependencies? This action is irreversible.")) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/projects/${projectId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to delete project.");
      }
      alert("Project deleted successfully.");
      fetchUsersAndProjects(token);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const totalUsers = users.length;
  const totalProjects = users.reduce((sum, u) => sum + u.projects.length, 0);

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-emerald-400">Micro Grand Maison</h1>
            <p className="text-sm text-slate-400 mt-2">Admin Dashboard Authentication</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Admin Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="Enter password..."
                required
              />
            </div>

            {error && <div className="text-sm text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg p-3">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-slate-950 font-semibold py-3 px-4 rounded-lg transition-colors cursor-pointer"
            >
              {loading ? "Authenticating..." : "Log In as Admin"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-emerald-400">Admin Control Panel</h1>
            <p className="text-sm text-slate-400 mt-1">Manage users, monitor analysis status, and resolve issues.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchUsersAndProjects(localStorage.getItem("admin_session_token") || "")}
              disabled={refreshing}
              className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
            >
              {refreshing ? "Refreshing..." : "Refresh Data"}
            </button>
            <button
              onClick={handleLogout}
              className="bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-900/50 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
            >
              Log Out Admin
            </button>
          </div>
        </div>

        {/* Statistics Widgets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
            <span className="text-sm font-semibold text-slate-400">Total Registered Users</span>
            <span className="text-4xl font-black text-emerald-400 mt-2">{totalUsers}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
            <span className="text-sm font-semibold text-slate-400">Total Created Projects</span>
            <span className="text-4xl font-black text-emerald-400 mt-2">{totalProjects}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
            <span className="text-sm font-semibold text-slate-400">System Role</span>
            <span className="text-xl font-bold text-amber-400 mt-2">Global Administrator</span>
          </div>
        </div>

        {error && <div className="text-sm text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg p-4">{error}</div>}

        {/* Users Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
            <h2 className="text-lg font-bold text-slate-200">Registered Users & Projects</h2>
            {refreshing && <span className="text-xs text-emerald-400 animate-pulse">Syncing...</span>}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  <th className="py-4 px-6">User Identity / GitHub</th>
                  <th className="py-4 px-6">Email Address</th>
                  <th className="py-4 px-6">Registered At</th>
                  <th className="py-4 px-6">Created Projects & Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No registered users found in the system database.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.uid} className="hover:bg-slate-900/30 transition-colors">
                      <td className="py-5 px-6 vertical-align-top">
                        <div className="font-semibold text-slate-200">{user.display_name || "N/A"}</div>
                        <div className="text-xs text-slate-500 mt-1">ID: {user.uid}</div>
                        {user.github_username && (
                          <span className="inline-flex items-center gap-1 bg-slate-950 text-slate-300 border border-slate-800 px-2 py-0.5 rounded text-xs mt-2">
                            @{user.github_username}
                          </span>
                        )}
                      </td>
                      <td className="py-5 px-6 vertical-align-top text-slate-300">
                        {user.email}
                      </td>
                      <td className="py-5 px-6 vertical-align-top text-slate-400">
                        {user.created_at ? new Date(user.created_at).toLocaleString() : "Unknown"}
                      </td>
                      <td className="py-5 px-6 vertical-align-top">
                        {user.projects.length === 0 ? (
                          <span className="text-xs text-slate-500 italic">No projects created</span>
                        ) : (
                          <div className="space-y-4">
                            {user.projects.map((proj) => (
                              <div
                                key={proj.id}
                                className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                              >
                                <div>
                                  <div className="font-medium text-slate-200 text-xs sm:text-sm">{proj.name}</div>
                                  <div className="text-[10px] text-slate-500 mt-0.5">ID: {proj.id}</div>
                                  <div className="flex items-center gap-2 mt-1.5">
                                    <span
                                      className={`inline-block w-2 h-2 rounded-full ${
                                        proj.status === "ready"
                                          ? "bg-emerald-500"
                                          : proj.status === "failed"
                                          ? "bg-rose-500"
                                          : "bg-amber-500 animate-pulse"
                                      }`}
                                    />
                                    <span className="text-xs text-slate-400 capitalize">{proj.status}</span>
                                    {proj.has_update && (
                                      <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] px-1.5 py-0.5 rounded font-bold">
                                        Update Badged
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleReanalyze(proj.id)}
                                    disabled={proj.status === "pending" || proj.status === "analyzing"}
                                    className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-950 text-slate-300 border border-slate-800 disabled:text-slate-600 disabled:border-slate-900 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    Re-analyze
                                  </button>
                                  <button
                                    onClick={() => handleDeleteProject(proj.id)}
                                    className="bg-rose-950/30 hover:bg-rose-900/30 text-rose-300 border border-rose-900/40 px-3 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
