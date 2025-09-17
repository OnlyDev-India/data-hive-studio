import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { Edge } from "@xyflow/react";
import ELK from "elkjs";
import {
  WorkbenchNode,
  NodeData,
} from "@/features/custom-api/types/custom-api.type";
import { updateCurrentAPI } from "@/features/custom-api/utils/data-thunk-func";
import { AppDispatch, RootState } from "@/redux/store";

// Types
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface EndpointState {
  nodes: WorkbenchNode[];
  edges: Edge[];
  nodeCounter: number;
  viewport: ViewportState;
  selectedNodeId: string | null;
  isAddingNode: boolean;
  pendingSourceId: string | null;
  pendingSourceHandle?: string;
}

export interface WorkbenchState {
  endpoints: Record<string, EndpointState>;
  currentEndpointId: string | null;
  selectedNodeType: string | null;
  loading: boolean;
  error: string | null;
}

// ELK.js configuration
const elk = new ELK();

// Helper function to check if a node has children
const hasChildren = (nodeId: string, edges: Edge[]): boolean => {
  return edges.some((edge) => edge.source === nodeId);
};

// Helper function to apply simple tree layout
const getLayoutedElements = (nodes: WorkbenchNode[], edges: Edge[]) => {
  // Create simple tree structure as fallback
  const layoutedNodes = [...nodes];
  
  // Find the root node (endpoint node)
  const rootNode = layoutedNodes.find(node => {
    const nodeData = node.data as any;
    return nodeData?.type === 'endpointNode';
  });
  
  if (rootNode) {
    // Position root node at the top center
    rootNode.position = { x: 0, y: 0 };
    
    // Create a tree structure by positioning nodes based on their distance from root
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; level: number; parentX: number; parentY: number }> = [
      { nodeId: rootNode.id, level: 0, parentX: 0, parentY: 0 }
    ];
    
    while (queue.length > 0) {
      const { nodeId, level, parentX, parentY } = queue.shift()!;
      
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      
      const currentNode = layoutedNodes.find(n => n.id === nodeId);
      if (!currentNode) continue;
      
      // Position current node
      currentNode.position = { x: parentX, y: parentY };
      
      // Find outgoing edges
      const outgoingEdges = edges.filter(edge => edge.source === nodeId);
      const nodeData = currentNode.data as any;
      const isConditional = nodeData?.type === 'conditionalNode';
      
      if (outgoingEdges.length > 0) {
        const nextLevel = level + 1;
        const nextX = parentX + 400; // Increased horizontal spacing between levels
        
        if (isConditional && outgoingEdges.length > 1) {
          // For conditional nodes, position targets vertically
          const sortedEdges = outgoingEdges.sort((a, b) => {
            if (a.sourceHandle === 'true' && b.sourceHandle === 'false') return -1;
            if (a.sourceHandle === 'false' && b.sourceHandle === 'true') return 1;
            return 0;
          });
          
          sortedEdges.forEach((edge, index) => {
            const offset = (index - 0.5) * 250; // Increased vertical spacing for conditional branches
            const nextY = parentY + offset;
            
            queue.push({
              nodeId: edge.target,
              level: nextLevel,
              parentX: nextX,
              parentY: nextY
            });
          });
        } else {
          // For regular nodes, position targets in a line
          outgoingEdges.forEach((edge, index) => {
            const offset = (index - (outgoingEdges.length - 1) / 2) * 200; // Increased spacing for regular nodes
            const nextY = parentY + offset;
            
            queue.push({
              nodeId: edge.target,
              level: nextLevel,
              parentX: nextX,
              parentY: nextY
            });
          });
        }
      }
    }
  }
  
  // Set target and source positions
  layoutedNodes.forEach(node => {
    node.targetPosition = 'left' as any;
    node.sourcePosition = 'right' as any;
  });

  return { nodes: layoutedNodes, edges };
};

