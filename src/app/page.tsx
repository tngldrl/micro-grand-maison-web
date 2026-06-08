"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth, GithubAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut } from "../lib/firebase";
import type { User } from "firebase/auth";

export default function Dashboard() {
  const [repoPaths, setRepoPaths] = useState("/Users/kasedamineya/src/repostory/architecture-world-web");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

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

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setStatus("Starting analysis...");
    try {
      const token = user && auth && !user.isAnonymous ? await user.getIdToken() : "guest";
      
      const res = await fetch("http://localhost:8000/api/projects/analyze", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ repo_paths: repoPaths }),
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
          const pollRes = await fetch(`http://localhost:8000/api/projects/${projectId}`, {
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

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4 flex items-center gap-4">
        <span className="text-sm text-gray-600">
          {user.isAnonymous ? "Guest User" : user.displayName || user.email}
        </span>
        <button onClick={handleLogout} className="text-sm text-red-500 hover:underline">Logout</button>
      </div>
      
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full mt-10">
        <h1 className="text-2xl font-bold mb-2 text-center text-gray-800">Architecture as a World</h1>
        <p className="text-gray-500 text-center mb-8 text-sm">Enter the absolute paths to the repositories you want to analyze.</p>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Repository Paths (comma separated)</label>
          <textarea
            className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            rows={4}
            value={repoPaths}
            onChange={(e) => setRepoPaths(e.target.value)}
            placeholder="/path/to/repo1, /path/to/repo2"
          />
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
      </div>
    </main>
  );
}
