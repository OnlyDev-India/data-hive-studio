import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  ReactNode
} from "react";
import { Edge } from "@xyflow/react";
import ELK from "elkjs";
import { useParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import {
  WorkbenchNode,
  NodeData,
} from "@/features/custom-api/types/custom-api.type";
import { updateCurrentAPI } from "@/features/custom-api/utils/data-thunk-func";
import { AppDispatch } from "@/redux/store";

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
}

// Actions
type WorkbenchAction =
  | {
      type: "SET_ENDPOINT";
      payload: {
        endpointId: string;
        endpoint: any;
      };
    }
  | {
      type: "START_ADD_NODE";
      payload: { sourceId: string; endpointId: string; sourceHandle?: string };
    }
  | { type: "SELECT_NODE_TYPE"; payload: { nodeType: string } }
  | {
      type: "ADD_NODE";
      payload: {
        sourceId: string;
        nodeType: string;
      };
    }
  | { type: "CANCEL_ADD_NODE"; payload: { endpointId: string } }
  | {
      type: "SELECT_NODE";
      payload: { nodeId: string | null; endpointId: string };
    }
  | { type: "DELETE_NODE"; payload: { nodeId: string } }
  | {
      type: "UPDATE_NODE";
      payload: { nodeId: string; data: Partial<NodeData> };
    }
  | { type: "UPDATE_VIEWPORT"; payload: { viewport: ViewportState } }
  | { type: "RESET_WORKBENCH" }
  | {
      type: "LOAD_WORKBENCH_DATA";
      payload: { endpointId: string; nodes: WorkbenchNode[]; edges: Edge[] };
    };

// Initial state
const initialState: WorkbenchState = {
  endpoints: {},
  currentEndpointId: null,
  selectedNodeType: null,
};

// ELK.js configuration
const elk = new ELK();

// Helper function to apply ELK layout
const getLayoutedElements = (nodes: WorkbenchNode[], edges: Edge[]) => {
  // Convert nodes to ELK format
  // const elkNodes = nodes.map((node) => {
  //   const nodeData = node.data as any;
  //   const isConditional = nodeData?.type === 'conditionalNode';
    
  //   // Get outgoing edges to determine if we need extra spacing
  //   const outgoingEdges = edges.filter(edge => edge.source === node.id);
  //   const hasMultipleOutgoing = outgoingEdges.length > 1;
    
  //   return {
  //     id: node.id,
  //     width: 200,
  //     height: isConditional ? 140 : 100, // Taller for conditional nodes
  //     layoutOptions: {
  //       'elk.priority': hasMultipleOutgoing ? '1' : '0', // Higher priority for nodes with multiple edges
  //       'elk.spacing.nodeNode': '40', // Spacing between nodes
  //       'elk.spacing.edgeNode': '20', // Spacing between edges and nodes
  //     },
  //     // Add ports for conditional nodes
  //     ...(isConditional && {
  //       ports: [
  //         {
  //           id: 'input',
  //           width: 8,
  //           height: 8,
  //           properties: {
  //             'port.side': 'WEST',
  //             'port.index': '0',
  //             'port.anchor': 'CENTER'
  //           }
  //         },
  //         {
  //           id: 'true',
  //           width: 8,
  //           height: 8,
  //           properties: {
  //             'port.side': 'EAST',
  //             'port.index': '0',
  //             'port.anchor': 'CENTER'
  //           }
  //         },
  //         {
  //           id: 'false',
  //           width: 8,
  //           height: 8,
  //           properties: {
  //             'port.side': 'EAST',
  //             'port.index': '1',
  //             'port.anchor': 'CENTER'
  //           }
  //         }
  //       ]
  //     })
  //   };
  // });

  // // Convert edges to ELK format
  // const elkEdges = edges.map((edge) => {
  //   const sourceNode = nodes.find(n => n.id === edge.source);
  //   const sourceNodeData = sourceNode?.data as any;
  //   const isFromConditional = sourceNodeData?.type === 'conditionalNode';
    
  //   return {
  //     id: edge.id,
  //     sources: [edge.source],
  //     targets: [edge.target],
  //     // Add port information for conditional nodes
  //     ...(isFromConditional && edge.sourceHandle && {
  //       sources: [`${edge.source}:${edge.sourceHandle}`],
  //       targets: [`${edge.target}:input`]
  //     }),
  //     layoutOptions: {
  //       'elk.edgeRouting': 'ORTHOGONAL',
  //       'elk.spacing.edgeEdge': '20', // Spacing between parallel edges
  //       'elk.edge.priority': edge.sourceHandle === 'true' ? '1' : '0', // True edges get higher priority
  //     }
  //   };
  // });

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

  // Convert edges to ELK format with proper port connections
  const elkEdges = edges.map((edge) => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    const sourceNodeData = sourceNode?.data as any;
    const targetNodeData = targetNode?.data as any;
    const isFromConditional = sourceNodeData?.type === 'conditionalNode';
    const isToConditional = targetNodeData?.type === 'conditionalNode';
    
    // Build source and target with port information
    let sources = [edge.source];
    let targets = [edge.target];
    
    // Add source port for all nodes
    if (isFromConditional && edge.sourceHandle) {
      sources = [`${edge.source}:${edge.sourceHandle}`];
    } else {
      sources = [`${edge.source}:output`];
    }
    
    // Add target port for all nodes (use input port)
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
        // Force vertical positioning for conditional edges
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
    // Apply ELK layout
    const layoutedGraph = await elk.layout(elkGraph);
    
    // Convert back to React Flow format
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
    // Fallback to simple layout
    return getLayoutedElements(nodes, edges);
  }
};

