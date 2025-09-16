import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkbench } from "@/features/custom-api/context";
import { ConditionalNodeData } from "@/features/custom-api/types/custom-api.type";

const conditionalNodeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  condition: z.string().min(1, "Condition is required"),
});

type ConditionalNodeFormData = z.infer<typeof conditionalNodeSchema>;

const ConditionalNodeEdit: React.FC = () => {
  const { getCurrentSelectedNodeId, currentEndpointState, updateNode } = useWorkbench()

  const selectedNodeId = getCurrentSelectedNodeId();
  const selectedNode = currentEndpointState?.nodes.find(
    (node) => node.id === selectedNodeId
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    reset,
  } = useForm<ConditionalNodeFormData>({
    resolver: zodResolver(conditionalNodeSchema),
    defaultValues: {
      name: (selectedNode?.data as ConditionalNodeData)?.name || "Conditional",
      description: (selectedNode?.data as ConditionalNodeData)?.description || "",
      condition: (selectedNode?.data as ConditionalNodeData)?.condition || "",
    },
    mode: "onChange",
  });

  // Reset form when selected node changes
  useEffect(() => {
    if (selectedNode) {
      const nodeData = selectedNode.data as ConditionalNodeData;
      reset({
        name: nodeData?.name || "Conditional",
        description: nodeData?.description || "",
        condition: nodeData?.condition || "",
      });
    }
  }, [selectedNode, reset]);

  const onSubmit = (data: ConditionalNodeFormData) => {
    if (selectedNodeId && updateNode) {
      updateNode(selectedNodeId, {
        ...selectedNode?.data,
        ...data,
      });
    }
  };

  if (!selectedNode) {
    return <div>No node selected</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-sm font-medium">
          Node Name
        </Label>
        <Input
          id="name"
          {...register("name")}
          placeholder="Enter node name"
          className="w-full"
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description" className="text-sm font-medium">
          Description
        </Label>
        <Textarea
          id="description"
          {...register("description")}
          placeholder="Enter description (optional)"
          className="w-full min-h-16"
        />
        {errors.description && (
          <p className="text-xs text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="condition" className="text-sm font-medium">
          Condition
        </Label>
        <Textarea
          id="condition"
          {...register("condition")}
          placeholder="Enter condition (e.g., user.role === 'admin')"
          className="w-full min-h-20"
        />
        {errors.condition && (
          <p className="text-xs text-destructive">{errors.condition.message}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Use JavaScript expressions. Access data with: params, query, body, headers
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Output Paths</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-green-600">True Path</Label>
            <div className="text-xs text-muted-foreground">
              When condition is true
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-red-600">False Path</Label>
            <div className="text-xs text-muted-foreground">
              When condition is false
            </div>
          </div>
        </div>
      </div>

      <Button
        type="submit"
        disabled={!isValid}
        className="w-full"
        size="sm"
      >
        Update Conditional Node
      </Button>
    </form>
  );
};

export default ConditionalNodeEdit;
