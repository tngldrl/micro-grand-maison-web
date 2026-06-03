"use client";

import { useEffect, useState, useCallback, use } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  applyNodeChanges,
  applyEdgeChanges,
  EdgeChange,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import Link from "next/link";

export default function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.id;
  
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`http://localhost:8000/api/projects/${projectId}`);
        if (!res.ok) throw new Error("Failed to fetch project data");
        const data = await res.json();
        
        if (data.status !== "ready") {
          throw new Error("Project is not ready");
        }
        
        const initialNodes: Node[] = (data.microservices || []).map((ms: any, index: number) => {
          // If Gemini didn't specify coordinates, they default to 0.0 in DB. Scatter them to avoid overlap.
          const x = (ms.position?.x === 0 && ms.position?.y === 0) ? 100 + (index * 220) : ms.position?.x || 0;
          const y = (ms.position?.x === 0 && ms.position?.y === 0) ? 100 + ((index % 2) * 150) : ms.position?.y || 0;
          
          return {
          id: ms.id,
          position: { x, y },
          data: {
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

  return (
    <main className="w-screen h-screen">
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
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </main>
  );
}
