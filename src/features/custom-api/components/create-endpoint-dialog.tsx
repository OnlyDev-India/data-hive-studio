"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RootState } from "@/redux/store";
import { useDispatch, useSelector } from "react-redux";
import { Plus } from "lucide-react";
import { createEndPoint } from "../utils/data-thunk-func";
import { APIEndpointForm } from "../types/custom-api.type";
import { API_ENDPOINT_DEFAULT_VALUES } from "../config/default-values";

interface CreateEndpointDialogProps {
  connectionName: string;
}

const CreateEndpointDialog: React.FC<CreateEndpointDialogProps> = ({
  connectionName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [endPointForm, setEndPointForm] = useState<APIEndpointForm>(
    API_ENDPOINT_DEFAULT_VALUES,
  );

  const { currentAPI } = useSelector((state: RootState) => state.api);
  const dispatch = useDispatch();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndPointForm({ ...endPointForm, [e.target.name]: e.target.value });
  };
  const handleSelectChange = (key: string, value: string) => {
    setEndPointForm({ ...endPointForm, [key]: value });
  };
  const handleCreateEndpoint = () => {
    if (!currentAPI?.id) {
      return;
    }
    setIsCreating(true);
    endPointForm.fullPath = `${endPointForm.path.startsWith("/") ? "" : "/"}${endPointForm.path}`;
    endPointForm.path = endPointForm.fullPath;
    dispatch(
      createEndPoint({
        connectionId: currentAPI?.connectionId,
        api: endPointForm,
      }) as any,
    );
    setIsCreating(false);
    setEndPointForm(API_ENDPOINT_DEFAULT_VALUES);
    setIsOpen(false);
  };
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant={"outline"}
          className="h-8 w-8 [&_svg]:size-4"
          title="Create Endpoint"
        >
          <Plus />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Endpoint</DialogTitle>
          <DialogDescription>
            Create a new endpoint for {connectionName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="endpoint-name">Endpoint Name</Label>
            <Input
              id="endpoint-name"
              name="name"
              value={endPointForm.name}
              onChange={(e) => handleInputChange(e)}
              placeholder="e.g., Get User Profile"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="endpoint-path">Path</Label>
            <Input
              id="endpoint-path"
              name="path"
              value={endPointForm.path}
              onChange={(e) => handleInputChange(e)}
              placeholder="/api/users/profile"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="endpoint-method">Method</Label>
            <Select
              name="method"
              value={endPointForm.method}
              onValueChange={(value: string) =>
                handleSelectChange("method", value)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="endpoint-description">Description (Optional)</Label>
            <Input
              id="endpoint-description"
              name="description"
              value={endPointForm.description}
              onChange={(e) => handleInputChange(e)}
              placeholder="Enter endpoint description"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateEndpoint}
            disabled={
              !endPointForm.name.trim() ||
              !endPointForm.path.trim() ||
              isCreating
            }
          >
            {isCreating ? "Creating..." : "Create Endpoint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateEndpointDialog;