// Async ELK layout function for proper multi-handle support
const getELKLayoutedElements = async (nodes: WorkbenchNode[], edges: Edge[]) => {
  // Convert nodes to ELK format
  const elkNodes = nodes.map((node) => {
    const nodeData = node.data as any;
    const isConditional = nodeData?.type === 'conditionalNode';
    
    // Get outgoing edges to determine if we need special positioning
    const outgoingEdges = edges.filter(edge => edge.source === node.id);
    const hasMultipleOutgoing = outgoingEdges.length > 1;
    
    return {
      id: node.id,
      width: 200,
      height: isConditional ? 140 : 100,
      layoutOptions: {
        'elk.priority': hasMultipleOutgoing ? '1' : '0', // Higher priority for nodes with multiple edges
        'elk.spacing.nodeNode': '80', // Increased spacing between nodes
        'elk.spacing.edgeNode': '40', // Increased spacing between edges and nodes
        ...(hasMultipleOutgoing && {
          'elk.layered.spacing.nodeNode': '200', // Extra vertical spacing for multi-handle nodes
          'elk.portConstraints': 'FIXED_ORDER',
        }),
      },
      // Add ports for all nodes
      ports: [
        {
          id: 'input',
          width: 8,
          height: 8,
          properties: {
            'port.side': 'WEST',
            'port.index': '0',
            'port.anchor': 'CENTER'
          }
        },
        // Add output ports for conditional nodes
        ...(isConditional ? [
          {
            id: 'true',
            width: 8,
            height: 8,
            properties: {
              'port.side': 'EAST',
              'port.index': '0',
              'port.anchor': 'CENTER'
            }
          },
          {
            id: 'false',
            width: 8,
            height: 8,
            properties: {
              'port.side': 'EAST',
              'port.index': '1',
              'port.anchor': 'CENTER'
            }
          }
        ] : [
          {
            id: 'output',
            width: 8,
            height: 8,
            properties: {
              'port.side': 'EAST',
              'port.index': '0',
              'port.anchor': 'CENTER'
            }
          }
        ])
      ]
    };
  });

  // Convert edges to ELK format
  const elkEdges = edges.map((edge) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    const sourceNodeData = sourceNode?.data as any;
    const isFromConditional = sourceNodeData?.type === 'conditionalNode';
    
    let sources = [edge.source];
    let targets = [edge.target];
    
    if (isFromConditional && edge.sourceHandle) {
      sources = [`${edge.source}:${edge.sourceHandle}`];
    } else {
      sources = [`${edge.source}:output`];
    }
    
    targets = [`${edge.target}:input`];
    
    return {
      id: edge.id,
      sources,
      targets,
      layoutOptions: {
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.edgeEdge': '40',
        'elk.edge.priority': edge.sourceHandle === 'true' ? '1' : '0',
        'elk.edge.thickness': '2',
        ...(isFromConditional && {
          'elk.edge.placement': 'CENTER',
          'elk.edge.routing': 'ORTHOGONAL',
        }),
      }
    };
  });

  // Create ELK graph
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'force', // Use force-directed algorithm for tree-like structure
      'elk.spacing.nodeNode': '200', // Increased spacing between nodes
      'elk.spacing.edgeNode': '80', // Increased spacing between edges and nodes
      'elk.spacing.edgeEdge': '60', // Increased spacing between parallel edges
      'elk.force.iterations': '300', // More iterations for better layout
      'elk.force.repulsion': '1500', // Stronger repulsion to spread nodes more
      'elk.force.attraction': '80', // Reduced attraction to allow more spacing
      'elk.portConstraints': 'FIXED_ORDER', // Fixed port order for consistent positioning
      'elk.portAlignment.basic': 'JUSTIFIED', // Justify ports for better alignment
    },
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const layoutedGraph = await elk.layout(elkGraph);
    
    const layoutedNodes = nodes.map((node) => {
      const elkNode = layoutedGraph.children?.find(n => n.id === node.id);
      if (!elkNode) return node;
      
      return {
        ...node,
        targetPosition: 'left' as any,
        sourcePosition: 'right' as any,
        position: {
          x: elkNode.x || 0,
          y: elkNode.y || 0,
        },
      };
    });

    // Post-process to create tree structure
    const processedNodes = [...layoutedNodes];
    
    // Find the root node (endpoint node)
    const rootNode = processedNodes.find(node => {
      const nodeData = node.data as any;
      return nodeData?.type === 'endpointNode';
    });
    
    if (rootNode) {
      // Position root node at the top center
      rootNode.position = { x: 0, y: 0 };
      
      // Create a tree structure by positioning nodes based on their distance from root
      const visited = new Set<string>();
      const queue: Array<{ nodeId: string; level: number; parentX: number; parentY: number }> = [
        { nodeId: rootNode.id, level: 0, parentX: 0, parentY: 0 }
      ];
      
      while (queue.length > 0) {
        const { nodeId, level, parentX, parentY } = queue.shift()!;
        
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        
        const currentNode = processedNodes.find(n => n.id === nodeId);
        if (!currentNode) continue;
        
        // Position current node
        currentNode.position = { x: parentX, y: parentY };
        
        // Find outgoing edges
        const outgoingEdges = edges.filter(edge => edge.source === nodeId);
        const nodeData = currentNode.data as any;
        const isConditional = nodeData?.type === 'conditionalNode';
        
        if (outgoingEdges.length > 0) {
          const nextLevel = level + 1;
          const nextX = parentX + 400; // Increased horizontal spacing between levels
          
          if (isConditional && outgoingEdges.length > 1) {
            // For conditional nodes, position targets vertically
            const sortedEdges = outgoingEdges.sort((a, b) => {
              if (a.sourceHandle === 'true' && b.sourceHandle === 'false') return -1;
              if (a.sourceHandle === 'false' && b.sourceHandle === 'true') return 1;
              return 0;
            });
            
            sortedEdges.forEach((edge, index) => {
              const offset = (index - 0.5) * 250; // Increased vertical spacing for conditional branches
              const nextY = parentY + offset;
              
              queue.push({
                nodeId: edge.target,
                level: nextLevel,
                parentX: nextX,
                parentY: nextY
              });
            });
          } else {
            // For regular nodes, position targets in a line
            outgoingEdges.forEach((edge, index) => {
              const offset = (index - (outgoingEdges.length - 1) / 2) * 200; // Increased spacing for regular nodes
              const nextY = parentY + offset;
              
              queue.push({
                nodeId: edge.target,
                level: nextLevel,
                parentX: nextX,
                parentY: nextY
              });
            });
          }
        }
      }
    }

    return { nodes: processedNodes, edges };
  } catch (error) {
    console.error('ELK layout error:', error);
    return getLayoutedElements(nodes, edges);
  }
};

