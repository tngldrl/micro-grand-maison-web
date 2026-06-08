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

export default function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedMs, setSelectedMs] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<{role: string, content: string}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = localStorage.getItem("firebase_token") || "guest"; // Just a fallback, better to use auth.currentUser
        const res = await fetch(`http://localhost:8000/api/projects/${projectId}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("Failed to fetch project data");
        const data = await res.json();
        
        if (data.status !== "ready") {
          throw new Error("Project is not ready");
        }
        
        const initialNodes: Node[] = (data.microservices || []).map((ms: any, index: number) => {
          const x = (ms.position?.x === 0 && ms.position?.y === 0) ? 100 + (index * 220) : ms.position?.x || 0;
          const y = (ms.position?.x === 0 && ms.position?.y === 0) ? 100 + ((index % 2) * 150) : ms.position?.y || 0;
          
          return {
          id: ms.id,
          position: { x, y },
          data: {
            msData: ms, // Store raw data for chat drawer
            label: (
              <div className="flex flex-col items-center p-2">
                <img
                  src={ms.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                  alt={ms.name}
                  className="w-20 h-20 rounded-full mb-2 bg-black object-cover"
                />
                <span className="font-bold text-sm text-center">{ms.name}</span>
                {ms.description && (
                  <span className="text-xs text-gray-500 text-center mt-1 line-clamp-2">
                    {ms.description}
                  </span>
                )}
              </div>
            ),
          },
          style: {
            width: 180,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
          },
        }
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
      const res = await fetch(`http://localhost:8000/api/microservices/${ms.id}/chat`, {
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
      const res = await fetch(`http://localhost:8000/api/microservices/${selectedMs.id}/chat`, {
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
          <h1 className="text-xl font-bold text-gray-800">Architecture World</h1>
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
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white shadow-sm z-10">
              <div className="flex items-center gap-3">
                <img src={selectedMs.avatar_image_url} alt={selectedMs.name} className="w-12 h-12 rounded-full bg-black object-cover" />
                <div>
                  <h2 className="font-bold text-gray-800 text-lg leading-tight">{selectedMs.name}</h2>
                  <p className="text-xs text-gray-500 line-clamp-1">{selectedMs.description}</p>
                </div>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} className="text-gray-500 hover:text-gray-800 p-2 text-2xl font-bold">
                &times;
              </button>
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
