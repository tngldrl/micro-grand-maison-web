"use client";

import { useEffect, useState, useCallback, useMemo, use, MouseEvent as ReactMouseEvent, FormEvent, memo } from "react";
import ReactFlow, {
  Background,
  Controls,
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
import Header from "../../../components/Header";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const CanvasBackgroundNode = memo(() => {
  const kitchenImg = "/Gemini_Generated_Image_8qp5te8qp5te8qp5.png";
  const encodedKitchenImg = encodeURI(kitchenImg);

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none pointer-events-none"
      style={{
        maskImage: "radial-gradient(circle, black 65%, transparent 95%)",
        WebkitMaskImage: "radial-gradient(circle, black 65%, transparent 95%)",
      }}
    >
      {/* Kitchen Image (Bottom Right) */}
      <div
        className="absolute top-[878px] right-0 w-[2722px] h-[2268px] bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url("${encodedKitchenImg}")`,
        }}
      />
      {/* Restaurant Dining Image (Top Left) */}
      <div
        className="absolute top-[433px] left-0 w-[2722px] h-[2268px] bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/Gemini_Generated_Image_dqrkx3dqrkx3dqrk.png')",
        }}
      />
    </div>
  );
});
CanvasBackgroundNode.displayName = "CanvasBackgroundNode";

const nodeTypes = {
  canvasBackground: CanvasBackgroundNode,
};

const proOptions = { hideAttribution: true };

