"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, GithubAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut } from "../lib/firebase";
import type { User } from "firebase/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function Dashboard() {
  const [repoUrls, setRepoUrls] = useState<string[]>(["https://github.com/GoogleCloudPlatform/microservices-demo.git"]);
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u && !u.isAnonymous) {
        const token = await u.getIdToken();
        localStorage.setItem("firebase_token", token);
      } else {
        localStorage.setItem("firebase_token", "guest");
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
        
        // Clean URL params
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
      } else {
        const cached = localStorage.getItem("github_installation_id");
        if (cached) {
          setInstallationId(cached);
        }
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
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ installation_id: installationId })
          });
        } catch (err) {
          console.error("Failed to save github app installation", err);
        }
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
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setInstallUrl(data.install_url);
          }
        } catch (err) {
          console.error("Failed to fetch GitHub App install url", err);
        }
      }
      fetchInstallUrl();
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      return;
    }
    
    const currentUser = user;
    async function fetchProjects() {
      try {
        const token = currentUser && auth && !currentUser.isAnonymous ? await currentUser.getIdToken() : "guest";
        const res = await fetch(`${API_BASE_URL}/api/projects`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setProjects(data || []);
        }
      } catch (err) {
        console.error("Failed to fetch projects history", err);
      }
    }
    fetchProjects();
  }, [user]);

  const handleGitHubLogin = async () => {
    if (!auth) {
      setError("Firebase is not configured. Please set environment variables.");
      return;
    }
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError("GitHub Login failed: " + err.message);
    }
  };

  const handleGuestLogin = async () => {
    if (!auth) {
      // Just mock user if Firebase isn't configured
      setUser({ isAnonymous: true, uid: 'mock-guest' } as any);
      return;
    }
    try {
      await signInAnonymously(auth);
    } catch (err: any) {
      setError("Guest Login failed: " + err.message);
    }
  };

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    } else {
      setUser(null);
    }
  };

  const handleUrlChange = (idx: number, val: string) => {
    const newUrls = [...repoUrls];
    newUrls[idx] = val;
    setRepoUrls(newUrls);
  };

  const handleAddUrl = () => {
    setRepoUrls([...repoUrls, ""]);
  };

  const handleRemoveUrl = (idx: number) => {
    const newUrls = repoUrls.filter((_, i) => i !== idx);
    setRepoUrls(newUrls);
  };

  const handleGenerate = async () => {
    const filteredUrls = repoUrls.map(u => u.trim()).filter(Boolean);
    if (filteredUrls.length === 0) {
      setError("Please enter at least one repository URL.");
      return;
    }

    setLoading(true);
    setError(null);
    setStatus("Starting analysis...");
    try {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      
      const res = await fetch(`${API_BASE_URL}/api/projects/analyze`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          repo_urls: filteredUrls,
          project_name: projectName.trim() || null,
          github_installation_id: installationId || null
        }),
      });
      
      if (!res.ok) {
        throw new Error(await res.text());
      }
      
      const data = await res.json();
      const projectId = data.project_id;
      
      setStatus("Analyzing code and generating avatars (this may take a few minutes)...");
      
      // Poll for completion
      const interval = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.status === "ready") {
              clearInterval(interval);
              router.push(`/project/${projectId}`);
            } else if (pollData.status === "error") {
              clearInterval(interval);
              setError("Analysis failed on the server.");
              setLoading(false);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 5000);
      
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (authLoading) {
    return <main className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</main>;
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">Architecture World</h1>
          <p className="text-gray-500 text-center mb-8 text-sm">Visualize your microservices as a living ecosystem.</p>
          
          <button
            onClick={handleGitHubLogin}
            className="w-full bg-gray-900 text-white font-medium py-3 rounded-md mb-4 hover:bg-gray-800 transition-colors flex justify-center items-center gap-2"
          >
            Sign in with GitHub
          </button>
          
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-gray-300"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 text-sm">Or</span>
            <div className="flex-grow border-t border-gray-300"></div>
          </div>
          
          <button
            onClick={handleGuestLogin}
            className="w-full bg-blue-50 text-blue-600 font-medium py-3 rounded-md border border-blue-200 hover:bg-blue-100 transition-colors"
          >
            Try Demo as Guest
          </button>
          
          {error && <p className="mt-4 text-red-500 text-sm text-center">{error}</p>}
        </div>
      </main>
    );
  }

  const githubUsername = user ? (user as any).reloadUserInfo?.screenName : null;
  const displayLabel = user
    ? user.isAnonymous
      ? "Guest User"
      : githubUsername
        ? `GitHub: @${githubUsername}`
        : (user.displayName || user.email || "GitHub User")
    : "";

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4 flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {displayLabel}
        </span>
        <button onClick={handleLogout} className="text-sm text-red-500 hover:underline">Logout</button>
      </div>
      
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full mt-10">
        <h1 className="text-2xl font-bold mb-2 text-center text-gray-800">Architecture as a World</h1>
        <p className="text-gray-500 text-center mb-6 text-sm">Enter the GitHub repository clone URLs you want to analyze.</p>
        
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
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center bg-gray-900 hover:bg-gray-800 text-white font-medium px-3 py-1.5 rounded-md transition-all self-start sm:self-auto"
              >
                {installationId ? "Reconnect" : "Connect GitHub App"}
              </a>
            ) : (
              <button
                disabled
                className="inline-flex items-center justify-center bg-gray-300 text-gray-400 font-medium px-3 py-1.5 rounded-md cursor-not-allowed self-start sm:self-auto"
                title="GitHub App is not configured on the API server."
              >
                Connect GitHub App
              </button>
            )}
          </div>
        )}
        
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-2">Project Name (Optional)</label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="My Microservices Project"
          />
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Repository URLs</label>
          {repoUrls.map((url, idx) => (
            <div key={idx} className="flex gap-2 mb-3 items-center">
              <input
                type="text"
                className="flex-grow border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                value={url}
                onChange={(e) => handleUrlChange(idx, e.target.value)}
                placeholder="https://github.com/owner/repo.git"
              />
              {repoUrls.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemoveUrl(idx)}
                  className="text-red-500 hover:text-red-700 text-sm font-bold p-2"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddUrl}
            className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1 mt-2"
          >
            + Add Repository
          </button>
        </div>
        
        <button
          onClick={handleGenerate}
          disabled={loading}
          className={`w-full py-3 rounded-md font-medium text-white transition-colors ${
            loading ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {loading ? "Processing..." : "Generate World"}
        </button>
        
        {status && loading && (
          <div className="mt-4 text-sm text-blue-600 text-center flex flex-col items-center animate-pulse">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
            {status}
          </div>
        )}
        
        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-md break-words">
            {error}
          </div>
        )}

        {projects.length > 0 && (
          <div className="mt-8 pt-6 border-t border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Your Past Worlds</h2>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {projects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => router.push(`/project/${proj.id}`)}
                  className="flex justify-between items-center p-3 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50/20 cursor-pointer transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {proj.name || `World (${proj.id.substring(0, 8)})`}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {proj.created_at ? new Date(proj.created_at).toLocaleDateString() : ""}
                    </div>
                  </div>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    proj.status === 'ready' ? 'bg-green-50 text-green-700 border border-green-200' :
                    proj.status === 'analyzing' ? 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse' :
                    'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {proj.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
