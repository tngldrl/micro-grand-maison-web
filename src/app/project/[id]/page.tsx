"use client";

import { useEffect, useState, useCallback, use, MouseEvent as ReactMouseEvent, FormEvent } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const getComponentSizes = (scaleTier?: number) => {
  const tier = scaleTier || 3;
  switch (tier) {
    case 1:
      return { nodeWidth: 140, imageSize: 100, fontSize: "text-xs" };
    case 2:
      return { nodeWidth: 170, imageSize: 130, fontSize: "text-xs" };
    case 3:
      return { nodeWidth: 200, imageSize: 160, fontSize: "text-sm" };
    case 4:
      return { nodeWidth: 230, imageSize: 190, fontSize: "text-sm" };
    case 5:
      return { nodeWidth: 260, imageSize: 220, fontSize: "text-base" };
    default:
      return { nodeWidth: 200, imageSize: 160, fontSize: "text-sm" };
  }
};

export default function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [repositories, setRepositories] = useState<any[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedMs, setSelectedMs] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  const selectedRepoUrl = selectedMs
    ? repositories.find((r) => r.id === selectedMs.repository_id)?.url
    : null;

  useEffect(() => {
    async function fetchData() {
      try {
        const token = localStorage.getItem("firebase_token") || "guest"; // Just a fallback, better to use auth.currentUser
        const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch project data");
        const data = await res.json();
        
        if (data.status !== "ready") {
          throw new Error("Project is not ready");
        }
        
        const initialNodes: Node[] = (data.microservices || []).map((ms: any, index: number) => {
          const x = ms.position?.x ?? 0;
          const y = ms.position?.y ?? 0;
          
          const { nodeWidth, imageSize, fontSize } = getComponentSizes(ms.scale_tier);
          
          return {
            id: ms.id,
            position: { x, y },
            data: {
              msData: ms, // Store raw data for chat drawer
              label: (
                <div className="flex flex-col items-center group cursor-pointer w-full">
                  <img
                    src={ms.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                    alt={ms.name}
                    style={{ width: imageSize, height: imageSize }}
                    className="mb-2 object-contain filter drop-shadow-[0_8px_16px_rgba(0,0,0,0.25)] transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_12px_20px_rgba(0,0,0,0.35)]"
                  />
                  <div className="bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-xl p-2.5 shadow-md flex flex-col items-center w-full transition-all duration-300 group-hover:border-blue-300 group-hover:shadow-lg">
                    <span className={`font-bold ${fontSize} text-slate-800 text-center line-clamp-1`}>{ms.name}</span>
                    {ms.description && (
                      <span className="text-[10px] text-slate-500 text-center mt-1 line-clamp-2 leading-tight">
                        {ms.description}
                      </span>
                    )}
                  </div>
                </div>
              ),
            },
            style: {
              width: nodeWidth,
              background: "transparent",
              border: "none",
              boxShadow: "none",
              padding: 0,
            },
          };
        });

        const initialEdges: Edge[] = (data.dependencies || []).map((dep: any) => ({
          id: dep.id,
          source: dep.source,
          target: dep.target,
          label: dep.type,
          animated: true,
          style: { stroke: "#64748b", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#64748b",
          },
        }));

        setNodes(initialNodes);
        setEdges(initialEdges);
        setRepositories(data.repositories || []);
        setProjectName(data.name || null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [projectId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeClick = async (event: ReactMouseEvent, node: Node) => {
    const ms = node.data.msData;
    if (!ms) return;
    
    setSelectedMs(ms);
    setIsDrawerOpen(true);
    setChatMessages([]);
    setIsChatLoading(true);
    
    try {
      const token = localStorage.getItem("firebase_token") || "guest";
      const res = await fetch(`${API_BASE_URL}/api/microservices/${ms.id}/chat`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to load chat history", err);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !selectedMs) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsChatLoading(true);

    try {
      const token = localStorage.getItem("firebase_token") || "guest";
      const res = await fetch(`${API_BASE_URL}/api/microservices/${selectedMs.id}/chat`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ message: userMessage })
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to send message", err);
      setChatMessages(prev => [...prev, { role: "model", content: "Sorry, I could not respond. System error." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <main className="w-screen h-screen flex overflow-hidden relative bg-gray-50">
      {/* Graph Area */}
      <div className={`flex-1 transition-all duration-300 ${isDrawerOpen ? 'mr-96' : ''}`}>
        <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded shadow">
          <Link href="/" className="text-blue-500 text-sm font-medium hover:underline mb-2 inline-block">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-800">{projectName || "Architecture World"}</h1>
          <p className="text-sm text-gray-500">Project ID: {projectId}</p>
          {loading && <p className="text-sm text-blue-500 mt-2">Loading world...</p>}
          {error && <p className="text-sm text-red-500 mt-2">Error: {error}</p>}
        </div>
        
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      {/* Chat Drawer */}
      <div className={`fixed top-0 right-0 w-96 h-full bg-white shadow-2xl border-l border-gray-200 transform transition-transform duration-300 flex flex-col z-50 ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedMs && (
          <>
            <div className="p-4 border-b border-gray-200 bg-white shadow-sm z-10 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={selectedMs.avatar_image_url} alt={selectedMs.name} className="w-12 h-12 rounded-full bg-black object-cover" />
                  <div>
                    <h2 className="font-bold text-gray-800 text-lg leading-tight">{selectedMs.name}</h2>
                    {selectedRepoUrl && (
                      <div className="text-xs text-gray-500 mt-1 break-all">
                        <span className="font-medium text-gray-400 mr-1">Repo:</span>
                        <a
                          href={selectedRepoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline font-mono"
                        >
                          {selectedRepoUrl}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => setIsDrawerOpen(false)} className="text-gray-400 hover:text-gray-700 p-2 text-2xl font-bold transition-colors">
                  &times;
                </button>
              </div>
              {selectedMs.description && (
                <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100 whitespace-pre-wrap leading-relaxed">
                  {selectedMs.description}
                </div>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
              {chatMessages.length === 0 && !isChatLoading && (
                <p className="text-center text-gray-400 text-sm mt-10">Say hello to the {selectedMs.name} staff!</p>
              )}
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`markdown-body max-w-[80%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-blue-500 text-white rounded-br-none' : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'}`}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 text-gray-500 rounded-lg rounded-bl-none p-3 shadow-sm text-sm flex items-center gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: "0.2s"}}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: "0.4s"}}></div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question..."
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  disabled={isChatLoading}
                />
                <button
                  type="submit"
                  disabled={isChatLoading || !chatInput.trim()}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