const getComponentSizes = (scaleTier?: number) => {
  const tier = scaleTier || 3;
  switch (tier) {
    case 1:
      return { nodeWidth: 180, imageSize: 130, fontSize: "text-[22px]" };
    case 2:
      return { nodeWidth: 220, imageSize: 170, fontSize: "text-[22px]" };
    case 3:
      return { nodeWidth: 260, imageSize: 210, fontSize: "text-[25px]" };
    case 4:
      return { nodeWidth: 300, imageSize: 250, fontSize: "text-[25px]" };
    case 5:
      return { nodeWidth: 340, imageSize: 290, fontSize: "text-[29px]" };
    default:
      return { nodeWidth: 260, imageSize: 210, fontSize: "text-[25px]" };
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
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [translateExtent, setTranslateExtent] = useState<[[number, number], [number, number]] | undefined>(undefined);

  // Chat drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedMs, setSelectedMs] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<{ role: string, content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "relations">("chat");

  const selectedRepoUrl = selectedMs
    ? repositories.find((r) => r.id === selectedMs.repository_id)?.url
    : null;

  // Dynamically show labels only on edges connected to the hovered node
  const displayEdges = useMemo(() => {
    return edges.map((edge) => {
      const isConnected = hoveredNodeId !== null && (edge.source === hoveredNodeId || edge.target === hoveredNodeId);
      return {
        ...edge,
        label: isConnected ? (edge.data?.type || "") : "",
      };
    });
  }, [edges, hoveredNodeId]);

  // Extract incoming and outgoing relations for the selected microservice
  const relations = useMemo(() => {
    if (!selectedMs) return { incoming: [], outgoing: [] };

    const incoming = edges
      .filter((edge) => edge.target === selectedMs.id)
      .map((edge) => {
        const sourceNode = nodes.find((node) => node.id === edge.source);
        return {
          edgeId: edge.id,
          ms: sourceNode?.data?.msData,
          relationship: edge.data?.type || "",
        };
      })
      .filter((r) => r.ms !== undefined);

    const outgoing = edges
      .filter((edge) => edge.source === selectedMs.id)
      .map((edge) => {
        const targetNode = nodes.find((node) => node.id === edge.target);
        return {
          edgeId: edge.id,
          ms: targetNode?.data?.msData,
          relationship: edge.data?.type || "",
        };
      })
      .filter((r) => r.ms !== undefined);

    return { incoming, outgoing };
  }, [edges, nodes, selectedMs]);

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

        const scaleDistance = 1.56;
        const microservicesData = data.microservices || [];
        const xCoords = microservicesData.map((ms: any) => (ms.position?.x ?? 0) * scaleDistance);
        const yCoords = microservicesData.map((ms: any) => (ms.position?.y ?? 0) * scaleDistance);
        const minX = xCoords.length ? Math.min(...xCoords) : 0;
        const maxX = xCoords.length ? Math.max(...xCoords) : 1000;
        const minY = yCoords.length ? Math.min(...yCoords) : 0;
        const maxY = yCoords.length ? Math.max(...yCoords) : 1000;

        const bgWidth = 5500;
        const bgHeight = 3500;

        const centerX = xCoords.length ? (Math.min(...xCoords) + Math.max(...xCoords)) / 2 : 500;
        const centerY = yCoords.length ? (Math.min(...yCoords) + Math.max(...yCoords)) / 2 : 500;

        const bgX = centerX - bgWidth / 2;
        const bgY = centerY - bgHeight / 2;

        setTranslateExtent([[bgX, bgY], [bgX + bgWidth, bgY + bgHeight]]);

        const backgroundNode: Node = {
          id: "canvas-background",
          type: "canvasBackground",
          position: { x: bgX, y: bgY },
          data: {},
          style: {
            width: bgWidth,
            height: bgHeight,
            zIndex: 0,
            pointerEvents: "none",
          },
          draggable: false,
          selectable: false,
          deletable: false,
        };

        const initialNodes: Node[] = [
          backgroundNode,
          ...microservicesData.map((ms: any, index: number) => {
            const x = (ms.position?.x ?? 0) * scaleDistance;
            const y = (ms.position?.y ?? 0) * scaleDistance;

            const { nodeWidth, imageSize, fontSize } = getComponentSizes(ms.scale_tier);

            return {
              id: ms.id,
              position: { x, y },
              data: {
                msData: ms, // Store raw data for chat drawer
                label: (
                  <div className="flex flex-col items-center group cursor-pointer w-max">
                    <img
                      src={ms.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                      alt={ms.name}
                      style={{ width: imageSize, height: imageSize }}
                      className="mb-2 object-contain filter drop-shadow-[0_8px_16px_rgba(0,0,0,0.25)] transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_12px_20px_rgba(0,0,0,0.35)]"
                    />
                    <div className="bg-white/95 backdrop-blur-sm border border-slate-200/80 rounded-xl p-3.5 shadow-md flex flex-col items-center w-max min-w-[200px] max-w-[450px] px-5 transition-all duration-300 group-hover:border-blue-300 group-hover:shadow-lg">
                      <span className={`font-bold ${fontSize} text-slate-800 text-center whitespace-nowrap`}>{ms.name}</span>
                    </div>
                  </div>
                ),
              },
              style: {
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: 0,
                zIndex: 10,
              },
            };
          })
        ];

        const initialEdges: Edge[] = (data.dependencies || []).map((dep: any) => ({
          id: dep.id,
          source: dep.source,
          target: dep.target,
          label: "", // Empty by default
          data: { type: dep.type }, // Store original relationship label
          animated: true,
          style: { stroke: "#ffffff", strokeWidth: 5, strokeDasharray: "8" },
          labelStyle: {
            fontSize: 24,
            fontWeight: 700,
            fill: "#334155",
          },
          labelBgStyle: {
            fill: "#f8fafc",
            fillOpacity: 0.95,
          },
          labelBgPadding: [12, 6],
          labelBgBorderRadius: 6,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#ffffff",
          },
        }));

        setNodes(initialNodes);
        setEdges(initialEdges);
        setRepositories(data.repositories || []);
        setProjectName(data.name || null);
        setHasUpdate(data.has_update ?? false);
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

  const onNodeMouseEnter = useCallback((_event: ReactMouseEvent, node: Node) => {
    if (node.id === "canvas-background") return;
    setHoveredNodeId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback((_event: ReactMouseEvent, _node: Node) => {
    setHoveredNodeId(null);
  }, []);

  const selectMicroservice = useCallback(async (ms: any) => {
    if (!ms) return;

    setSelectedMs(ms);
    setIsDrawerOpen(true);
    setChatMessages([]);
    setIsChatLoading(true);
    setActiveTab("chat"); // Reset tab to default chat view

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
  }, []);

  const onNodeClick = useCallback(async (_event: ReactMouseEvent, node: Node) => {
    const ms = node.data.msData;
    if (ms) {
      await selectMicroservice(ms);
    }
  }, [selectMicroservice]);

  const handleUpdate = async () => {
    setIsReanalyzing(true);
    setHasUpdate(false); // Optimistic reset
    try {
      const token = localStorage.getItem("firebase_token") || "guest";
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/re-analyze`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());

      // Poll until ready
      const interval = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
            headers: { "Authorization": `Bearer ${token}` },
          });
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.status === "ready") {
              clearInterval(interval);
              setIsReanalyzing(false);
              // Reload the page to re-render fresh architecture data
              window.location.reload();
            } else if (pollData.status === "error") {
              clearInterval(interval);
              setIsReanalyzing(false);
              setError("Re-analysis failed on the server.");
            }
          }
        } catch (e) { console.error("Re-analysis polling error", e); }
      }, 5000);
    } catch (err: any) {
      setIsReanalyzing(false);
      setHasUpdate(true); // Restore if failed
      setError("Failed to trigger re-analysis: " + err.message);
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
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-black">
      <Header projectName={projectName} />
      {/* Sub-Header bar */}
      <div className="w-full bg-slate-950 border-b border-slate-900/60 px-6 py-2.5 flex justify-between items-center z-20 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-300">Project:</span>
            <span className="font-bold text-slate-100 text-sm">{projectName || "Loading..."}</span>
          </div>
          <span className="text-slate-800 text-sm self-center">|</span>
          <Link
            href="/"
            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[11px] font-semibold transition-colors"
          >
            <span>&larr;</span>
            <span>Back to Dashboard</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-medium text-slate-500">Source Repository:</span>
          {repositories.length === 0 ? (
            <span className="text-slate-500 italic">None</span>
          ) : (
            <div className="flex items-center gap-3">
              {repositories.map((repo) => (
                <a
                  key={repo.id}
                  href={repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 hover:underline font-mono"
                >
                  {repo.url}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph Area */}
        <div className={`flex-1 h-full transition-all duration-300 relative ${isDrawerOpen ? 'mr-96' : ''}`}>
          
          {/* Update Overlay (only for notifications/update button/loading/error) */}
          {(hasUpdate || isReanalyzing || loading || error) && (
            <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-xl shadow-md border border-gray-100 max-w-xs flex flex-col gap-2">
              {loading && <p className="text-sm text-blue-500 font-medium">Loading world...</p>}
              {error && <p className="text-sm text-red-500 font-medium">Error: {error}</p>}
              {(hasUpdate || isReanalyzing) && (
                <>
                  <p className="text-xs text-gray-500">An update is available for this world.</p>
                  <button
                    id="update-project-btn"
                    onClick={handleUpdate}
                    disabled={isReanalyzing}
                    className={`flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-semibold transition-all ${isReanalyzing
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-md hover:shadow-emerald-200"
                      }`}
                  >
                    {isReanalyzing ? (
                      <>
                        <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></span>
                        Re-analyzing...
                      </>
                    ) : (
                      <>
                        <span className="text-base">🔄</span>
                        Update World
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            nodeTypes={nodeTypes}
            proOptions={proOptions}
            translateExtent={translateExtent}
            nodeExtent={translateExtent}
            minZoom={0.3}
            maxZoom={2}
            fitView
          >
            <Background color="rgba(255, 255, 255, 0.18)" gap={60} size={15} />
            <Controls />
          </ReactFlow>
        </div>

        {/* Chat Drawer */}
        <div className={`fixed top-16 right-0 w-96 h-[calc(100vh-64px)] bg-slate-900 shadow-2xl border-l border-slate-800 transform transition-transform duration-300 flex flex-col z-40 ${isDrawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {selectedMs && (
          <>
            <div className="p-4 border-b border-slate-800 bg-slate-900 shadow-sm z-10 flex flex-col gap-3">
              <div className="flex justify-between items-start">
                <div className="flex-1"></div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="text-slate-400 hover:text-slate-200 p-1 text-2xl font-bold transition-colors leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="flex flex-col items-center -mt-6">
                <img
                  src={selectedMs.avatar_chat_image_url || selectedMs.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                  alt={selectedMs.name}
                  className="w-40 h-40 object-contain filter drop-shadow-[0_8px_16px_rgba(0,0,0,0.15)] transition-transform duration-300 hover:scale-105"
                />
                <h2 className="font-bold text-slate-100 text-xl leading-tight mt-3 text-center">{selectedMs.name}</h2>
                {selectedRepoUrl && (
                  <div className="text-xs text-slate-400 mt-1.5 break-all text-center">
                    <span className="font-medium text-slate-500 mr-1">Repo:</span>
                    <a
                      href={selectedRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline font-mono"
                    >
                      {selectedRepoUrl}
                    </a>
                  </div>
                )}
              </div>
              {selectedMs.description && (
                <div className="text-xs text-slate-300 bg-slate-950/40 p-3 rounded-lg border border-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedMs.description}
                </div>
              )}
              {selectedMs.technologies && selectedMs.technologies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {selectedMs.technologies.map((tech: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-[10px] font-medium text-slate-400 bg-slate-850/50 border border-slate-800 rounded-md transition-colors hover:bg-slate-800 hover:text-slate-200"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              )}

              {/* Tab Corner */}
              <div className="flex border-t border-slate-800 -mx-4 -mb-4 mt-2">
                <button
                  onClick={() => setActiveTab("chat")}
                  className={`flex-1 py-2.5 text-sm font-semibold text-center border-b-2 transition-all ${
                    activeTab === "chat"
                      ? "border-blue-500 text-blue-400 bg-blue-955/20"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab("relations")}
                  className={`flex-1 py-2.5 text-sm font-semibold text-center border-b-2 transition-all ${
                    activeTab === "relations"
                      ? "border-blue-500 text-blue-400 bg-blue-955/20"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
                  }`}
                >
                  Relations
                </button>
              </div>
            </div>

            {activeTab === "chat" ? (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950">
                  {chatMessages.length === 0 && !isChatLoading && (
                    <p className="text-center text-slate-500 text-sm mt-10">Say hello to the {selectedMs.name} staff!</p>
                  )}
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`markdown-body max-w-[80%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none shadow-sm'}`}>
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-slate-900 border border-slate-800 text-slate-400 rounded-lg rounded-bl-none p-3 shadow-sm text-sm flex items-center gap-2">
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-900 border-t border-slate-800">
                  <form onSubmit={handleSendMessage} className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask a question..."
                      className="flex-1 px-3 py-2 text-sm border border-slate-800 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-slate-950 text-white placeholder-slate-500"
                      disabled={isChatLoading}
                    />
                    <button
                      type="submit"
                      disabled={isChatLoading || !chatInput.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Send
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-950">
                {/* Incoming relations */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                    &rarr; {selectedMs.name}
                  </h3>
                  {relations.incoming.length === 0 ? (
                    <p className="text-xs text-slate-500 italic pl-2">No incoming connections</p>
                  ) : (
                    <div className="space-y-2">
                      {relations.incoming.map((r) => (
                        <div
                          key={r.edgeId}
                          onClick={() => selectMicroservice(r.ms)}
                          className="flex items-start gap-3 p-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500/50 hover:shadow-lg cursor-pointer transition-all duration-200"
                        >
                          <img
                            src={r.ms.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                            alt={r.ms.name}
                            className="w-10 h-10 object-contain rounded-full bg-slate-950 border border-slate-800 flex-shrink-0 mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-200 truncate">{r.ms.name}</p>
                            <p className="text-xs text-slate-400 mt-0.5 whitespace-normal break-words leading-relaxed">{r.relationship}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Outgoing relations */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                    &larr; {selectedMs.name}
                  </h3>
                  {relations.outgoing.length === 0 ? (
                    <p className="text-xs text-slate-500 italic pl-2">No outgoing connections</p>
                  ) : (
                    <div className="space-y-2">
                      {relations.outgoing.map((r) => (
                        <div
                          key={r.edgeId}
                          onClick={() => selectMicroservice(r.ms)}
                          className="flex items-start gap-3 p-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-blue-500/50 hover:shadow-lg cursor-pointer transition-all duration-200"
                        >
                          <img
                            src={r.ms.avatar_image_url || "https://placehold.co/150/000000/FFFFFF.png?text=?"}
                            alt={r.ms.name}
                            className="w-10 h-10 object-contain rounded-full bg-slate-950 border border-slate-800 flex-shrink-0 mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-slate-200 truncate">{r.ms.name}</p>
                            <p className="text-xs text-slate-400 mt-0.5 whitespace-normal break-words leading-relaxed">{r.relationship}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  </div>
  );
}
