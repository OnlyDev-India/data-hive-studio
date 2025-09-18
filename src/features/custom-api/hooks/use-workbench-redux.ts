import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "next/navigation";
import { Edge } from "@xyflow/react";
import {
  WorkbenchNode,
  NodeData,
} from "@/features/custom-api/types/custom-api.type";
import { AppDispatch, RootState } from "@/redux/store";
import {
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
  saveWorkbenchToAPI,
  loadWorkbenchFromAPI,
  selectCurrentEndpointState,
  selectCurrentEndpointId,
  selectSelectedNodeType,
  selectWorkbenchLoading,
  selectWorkbenchError,
  getLayoutedElements,
  getELKLayoutedElements,
  ViewportState,
} from "@/features/custom-api/redux/workbench";

export const useWorkbenchRedux = () => {
  const dispatch = useDispatch<AppDispatch>();
  const params = useParams();
  const endpointId = params?.endpointId as string;

  // Selectors
  const currentEndpointState = useSelector(selectCurrentEndpointState);
  const currentEndpointId = useSelector(selectCurrentEndpointId);
  const selectedNodeType = useSelector(selectSelectedNodeType);
  const loading = useSelector(selectWorkbenchLoading);
  const error = useSelector(selectWorkbenchError);

  // Action creators
  const setEndpointAction = useCallback(
    (endpoint: any) => {
      if (endpointId) {
        dispatch(setEndpoint({ endpointId, endpoint }));
      }
    },
    [dispatch, endpointId],
  );

  const startAddNodeAction = useCallback(
    (sourceId: string, sourceHandle?: string) => {
      if (endpointId) {
        dispatch(startAddNode({ sourceId, endpointId, sourceHandle }));
      }
    },
    [dispatch, endpointId],
  );

  const selectNodeTypeAction = useCallback((nodeType: string) => {
    dispatch(selectNodeType({ nodeType }));
  }, [dispatch]);

  const cancelAddNodeAction = useCallback(() => {
    if (endpointId) {
      dispatch(cancelAddNode({ endpointId }));
    }
  }, [dispatch, endpointId]);

  const selectNodeAction = useCallback(
    (nodeId: string | null) => {
      if (endpointId) {
        dispatch(selectNode({ nodeId, endpointId }));
      }
    },
    [dispatch, endpointId],
  );

  const addNodeAction = useCallback((sourceId: string, nodeType: string) => {
    dispatch(addNode({ sourceId, nodeType }));
  }, [dispatch]);

  const deleteNodeAction = useCallback((nodeId: string) => {
    dispatch(deleteNode({ nodeId }));
  }, [dispatch]);

  const updateNodeAction = useCallback((nodeId: string, data: Partial<NodeData>) => {
    dispatch(updateNode({ nodeId, data }));
  }, [dispatch]);

  const updateViewportAction = useCallback((viewport: ViewportState) => {
    dispatch(updateViewport({ viewport }));
  }, [dispatch]);

  const resetWorkbenchAction = useCallback(() => {
    dispatch(resetWorkbench());
  }, [dispatch]);

  // Helper functions to get current endpoint state
  const getCurrentIsAddingNode = useCallback(() => {
    return currentEndpointState?.isAddingNode || false;
  }, [currentEndpointState]);

  const getCurrentSelectedNodeId = useCallback(() => {
    return currentEndpointState?.selectedNodeId || null;
  }, [currentEndpointState]);

  const selectedNode = useCallback(() => {
    const selectedNodeId = getCurrentSelectedNodeId();
    if (!selectedNodeId || !currentEndpointState) return null;
    return currentEndpointState.nodes.find(node => node.id === selectedNodeId) || null;
  }, [currentEndpointState, getCurrentSelectedNodeId]);

  const getCurrentPendingSourceId = useCallback(() => {
    return currentEndpointState?.pendingSourceId || null;
  }, [currentEndpointState]);

  const selectAndAddNode = useCallback(
    (nodeType: string) => {
      const pendingSourceId = getCurrentPendingSourceId();
      if (pendingSourceId) {
        // Map node type IDs to data types
        dispatch(addNode({
          sourceId: pendingSourceId,
          nodeType: nodeType as any,
        }));
      }
    },
    [dispatch, getCurrentPendingSourceId],
  );

  // Layout functions
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
  const saveWorkbenchToAPIAction = useCallback(
    async (
      endpointId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      const result = await dispatch(saveWorkbenchToAPI(endpointId));
      
      if (saveWorkbenchToAPI.fulfilled.match(result)) {
        return result.payload;
      } else {
        return { success: false, error: "Failed to save workbench data" };
      }
    },
    [dispatch],
  );

  // Load workbench data from API details
  const loadWorkbenchFromAPIAction = useCallback(
    async (
      endpointId: string,
    ): Promise<{ success: boolean; error?: string }> => {
      const result = await dispatch(loadWorkbenchFromAPI(endpointId));
      
      if (loadWorkbenchFromAPI.fulfilled.match(result)) {
        return result.payload;
      } else {
        return { success: false, error: "Failed to load workbench data" };
      }
    },
    [dispatch],
  );

  return {
    // State
    currentEndpointState,
    currentEndpointId,
    selectedNodeType,
    loading,
    error,
    
    // Actions
    setEndpoint: setEndpointAction,
    startAddNode: startAddNodeAction,
    selectNodeType: selectNodeTypeAction,
    selectAndAddNode,
    addNode: addNodeAction,
    cancelAddNode: cancelAddNodeAction,
    selectNode: selectNodeAction,
    deleteNode: deleteNodeAction,
    updateNode: updateNodeAction,
    updateViewport: updateViewportAction,
    resetWorkbench: resetWorkbenchAction,
    
    // Layout functions
    getLayoutedElements: getLayoutedElementsCallback,
    getELKLayoutedElements: getELKLayoutedElementsCallback,
    
    // Helper functions
    getCurrentIsAddingNode,
    getCurrentSelectedNodeId,
    selectedNode,
    getCurrentPendingSourceId,
    
    // Save and load
    saveWorkbenchToAPI: saveWorkbenchToAPIAction,
    loadWorkbenchFromAPI: loadWorkbenchFromAPIAction,
  };
};