// Helper function to check if a node has children
const hasChildren = (nodeId: string, edges: Edge[]) => {
  return edges.some((edge) => edge.source === nodeId);
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

// Reducer
const workbenchReducer = (
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState => {
  switch (action.type) {
    case "SET_ENDPOINT": {
      const { endpointId, endpoint } = action.payload;

      // Get existing endpoint state or create new one
      const existingState = getEndpointState(state, endpointId);

      // If endpoint already has nodes, just switch to it
      if (existingState.nodes.length > 0) {
        return {
          ...state,
          currentEndpointId: endpointId,
          selectedNodeType: null, // Clear global selected node type when switching endpoints
        };
      }

      // Create endpoint node for new endpoint
      const endpointNode: WorkbenchNode = {
        id: endpointId,
        type: "endpointNode",
        position: { x: 100, y: 200 },
        data: {
          type: "endpointNode",
          endpoint,
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

      return {
        ...state,
        currentEndpointId: endpointId,
        selectedNodeType: null, // Clear global selected node type when creating new endpoint
        endpoints: {
          ...state.endpoints,
          [endpointId]: newEndpointState,
        },
      };
    }

    case "START_ADD_NODE": {
      const { sourceId, endpointId, sourceHandle } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        isAddingNode: true,
        pendingSourceId: sourceId,
        pendingSourceHandle: sourceHandle, // Store which handle was clicked
        selectedNodeId: null, // Clear selection when starting to add
      };

      return {
        ...state,
        currentEndpointId: endpointId,
        endpoints: {
          ...state.endpoints,
          [endpointId]: updatedEndpointState,
        },
      };
    }

    case "SELECT_NODE_TYPE": {
      const { nodeType } = action.payload;
      return {
        ...state,
        selectedNodeType: nodeType,
      };
    }

    case "CANCEL_ADD_NODE": {
      const { endpointId } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        isAddingNode: false,
        pendingSourceId: null,
        pendingSourceHandle: undefined,
      };

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [endpointId]: updatedEndpointState,
        },
      };
    }

    case "SELECT_NODE": {
      const { nodeId, endpointId } = action.payload;

      const currentEndpointState = getEndpointState(state, endpointId);
      const updatedEndpointState = {
        ...currentEndpointState,
        selectedNodeId: nodeId,
        isAddingNode: false, // Clear adding state when selecting node
        pendingSourceId: null,
      };

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [endpointId]: updatedEndpointState,
        },
      };
    }

    case "ADD_NODE": {
      const { sourceId, nodeType } = action.payload;

      if (!state.currentEndpointId) {
        return state; // No current endpoint, can't add node
      }

      const currentEndpointState = getEndpointState(
        state,
        state.currentEndpointId,
      );
      const timestamp = Date.now();

      let newNode: WorkbenchNode;

      if (nodeType === "responseNode") {
        // Create response node
        const newNodeId = `response-node-${currentEndpointState.nodeCounter}-${timestamp}`;
        newNode = {
          id: newNodeId,
          type: nodeType,
          position: { x: 0, y: 0 }, // Will be set by Dagre
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
          position: { x: 0, y: 0 }, // Will be set by Dagre
          data: {
            type: nodeType,
            name: "Conditional",
            condition: "true",
            description: "Conditional Logic",
            hasChildren: true, // Conditional nodes can have children
          },
        };
      } else {
        return state;
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

      // Apply ELK layout
      const { nodes: layoutedNodes } = getLayoutedElements(
        updatedNodes,
        updatedEdges,
      );

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

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [state.currentEndpointId]: updatedEndpointState,
        },
        // Reset global selected node type
        selectedNodeType: null,
      };
    }

    case "DELETE_NODE": {
      const { nodeId } = action.payload;

      if (!state.currentEndpointId) {
        return state; // No current endpoint, can't delete node
      }

      const currentEndpointState = getEndpointState(
        state,
        state.currentEndpointId,
      );

      // Don't allow deleting the endpoint node itself
      if (nodeId === state.currentEndpointId) {
        return state;
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
      const childNodesToDelete = findChildNodes(
        nodeId,
        currentEndpointState.edges,
      );
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

      // Apply ELK layout to remaining nodes
      const { nodes: layoutedNodes } = getLayoutedElements(
        updatedNodes,
        updatedEdges,
      );

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

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [state.currentEndpointId]: updatedEndpointState,
        },
      };
    }

    case "UPDATE_NODE": {
      const { nodeId, data } = action.payload;

      if (!state.currentEndpointId) {
        return state; // No current endpoint, can't update node
      }

      const currentEndpointState = getEndpointState(
        state,
        state.currentEndpointId,
      );

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

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [state.currentEndpointId]: updatedEndpointState,
        },
      };
    }

    case "UPDATE_VIEWPORT": {
      const { viewport } = action.payload;

      if (!state.currentEndpointId) {
        return state; // No current endpoint, can't update viewport
      }

      const currentEndpointState = getEndpointState(
        state,
        state.currentEndpointId,
      );

      const updatedEndpointState: EndpointState = {
        ...currentEndpointState,
        viewport,
      };

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [state.currentEndpointId]: updatedEndpointState,
        },
      };
    }

    case "RESET_WORKBENCH":
      if (!state.currentEndpointId) {
        return state;
      }

      // Reset only the current endpoint's state
      const resetEndpointState: EndpointState = {
        nodes: [],
        edges: [],
        nodeCounter: 0,
        ...defaultEndpointState,
      } as EndpointState;

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [state.currentEndpointId]: resetEndpointState,
        },
      };

    case "LOAD_WORKBENCH_DATA": {
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

      return {
        ...state,
        endpoints: {
          ...state.endpoints,
          [endpointId]: updatedEndpointState,
        },
      };
    }

    default:
      return state;
  }
};