// Default endpoint state
const defaultEndpointState: Partial<EndpointState> = {
  viewport: {
    x: 0,
    y: 0,
    zoom: 0.8, // Better default zoom level
  },
  selectedNodeId: null,
  isAddingNode: false,
  pendingSourceId: null,
};

// Helper function to get or create endpoint state
const getEndpointState = (
  state: WorkbenchState,
  endpointId: string,
): EndpointState => {
  if (!state.endpoints[endpointId]) {
    return {
      nodes: [],
      edges: [],
      nodeCounter: 0,
      ...defaultEndpointState,
    } as EndpointState;
  }
  return state.endpoints[endpointId];
};

// Initial state
const initialState: WorkbenchState = {
  endpoints: {},
  currentEndpointId: null,
  selectedNodeType: null,
  loading: false,
  error: null,
};

// Async thunks
export const saveWorkbenchToAPI = createAsyncThunk<
  { success: boolean; error?: string },
  string,
  { dispatch: AppDispatch; state: RootState }
>(
  'workbench/saveWorkbenchToAPI',
  async (endpointId, { dispatch, getState }) => {
    try {
      const state = getState();
      const workbenchState = state.workbench;
      const apiState = state.api;
      
      if (!workbenchState.currentEndpointId || !apiState.currentAPI) {
        return { success: false, error: "No current endpoint state or API" };
      }

      const currentEndpointState = getEndpointState(workbenchState, workbenchState.currentEndpointId);

      // Find the endpoint in the current API
      const endpointIndex = apiState.currentAPI.endpoints.findIndex(
        (ep: any) => ep.id === endpointId,
      );
      if (endpointIndex === -1) {
        return { success: false, error: "Endpoint not found" };
      }

      // Convert workbench data to API flow format
      const apiNodes = currentEndpointState.nodes.map((node) => ({
        id: node.id,
        type: node.type || "",
        position: node.position,
        data: node.data,
        config: {},
      }));

      const apiEdges = currentEndpointState.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        animated: edge.animated,
        style: edge.style,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      }));

      // Create updated API with flow data
      const updatedAPI = {
        ...apiState.currentAPI,
        endpoints: apiState.currentAPI.endpoints.map((endpoint: any, index: number) =>
          index === endpointIndex
            ? {
                ...endpoint,
                flow: {
                  nodes: apiNodes,
                  edges: apiEdges,
                },
                updatedAt: new Date(),
              }
            : endpoint,
        ),
      };

      // Use updateCurrentAPI to save the changes
      const result = await dispatch(updateCurrentAPI(updatedAPI));

      if (result.type.endsWith("/fulfilled")) {
        return { success: true };
      } else {
        return {
          success: false,
          error: (result.payload as string) || "Failed to update API",
        };
      }
    } catch (error) {
      console.log(error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save workbench data",
      };
    }
  }
);

