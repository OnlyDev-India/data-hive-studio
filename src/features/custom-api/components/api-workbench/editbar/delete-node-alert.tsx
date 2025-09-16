import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const DeleteNodeAlert = ({
  deleteModalOpen,
  setDeleteModalOpen,
  handleConfirmDelete,
}: {
  deleteModalOpen: boolean;
  setDeleteModalOpen: (open: boolean) => void;
  handleConfirmDelete: () => void;
}) => {
  return (
    <AlertDialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Node</AlertDialogTitle>
          <AlertDialogDescription>
            This node has child nodes. Deleting it will also delete all its
            child nodes and their connections. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteNodeAlert;
