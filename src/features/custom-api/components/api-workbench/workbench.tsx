"use client";
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ServerIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { nodeTypes } from "../../config/workbench-config";
import { CustomEdge } from "./custom";
import { APIEndpoint } from "@/features/custom-api/types/custom-api.type";
import { useWorkbenchRedux } from "../../hooks/use-workbench-redux";
import "@xyflow/react/dist/style.css";
import "@/styles/visualizer.css";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import DeleteNodeAlert from "./editbar/delete-node-alert";

const edgeTypes = {
  customEdge: CustomEdge,
};

const Workbench = () => {
  // Get endpointId from URL params
  const { endpointId } = useParams();

  // Redux state
  const { currentAPI } = useSelector((state: any) => state.api);

  // Workbench Redux hook
  const {
    currentEndpointState,
    currentEndpointId,
    setEndpoint,
    startAddNode,
    cancelAddNode,
    selectNode,
    deleteNode,
    updateViewport,
    getCurrentIsAddingNode,
    getCurrentSelectedNodeId,
    saveWorkbenchToAPI,
    loadWorkbenchFromAPI,
  } = useWorkbenchRedux();

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, setCenter, setViewport } = useReactFlow();

  // Track if we're currently restoring viewport (to prevent saving immediately after)
  const [isRestoringViewport, setIsRestoringViewport] = useState(false);

  // State for delete confirmation modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);

  // State for publish button
  const [isPublishing, setIsPublishing] = useState(false);

  const handleAddNode = useCallback(
    (sourceId: string) => {
      // Start the add node flow instead of directly adding
      startAddNode(sourceId);
    },
    [startAddNode],
  );

  // Check if there are unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    if (!currentAPI || !endpointId || !currentEndpointState) {
      return false;
    }

    // Find the endpoint in the current API
    const endpoint = currentAPI.endpoints.find((ep: any) => ep.id === endpointId);
    if (!endpoint || !endpoint.flow) {
      // If no saved flow exists, check if we have current data
      return currentEndpointState.nodes.length > 0 || currentEndpointState.edges.length > 0;
    }

    // Compare current nodes with saved nodes
    const currentNodes = currentEndpointState.nodes;
    const savedNodes = endpoint.flow.nodes || [];
    
    if (currentNodes.length !== savedNodes.length) {
      return true;
    }

    // Compare each node
    for (let i = 0; i < currentNodes.length; i++) {
      const currentNode = currentNodes[i];
      const savedNode = savedNodes[i];
      
      if (
        currentNode.id !== savedNode.id ||
        currentNode.type !== savedNode.type ||
        JSON.stringify(currentNode.position) !== JSON.stringify(savedNode.position) ||
        JSON.stringify(currentNode.data) !== JSON.stringify(savedNode.data)
      ) {
        return true;
      }
    }

    // Compare current edges with saved edges
    const currentEdges = currentEndpointState.edges;
    const savedEdges = endpoint.flow.edges || [];
    
    if (currentEdges.length !== savedEdges.length) {
      return true;
    }

    // Compare each edge
    for (let i = 0; i < currentEdges.length; i++) {
      const currentEdge = currentEdges[i];
      const savedEdge = savedEdges[i];
      
      if (
        currentEdge.id !== savedEdge.id ||
        currentEdge.source !== savedEdge.source ||
        currentEdge.target !== savedEdge.target ||
        currentEdge.sourceHandle !== savedEdge.sourceHandle ||
        currentEdge.targetHandle !== savedEdge.targetHandle
      ) {
        return true;
      }
    }

    return false;
  }, [currentAPI, endpointId, currentEndpointState]);

  // Handle publish flow
  const handlePublish = useCallback(async () => {
    if (!currentAPI?.connectionId || !endpointId) {
      console.error("Missing connection ID or endpoint ID");
      return;
    }

    setIsPublishing(true);
    try {
      if (!currentEndpointState?.nodes || !currentEndpointState?.edges) {
        throw new Error("No nodes or edges found");
      }
      const result = await saveWorkbenchToAPI(
        typeof endpointId === "string" ? endpointId : "",
      );
      if (result.success) {
        toast.success("Flow published successfully!");
      } else {
        console.error("Failed to publish flow:", result.error);
        toast.error("Failed to publish flow:", {
          description: result.error,
        });
      }
    } catch (error) {
      console.error("Error publishing flow:", error);
    } finally {
      setIsPublishing(false);
    }
  }, [
    currentAPI?.connectionId,
    endpointId,
    saveWorkbenchToAPI,
    currentEndpointState,
  ]);

  // Initialize endpoint when endpointId changes
  useEffect(() => {
    if (
      currentAPI &&
      endpointId &&
      typeof endpointId === "string" &&
      currentEndpointId !== endpointId
    ) {
      const selectedEndpoint = currentAPI.endpoints.find(
        (endpoint: APIEndpoint) => endpoint.id === endpointId,
      );

      if (selectedEndpoint) {
        // Check if endpoint has flow data
        if (
          selectedEndpoint.flow &&
          selectedEndpoint.flow.nodes &&
          selectedEndpoint.flow.nodes.length > 0
        ) {
          // If flow data exists, load it
          loadWorkbenchFromAPI(endpointId).catch((error) => {
            console.error("Failed to load workbench data:", error);
          });
        } else {
          // If no flow data, just set the endpoint
          setEndpoint(selectedEndpoint);
        }
      }
    }
  }, [
    currentAPI,
    endpointId,
    currentEndpointId,
    setEndpoint,
    loadWorkbenchFromAPI,
    handleAddNode,
  ]);

  // Initialize React Flow state only when endpoint changes
  useEffect(() => {
    if (!currentEndpointState || !endpointId) {
      // No endpoint - clear React Flow state
      setNodes([]);
      setEdges([]);
      return;
    }

    // Always update nodes and edges from context
    setNodes(currentEndpointState.nodes);
    setEdges(currentEndpointState.edges);

    // Check if this is a new endpoint (nodes.length is 0) or nodes were added
    const currentNodeCount = nodes.length;
    const contextNodeCount = currentEndpointState.nodes.length;
    const isNewEndpoint = currentNodeCount === 0;
    const nodesWereAdded = contextNodeCount > currentNodeCount;

    if (isNewEndpoint) {
      // New endpoint - handle viewport restoration or initial fit
      if (typeof endpointId === "string") {
        const endpointState = currentEndpointState;
        const hasCustomViewport =
          endpointState &&
          endpointState.viewport &&
          endpointState.viewport.zoom !== 0.8;

        if (hasCustomViewport) {
          // Restore saved viewport
          setIsRestoringViewport(true);
          setTimeout(() => {
            setViewport(endpointState.viewport, { duration: 0 });
            setIsRestoringViewport(false);
          }, 2);
        } else {
          // No saved viewport - fit view to show all nodes
          setTimeout(() => {
            fitView({ padding: 0.2, duration: 800 });
          }, 100);
        }
      }
    } else if (nodesWereAdded && !isRestoringViewport) {
      // Nodes were added - focus on the newest node
      setTimeout(() => {
        // Find all nodes that have timestamps (flow nodes and response nodes)
        const nodesWithTimestamps = currentEndpointState.nodes.filter(
          (node) =>
            node.id.includes("-") && node.id.split("-").pop()?.match(/^\d+$/),
        );

        if (nodesWithTimestamps.length > 0) {
          // Sort by timestamp (newest first) and get the latest node
          const sortedByTimestamp = nodesWithTimestamps.sort((a, b) => {
            const timestampA = parseInt(a.id.split("-").pop() || "0");
            const timestampB = parseInt(b.id.split("-").pop() || "0");
            return timestampB - timestampA; // Descending order (newest first)
          });

          const latestNode = sortedByTimestamp[0]; // Get the first (newest) node
          if (latestNode) {
            const centerX = latestNode.position.x + 100;
            const centerY = latestNode.position.y + 50;
            setCenter(centerX, centerY, { duration: 600 });
          }
        }
      }, 200);
    }
  }, [
    currentEndpointState,
    endpointId,
    nodes.length,
    setNodes,
    setEdges,
    setViewport,
    setCenter,
    fitView,
    isRestoringViewport,
    currentEndpointState,
  ]);

  // Handle viewport changes from React Flow
  const handleViewportChange = (viewport: any) => {
    // Don't save viewport if we're currently restoring it
    if (isRestoringViewport) {
      return;
    }
    updateViewport(viewport);
  };

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodeToDelete(nodeId);
      setDeleteModalOpen(true);
    },
    [setNodeToDelete, setDeleteModalOpen],
  );

  const handleReset = () => {
    fitView({ padding: 0.2, duration: 800 });
  };

  const handleConfirmDelete = useCallback(() => {
    if (nodeToDelete) {
      deleteNode(nodeToDelete);
      // Clear selection if the deleted node was selected
      const selectedNodeId = getCurrentSelectedNodeId();
      if (selectedNodeId === nodeToDelete) {
        selectNode(null);
      }
      setNodeToDelete(null);
      setDeleteModalOpen(false);
    }
  }, [nodeToDelete, deleteNode, getCurrentSelectedNodeId, selectNode]);

  // Handle keyboard events for node deletion
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Delete key is pressed and a node is selected
      if (event.key === "Delete" || event.key === "Backspace") {
        // Check if any input field is currently active
        const activeElement = document.activeElement as HTMLElement;
        const isInputActive =
          activeElement &&
          (activeElement.tagName === "INPUT" ||
            activeElement.tagName === "TEXTAREA" ||
            activeElement.tagName === "SELECT" ||
            activeElement.contentEditable === "true" ||
            activeElement.getAttribute("role") === "textbox" ||
            activeElement.getAttribute("role") === "combobox");

        // Don't delete if any input field is active
        if (isInputActive) {
          return;
        }

        const selectedNodeId = getCurrentSelectedNodeId();
        if (selectedNodeId && selectedNodeId !== currentEndpointId) {
          // Don't delete endpoint node
          event.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
      }
    };

    // Add event listener
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [getCurrentSelectedNodeId, currentEndpointId, handleDeleteNode]);

  const handleCancelDelete = useCallback(() => {
    setNodeToDelete(null);
    setDeleteModalOpen(false);
  }, []);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={(nodesToDelete) => {
          nodesToDelete.forEach((node) => {
            if (node.id !== currentEndpointId) {
              // Don't delete endpoint node
              handleDeleteNode(node.id);
            }
          });
        }}
        onEdgesDelete={() => {}} //don't delete edges
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        fitView
        minZoom={0.005}
        maxZoom={1.5}
        fitViewOptions={{ padding: 0.8 }}
        onViewportChange={handleViewportChange}
        onPaneClick={() => {
          // Cancel node addition when clicking on empty space
          if (getCurrentIsAddingNode()) {
            cancelAddNode();
          }
          // Deselect node when clicking on empty space
          selectNode(null);
        }}
        onNodeClick={(_, node) => {
          // Select the clicked node
          if(node.type === 'endpointNode') {
            return;
          }
          selectNode(node.id);
        }}
        className="bg-transparent [&_.react-flow\_\_attribution]:hidden"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={50}
          size={10}
          className="opacity-20 dark:opacity-10"
          color="hsl(var(--muted-foreground))"
        />

        {/* Control Panel */}
        <Panel position="bottom-right" className="space-y-2">
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handleReset}
                  className="border-border bg-background text-xs"
                >
                  <RotateCcwIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset View</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={handlePublish}
                  disabled={isPublishing || !hasUnsavedChanges()}
                  className="border-border bg-background text-xs"
                >
                  <UploadIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Publish Flow</TooltipContent>
            </Tooltip>
          </div>
        </Panel>

        <Controls
          showInteractive={false}
          className="overflow-hidden rounded-lg border border-border shadow-lg backdrop-blur-sm"
        />

        {/* Empty state message */}
        {nodes.length === 0 && !endpointId && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto rounded-lg border bg-card/80 p-6 text-center backdrop-blur-sm">
              <ServerIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <h3 className="mb-1 text-sm font-medium">No Endpoint Selected</h3>
              <p className="text-xs text-muted-foreground">
                Select an endpoint to start building your flow
              </p>
            </div>
          </div>
        )}
      </ReactFlow>

      {/* Delete Confirmation Modal */}
      <DeleteNodeAlert
        deleteModalOpen={deleteModalOpen}
        setDeleteModalOpen={setDeleteModalOpen}
        handleConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
};

export default Workbench;