export const loadWorkbenchFromAPI = createAsyncThunk<
  { success: boolean; error?: string },
  string,
  { dispatch: AppDispatch; state: RootState }
>(
  'workbench/loadWorkbenchFromAPI',
  async (endpointId, { dispatch, getState }) => {
    try {
      const state = getState();
      const apiState = state.api;
      
      if (!apiState.currentAPI) {
        return { success: false, error: "No current API" };
      }

      // Find the endpoint in the current API
      const endpoint = apiState.currentAPI.endpoints.find(
        (ep: any) => ep.id === endpointId,
      );
      if (!endpoint) {
        return { success: false, error: "Endpoint not found" };
      }

      if (!endpoint.flow) {
        return { success: true };
      }

      // Convert API flow data to workbench format
      const nodes = endpoint.flow.nodes;
      const edges = endpoint.flow.edges;

      // Dispatch actions to load the data
      dispatch(setEndpoint({ endpointId, endpoint }));
      dispatch(loadWorkbenchData({ endpointId, nodes, edges }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load workbench data",
      };
    }
  }
);

// Slice
const workbenchSlice = createSlice({
  name: 'workbench',
  initialState,
  reducers: {
    setEndpoint: (state, action: PayloadAction<{ endpointId: string; endpoint: any }>) => {
      const { endpointId, endpoint } = action.payload;

      // Get existing endpoint state or create new one
      const existingState = getEndpointState(state, endpointId);

      // If endpoint already has nodes, just switch to it
      if (existingState.nodes.length > 0) {
        state.currentEndpointId = endpointId;
        state.selectedNodeType = null; // Clear global selected node type when switching endpoints
        return;
      }

      // Create endpoint node for new endpoint
      const endpointNode: WorkbenchNode = {
        id: endpointId,
        type: "endpointNode",
        position: { x: 100, y: 200 },
        data: {
          type: "endpointNode",
          endpointId: endpoint.id,
          name: endpoint.name,
          description: endpoint.description,
          hasChildren: false,
        },
      };

      const newEndpointState: EndpointState = {
        nodes: [endpointNode],
        edges: [],
        nodeCounter: 0,
        ...defaultEndpointState,
      } as EndpointState;

      state.currentEndpointId = endpointId;
      state.selectedNodeType = null; // Clear global selected node type when creating new endpoint
      state.endpoints[endpointId] = newEndpointState;
    },

    startAddNode: (state, action: PayloadAction<{ sourceId: string; endpointId: string; sourceHandle?: string }>) => {
      const { sourceId, endpointId, sourceHandle } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        isAddingNode: true,
        pendingSourceId: sourceId,
        pendingSourceHandle: sourceHandle, // Store which handle was clicked
        selectedNodeId: null, // Clear selection when starting to add
      };

      state.currentEndpointId = endpointId;
      state.endpoints[endpointId] = updatedEndpointState;
    },

    selectNodeType: (state, action: PayloadAction<{ nodeType: string }>) => {
      const { nodeType } = action.payload;
      state.selectedNodeType = nodeType;
    },

    cancelAddNode: (state, action: PayloadAction<{ endpointId: string }>) => {
      const { endpointId } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        isAddingNode: false,
        pendingSourceId: null,
        pendingSourceHandle: undefined,
      };

      state.endpoints[endpointId] = updatedEndpointState;
    },

    selectNode: (state, action: PayloadAction<{ nodeId: string | null; endpointId: string }>) => {
      const { nodeId, endpointId } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        selectedNodeId: nodeId,
        isAddingNode: false, // Clear adding state when selecting node
        pendingSourceId: null,
      };

      state.endpoints[endpointId] = updatedEndpointState;
    },

    addNode: (state, action: PayloadAction<{ sourceId: string; nodeType: string }>) => {
      const { sourceId, nodeType } = action.payload;

      if (!state.currentEndpointId) {
        return; // No current endpoint, can't add node
      }

      const currentEndpointState = getEndpointState(state, state.currentEndpointId);
      const timestamp = Date.now();

      let newNode: WorkbenchNode;

      if (nodeType === "responseNode") {
        // Create response node
        const newNodeId = `response-node-${currentEndpointState.nodeCounter}-${timestamp}`;
        newNode = {
          id: newNodeId,
          type: nodeType,
          position: { x: 0, y: 0 }, // Will be set by layout
          data: {
            type: nodeType,
            name: "Response Node",
            statusCode: 200,
            responseBody: "{}",
            description: "API Response",
            hasChildren: false, // Response nodes are terminal
          },
        };
      } else if (nodeType === "conditionalNode") {
        // Create conditional node
        const newNodeId = `conditional-node-${currentEndpointState.nodeCounter}-${timestamp}`;
        newNode = {
          id: newNodeId,
          type: nodeType,
          position: { x: 0, y: 0 }, // Will be set by layout
          data: {
            type: nodeType,
            name: "Conditional",
            condition: "true",
            description: "Conditional Logic",
            hasChildren: true, // Conditional nodes can have children
          },
        };
      } else {
        return;
      }

      // Create edge from source to new node
      let newEdge: Edge;
      
      // Check if the source node is a conditional node
      const sourceNode = currentEndpointState.nodes.find(node => node.id === sourceId);
      const isSourceConditional = sourceNode && (sourceNode.data as any).type === 'conditionalNode';
      
      if (isSourceConditional) {
        // For nodes added after conditional nodes, use the stored source handle
        newEdge = {
          id: `connection-${sourceId}-${newNode.id}-${timestamp}`,
          source: sourceId,
          target: newNode.id,
          sourceHandle: currentEndpointState.pendingSourceHandle || "true", // Use stored handle or default to true
          type: "customEdge",
          animated: true,
          style: {
            stroke: "hsl(var(--primary))",
            strokeWidth: 2,
          },
        };
      } else if (nodeType === "conditionalNode") {
        // For conditional nodes being added, connect from the parent's output handle to the conditional node's input handle
        newEdge = {
          id: `connection-${sourceId}-${newNode.id}-${timestamp}`,
          source: sourceId,
          target: newNode.id,
          type: "customEdge",
          animated: true,
          style: {
            stroke: "hsl(var(--primary))",
            strokeWidth: 2,
          },
        };
      } else {
        newEdge = {
          id: `connection-${sourceId}-${newNode.id}-${timestamp}`,
          source: sourceId,
          target: newNode.id,
          type: "customEdge",
          animated: true,
          style: {
            stroke: "hsl(var(--primary))",
            strokeWidth: 2,
          },
        };
      }

      // Add new node and edge
      const updatedNodes = [...currentEndpointState.nodes, newNode];
      const updatedEdges = [...currentEndpointState.edges, newEdge];

      // Apply layout
      const { nodes: layoutedNodes } = getLayoutedElements(updatedNodes, updatedEdges);

      // Update hasChildren for all nodes
      const finalNodes = layoutedNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          hasChildren: hasChildren(node.id, updatedEdges),
        },
      }));

      const updatedEndpointState: EndpointState = {
        ...currentEndpointState,
        nodes: finalNodes,
        edges: updatedEdges,
        nodeCounter: currentEndpointState.nodeCounter + 1,
        // Reset adding state after successful node addition
        isAddingNode: false,
        pendingSourceId: null,
        pendingSourceHandle: undefined,
        // Automatically select the newly added node
        selectedNodeId: newNode.id,
      };

      state.endpoints[state.currentEndpointId] = updatedEndpointState;
      // Reset global selected node type
      state.selectedNodeType = null;
    },

    deleteNode: (state, action: PayloadAction<{ nodeId: string }>) => {
      const { nodeId } = action.payload;

      if (!state.currentEndpointId) {
        return; // No current endpoint, can't delete node
      }

      const currentEndpointState = getEndpointState(state, state.currentEndpointId);

      // Don't allow deleting the endpoint node itself
      if (nodeId === state.currentEndpointId) {
        return;
      }

      // Helper function to recursively find all child nodes
      const findChildNodes = (parentId: string, edges: Edge[]): string[] => {
        const directChildren = edges
          .filter((edge) => edge.source === parentId)
          .map((edge) => edge.target);

        let allChildren = [...directChildren];

        // Recursively find children of children
        directChildren.forEach((childId) => {
          const grandChildren = findChildNodes(childId, edges);
          allChildren = [...allChildren, ...grandChildren];
        });

        return allChildren;
      };

      // Find all child nodes that need to be deleted
      const childNodesToDelete = findChildNodes(nodeId, currentEndpointState.edges);
      const allNodesToDelete = [nodeId, ...childNodesToDelete];

      // Remove the node and all its children
      const updatedNodes = currentEndpointState.nodes.filter(
        (node) => !allNodesToDelete.includes(node.id),
      );

      // Remove all edges connected to any of the deleted nodes
      const updatedEdges = currentEndpointState.edges.filter(
        (edge) =>
          !allNodesToDelete.includes(edge.source) &&
          !allNodesToDelete.includes(edge.target),
      );

      // Apply layout to remaining nodes
      const { nodes: layoutedNodes } = getLayoutedElements(updatedNodes, updatedEdges);

      // Update hasChildren for all remaining nodes
      const finalNodes = layoutedNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          hasChildren: hasChildren(node.id, updatedEdges),
        },
      }));

      const updatedEndpointState: EndpointState = {
        ...currentEndpointState,
        nodes: finalNodes,
        edges: updatedEdges,
        nodeCounter: currentEndpointState.nodeCounter, // Keep counter for consistency
      };

      state.endpoints[state.currentEndpointId] = updatedEndpointState;
    },

    updateNode: (state, action: PayloadAction<{ nodeId: string; data: Partial<NodeData> }>) => {
      const { nodeId, data } = action.payload;

      if (!state.currentEndpointId) {
        return; // No current endpoint, can't update node
      }

      const currentEndpointState = getEndpointState(state, state.currentEndpointId);

      // Find and update the node
      const updatedNodes = currentEndpointState.nodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              ...data,
            } as NodeData & Record<string, unknown>,
          };
        }
        return node;
      });

      const updatedEndpointState: EndpointState = {
        ...currentEndpointState,
        nodes: updatedNodes,
      };

      state.endpoints[state.currentEndpointId] = updatedEndpointState;
    },

    updateViewport: (state, action: PayloadAction<{ viewport: ViewportState }>) => {
      const { viewport } = action.payload;

      if (!state.currentEndpointId) {
        return; // No current endpoint, can't update viewport
      }

      const currentEndpointState = getEndpointState(state, state.currentEndpointId);

      const updatedEndpointState: EndpointState = {
        ...currentEndpointState,
        viewport,
      };

      state.endpoints[state.currentEndpointId] = updatedEndpointState;
    },

    resetWorkbench: (state) => {
      if (!state.currentEndpointId) {
        return;
      }

      // Reset only the current endpoint's state
      const resetEndpointState: EndpointState = {
        nodes: [],
        edges: [],
        nodeCounter: 0,
        ...defaultEndpointState,
      } as EndpointState;

      state.endpoints[state.currentEndpointId] = resetEndpointState;
    },

    loadWorkbenchData: (state, action: PayloadAction<{ endpointId: string; nodes: WorkbenchNode[]; edges: Edge[] }>) => {
      const { endpointId, nodes, edges } = action.payload;
      const existingState = getEndpointState(state, endpointId);

      // Create or update endpoint state with loaded data
      const updatedEndpointState: EndpointState = {
        ...existingState,
        nodes,
        edges,
        isAddingNode: false,
        selectedNodeId: null,
        pendingSourceId: null,
      };

      state.endpoints[endpointId] = updatedEndpointState;
    },

    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(saveWorkbenchToAPI.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(saveWorkbenchToAPI.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.success) {
          state.error = action.payload.error || "Failed to save workbench data";
        }
      })
      .addCase(saveWorkbenchToAPI.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to save workbench data";
      })
      .addCase(loadWorkbenchFromAPI.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(loadWorkbenchFromAPI.fulfilled, (state, action) => {
        state.loading = false;
        if (!action.payload.success) {
          state.error = action.payload.error || "Failed to load workbench data";
        }
      })
      .addCase(loadWorkbenchFromAPI.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to load workbench data";
      });
  },
});

// Export actions
export const {
  setEndpoint,
  startAddNode,
  selectNodeType,
  cancelAddNode,
  selectNode,
  addNode,
  deleteNode,
  updateNode,
  updateViewport,
  resetWorkbench,
  loadWorkbenchData,
  clearError,
} = workbenchSlice.actions;

// Export selectors
export const selectCurrentEndpointState = (state: RootState): EndpointState | null => {
  const workbenchState = state.workbench;
  if (!workbenchState.currentEndpointId) {
    return null;
  }
  return getEndpointState(workbenchState, workbenchState.currentEndpointId);
};

export const selectCurrentEndpointId = (state: RootState): string | null => {
  return state.workbench.currentEndpointId;
};

export const selectSelectedNodeType = (state: RootState): string | null => {
  return state.workbench.selectedNodeType;
};

export const selectWorkbenchLoading = (state: RootState): boolean => {
  return state.workbench.loading;
};

export const selectWorkbenchError = (state: RootState): string | null => {
  return state.workbench.error;
};

// Export layout functions
export { getLayoutedElements, getELKLayoutedElements };

export default workbenchSlice.reducer;