// Context
interface WorkbenchContextType {
  state: WorkbenchState;
  currentEndpointState: EndpointState | null;
  setEndpoint: (endpoint: any) => void;
  startAddNode: (sourceId: string, sourceHandle?: string) => void;
  selectNodeType: (nodeType: string) => void;
  selectAndAddNode: (nodeType: string) => void;
  addNode: (sourceId: string, nodeType: string) => void;
  cancelAddNode: () => void;
  selectNode: (nodeId: string | null) => void;
  deleteNode: (nodeId: string) => void;
  updateNode: (nodeId: string, data: Partial<NodeData>) => void;
  updateViewport: (viewport: ViewportState) => void;
  resetWorkbench: () => void;
  getLayoutedElements: (
    nodes: WorkbenchNode[],
    edges: Edge[],
  ) => { nodes: WorkbenchNode[]; edges: Edge[] };
  getELKLayoutedElements: (
    nodes: WorkbenchNode[],
    edges: Edge[],
  ) => Promise<{ nodes: WorkbenchNode[]; edges: Edge[] }>;
  // Helper functions to get current endpoint state
  getCurrentIsAddingNode: () => boolean;
  getCurrentSelectedNodeId: () => string | null;
  getCurrentPendingSourceId: () => string | null;
  // Save and load workbench data
  saveWorkbenchToAPI: (
    endpointId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  loadWorkbenchFromAPI: (
    endpointId: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

const WorkbenchContext = createContext<WorkbenchContextType | undefined>(
  undefined,
);

// Provider
interface WorkbenchProviderProps {
  children: ReactNode;
}

export const WorkbenchProvider: React.FC<WorkbenchProviderProps> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(workbenchReducer, initialState);
  const reduxDispatch = useDispatch<AppDispatch>();
  const { currentAPI } = useSelector((state: any) => state.api);
  const params = useParams();
  const endpointId = params?.endpointId as string;

  // Get current endpoint state
  const currentEndpointState = state.currentEndpointId
    ? getEndpointState(state, state.currentEndpointId)
    : null;

  const setEndpoint = useCallback(
    (endpoint: any) => {
      if (endpointId) {
        dispatch({
          type: "SET_ENDPOINT",
          payload: { endpointId, endpoint },
        });
      }
    },
    [endpointId],
  );

  const startAddNode = useCallback(
    (sourceId: string, sourceHandle?: string) => {
      if (endpointId) {
        dispatch({ type: "START_ADD_NODE", payload: { sourceId, endpointId, sourceHandle } });
      }
    },
    [endpointId],
  );

  const selectNodeType = useCallback((nodeType: string) => {
    dispatch({ type: "SELECT_NODE_TYPE", payload: { nodeType } });
  }, []);

  // Helper functions to get current endpoint state
  const getCurrentIsAddingNode = useCallback(() => {
    return currentEndpointState?.isAddingNode || false;
  }, [currentEndpointState]);

  const getCurrentSelectedNodeId = useCallback(() => {
    return currentEndpointState?.selectedNodeId || null;
  }, [currentEndpointState]);

  const getCurrentPendingSourceId = useCallback(() => {
    return currentEndpointState?.pendingSourceId || null;
  }, [currentEndpointState]);

  const selectAndAddNode = useCallback(
    (nodeType: string) => {
      const pendingSourceId = getCurrentPendingSourceId();
      if (pendingSourceId) {
        // Map node type IDs to data types
        dispatch({
          type: "ADD_NODE",
          payload: {
            sourceId: pendingSourceId,
            nodeType: nodeType as any,
          },
        });
      }
    },
    [getCurrentPendingSourceId],
  );

  const addNode = useCallback((sourceId: string, nodeType: string) => {
    dispatch({
      type: "ADD_NODE",
      payload: { sourceId, nodeType },
    });
  }, []);

  const cancelAddNode = useCallback(() => {
    if (endpointId) {
      dispatch({ type: "CANCEL_ADD_NODE", payload: { endpointId } });
    }
  }, [endpointId]);

  const selectNode = useCallback(
    (nodeId: string | null) => {
      if (endpointId) {
        dispatch({ type: "SELECT_NODE", payload: { nodeId, endpointId } });
      }
    },
    [endpointId],
  );

  const deleteNode = useCallback((nodeId: string) => {
    dispatch({ type: "DELETE_NODE", payload: { nodeId } });
  }, []);

  const updateNode = useCallback((nodeId: string, data: Partial<NodeData>) => {
    dispatch({ type: "UPDATE_NODE", payload: { nodeId, data } });
  }, []);

  const updateViewport = useCallback((viewport: ViewportState) => {
    dispatch({ type: "UPDATE_VIEWPORT", payload: { viewport } });
  }, []);

  const resetWorkbench = useCallback(() => {
    dispatch({ type: "RESET_WORKBENCH" });
  }, []);

  const getLayoutedElementsCallback = useCallback(
    (nodes: WorkbenchNode[], edges: Edge[]) => {
      return getLayoutedElements(nodes, edges);
    },
    [],
  );

  const getELKLayoutedElementsCallback = useCallback(
    async (nodes: WorkbenchNode[], edges: Edge[]) => {
      return await getELKLayoutedElements(nodes, edges);
    },
    [],
  );

  // Save workbench data to API details
  const saveWorkbenchToAPI = useCallback(
    async (
      endpointId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      if (!currentEndpointState || !currentAPI) {
        return { success: false, error: "No current endpoint state or API" };
      }

      try {
        // Find the endpoint in the current API
        const endpointIndex = currentAPI.endpoints.findIndex(
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
          ...currentAPI,
          endpoints: currentAPI.endpoints.map((endpoint: any, index: number) =>
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
        const result = await reduxDispatch(updateCurrentAPI(updatedAPI));

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
    },
    [currentEndpointState, currentAPI, reduxDispatch],
  );

  // Load workbench data from API details
  const loadWorkbenchFromAPI = useCallback(
    async (
      endpointId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!currentAPI) {
          return { success: false, error: "No current API" };
        }

        // Find the endpoint in the current API
        const endpoint = currentAPI.endpoints.find(
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

        // First set the current endpoint ID
        dispatch({
          type: "SET_ENDPOINT",
          payload: { endpointId, endpoint },
        });

        // Then update the current endpoint state with loaded data
        dispatch({
          type: "LOAD_WORKBENCH_DATA",
          payload: {
            endpointId,
            nodes,
            edges,
          },
        });

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
    },
    [currentAPI],
  );

  const value: WorkbenchContextType = {
    state,
    currentEndpointState,
    setEndpoint,
    startAddNode,
    selectNodeType,
    selectAndAddNode,
    addNode,
    cancelAddNode,
    selectNode,
    deleteNode,
    updateNode,
    updateViewport,
    resetWorkbench,
    getLayoutedElements: getLayoutedElementsCallback,
    getELKLayoutedElements: getELKLayoutedElementsCallback,
    getCurrentIsAddingNode,
    getCurrentSelectedNodeId,
    getCurrentPendingSourceId,
    saveWorkbenchToAPI,
    loadWorkbenchFromAPI,
  };

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
};

// Custom hook
export const useWorkbench = (): WorkbenchContextType => {
  const context = useContext(WorkbenchContext);
  if (context === undefined) {
    throw new Error("useWorkbench must be used within a WorkbenchProvider");
  }
  return context;
};

export default WorkbenchContext;
