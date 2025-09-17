"use client";
import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useWorkbenchRedux } from "../../../hooks/use-workbench-redux";
import { EditBarNodeTypes } from "../../../config/workbench-config";
import { Trash2Icon, XIcon } from "lucide-react";
import NodeTypesList from "./node-types-list";
import DeleteNodeAlert from "./delete-node-alert";

const WorkbenchSidebar: React.FC = () => {
  const {
    cancelAddNode,
    getCurrentIsAddingNode,
    getCurrentSelectedNodeId,
    deleteNode,
    currentEndpointState,
    selectNode,
  } = useWorkbenchRedux();

  // State for delete confirmation modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const currentSelectedNodeId = getCurrentSelectedNodeId();
  const currentSelectedNode = currentEndpointState?.nodes.find(
    (n) => n.id === currentSelectedNodeId,
  );
  const EditForm =
    EditBarNodeTypes[
      currentSelectedNode?.type as keyof typeof EditBarNodeTypes
    ];

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodeToDelete(nodeId);
      setDeleteModalOpen(true);
    },
    [setNodeToDelete, setDeleteModalOpen],
  );

  const handleConfirmDelete = useCallback(() => {
    if (nodeToDelete) {
      deleteNode(nodeToDelete);
      setDeleteModalOpen(false);
      setNodeToDelete(null);
      selectNode(null);
    }
  }, [nodeToDelete, deleteNode]);

  return (
    <div className="h-full w-full overflow-auto border-r border-border">
      <div className="custom-scrollbar scrollbar-gutter relative h-full space-y-4">
        {/* Show Add Node Section */}
        {getCurrentIsAddingNode() && (
          <>
            {/* Instructions */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-secondary py-3 px-2">
              <h4 className="text-sm font-medium text-foreground">Add Node</h4>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={cancelAddNode}
                  className="h-7 w-7 border-border bg-background [&_svg]:size-4"
                >
                  <XIcon />
                </Button>
              </div>
            </div>

            {/* Node Types */}
            <div className="px-3">
              <NodeTypesList />
            </div>
          </>
        )}

        {/* Show Node Editing Section */}
        {EditForm && currentSelectedNodeId && (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-secondary py-3 px-2">
              <h4 className="text-sm font-medium text-foreground">
                Edit {currentSelectedNode?.data.type} Node
              </h4>
              <div className="flex items-center gap-2">
                {currentSelectedNode?.data.type !== "endpointNode" && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleDeleteNode(currentSelectedNodeId)}
                    className="h-7 w-7 border-destructive bg-destructive/10 text-destructive hover:bg-destructive/90 [&_svg]:size-3"
                    style={{
                      borderColor: "hsl(var(--destructive))",
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectNode(null)}
                  className="h-7 w-7 border-border bg-background [&_svg]:size-4"
                >
                  <XIcon />
                </Button>
              </div>
            </div>
            <div className="px-3">
              <EditForm />
            </div>
          </>
        )}

        {/* Status */}
        <div className="border-border pt-2">
          <div className="text-xs text-muted-foreground">
            {!getCurrentIsAddingNode() && !getCurrentSelectedNodeId() && (
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-gray-400"></div>
                <span>Click + on a node to start</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <DeleteNodeAlert
        deleteModalOpen={deleteModalOpen}
        setDeleteModalOpen={setDeleteModalOpen}
        handleConfirmDelete={handleConfirmDelete}
      />
    </div>
  );
};

export default WorkbenchSidebar;
