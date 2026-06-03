"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const [repoPaths, setRepoPaths] = useState("/Users/kasedamineya/src/repostory/architecture-world-web");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setStatus("Starting analysis...");
    try {
      const res = await fetch("http://localhost:8000/api/projects/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          const pollRes = await fetch(`http://localhost:8000/api/projects/${projectId}`);
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

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full">
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
          <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
