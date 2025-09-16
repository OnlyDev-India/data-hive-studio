# Adding New Node Types to the API Workbench Flow

This guide explains how to add new node types to the API workbench flow system. The system is designed to be extensible, allowing you to create custom nodes for specific business logic.

## Overview

The API workbench uses a node-based flow system where each node represents a specific operation or logic step. Currently supported node types:

- **Endpoint Node**: Entry point that defines API parameters, headers, and body
- **Response Node**: Exit point that returns data and status codes
- **Conditional Node**: Branching logic based on conditions

## Step-by-Step Guide to Add a New Node Type

### 1. Define the Node Data Type

First, add your new node data interface to the type definitions:

**File**: `src/features/custom-api/types/custom-api.type.ts`

```typescript
// Add your new node data interface
export interface YourNewNodeData extends BaseNodeData {
  type: 'yourNewNode';
  // Add your specific properties
  customProperty: string;
  anotherProperty?: number;
}

// Update the NodeData union type
export type NodeData = EndpointNodeData | ResponseNodeData | ConditionalNodeData | YourNewNodeData;
```

### 2. Create the Node Component

Create a new React component for your node:

**File**: `src/features/custom-api/components/api-workbench/nodes/your-new-node.tsx`

```typescript
import React from "react";
import { Handle, Position } from "@xyflow/react";
import { BaseNode } from "./base-node";
import { YourNewNodeData } from "@/features/custom-api/types/custom-api.type";

interface YourNewNodeProps {
  id: string;
  data: YourNewNodeData;
  selected?: boolean;
}

const YourNewNode: React.FC<YourNewNodeProps> = ({ id, data, selected }) => {
  return (
    <BaseNode
      id={id}
      data={data}
      selected={selected}
      className="border-blue-500 bg-blue-50"
    >
      {/* Add your custom content here */}
      <div className="p-2">
        <h3 className="font-semibold text-blue-900">{data.name}</h3>
        <p className="text-sm text-blue-700">{data.description}</p>
        <div className="mt-2 text-xs text-blue-600">
          Custom: {data.customProperty}
        </div>
      </div>

      {/* Add input handle */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-blue-500"
      />

      {/* Add output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-blue-500"
      />
    </BaseNode>
  );
};

export default YourNewNode;
```

### 3. Create the Edit Component

Create a form component for editing your node's properties:

**File**: `src/features/custom-api/components/api-workbench/editbar/your-new-node-edit.tsx`

```typescript
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkbench } from "@/features/custom-api/context";
import { YourNewNodeData } from "@/features/custom-api/types/custom-api.type";

const yourNewNodeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  customProperty: z.string().min(1, "Custom property is required"),
  anotherProperty: z.number().optional(),
});

type YourNewNodeFormData = z.infer<typeof yourNewNodeSchema>;

const YourNewNodeEdit: React.FC = () => {
  const { getCurrentSelectedNodeId, currentEndpointState, updateNode } = useWorkbench();

  const selectedNodeId = getCurrentSelectedNodeId();
  const selectedNode = currentEndpointState?.nodes.find(
    (node) => node.id === selectedNodeId
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<YourNewNodeFormData>({
    resolver: zodResolver(yourNewNodeSchema),
    defaultValues: {
      name: (selectedNode?.data as YourNewNodeData)?.name || "Your New Node",
      description: (selectedNode?.data as YourNewNodeData)?.description || "",
      customProperty: (selectedNode?.data as YourNewNodeData)?.customProperty || "",
      anotherProperty: (selectedNode?.data as YourNewNodeData)?.anotherProperty || 0,
    },
    mode: "onChange",
  });

  // Reset form when selected node changes
  useEffect(() => {
    if (selectedNode) {
      const nodeData = selectedNode.data as YourNewNodeData;
      reset({
        name: nodeData?.name || "Your New Node",
        description: nodeData?.description || "",
        customProperty: nodeData?.customProperty || "",
        anotherProperty: nodeData?.anotherProperty || 0,
      });
    }
  }, [selectedNode, reset]);

  const onSubmit = (data: YourNewNodeFormData) => {
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
        <Label htmlFor="customProperty" className="text-sm font-medium">
          Custom Property
        </Label>
        <Input
          id="customProperty"
          {...register("customProperty")}
          placeholder="Enter custom property"
          className="w-full"
        />
        {errors.customProperty && (
          <p className="text-xs text-destructive">{errors.customProperty.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="anotherProperty" className="text-sm font-medium">
          Another Property
        </Label>
        <Input
          id="anotherProperty"
          type="number"
          {...register("anotherProperty", { valueAsNumber: true })}
          placeholder="Enter number"
          className="w-full"
        />
        {errors.anotherProperty && (
          <p className="text-xs text-destructive">{errors.anotherProperty.message}</p>
        )}
      </div>

      <Button
        type="submit"
        disabled={!isValid}
        className="w-full"
        size="sm"
      >
        Update Your New Node
      </Button>
    </form>
  );
};

export default YourNewNodeEdit;
```

### 4. Update Workbench Configuration

Add your new node type to the workbench configuration:

**File**: `src/features/custom-api/config/workbench-config.ts`

```typescript
// Import your new components
import YourNewNode from "@/features/custom-api/components/api-workbench/nodes/your-new-node";
import YourNewNodeEdit from "@/features/custom-api/components/api-workbench/editbar/your-new-node-edit";
import { YourIcon } from "lucide-react"; // Choose an appropriate icon

// Add to nodeTypes object
export const nodeTypes = {
  endpointNode: EndpointNode,
  responseNode: ResponseNode,
  conditionalNode: ConditionalNode,
  yourNewNode: YourNewNode, // Add your node
};

// Add to EditBarNodeTypes object
export const EditBarNodeTypes = {
  endpointNode: EndpointFlowTester,
  responseNode: ResponseNodeEdit,
  conditionalNode: ConditionalNodeEdit,
  yourNewNode: YourNewNodeEdit, // Add your edit component
};

// Add to AVAILABLE_NODE_TYPES array
export const AVAILABLE_NODE_TYPES = [
  {
    id: "endpointNode",
    name: "Endpoint Node",
    description: "API endpoint definition",
    icon: GlobeIcon,
  },
  {
    id: "responseNode",
    name: "Response Node",
    description: "API response definition",
    icon: FileTextIcon,
  },
  {
    id: "conditionalNode",
    name: "Conditional Node",
    description: "Conditional logic branching",
    icon: GitBranchIcon,
  },
  {
    id: "yourNewNode",
    name: "Your New Node",
    description: "Your custom node description",
    icon: YourIcon, // Add your icon
  },
];

// Add to nodeTypeIcons object
export const nodeTypeIcons = {
  endpointNode: {
    name: "Endpoint Node",
    description: "Endpoint Node",
    icon: GlobeIcon,
  },
  responseNode: {
    name: "Response Node",
    description: "Response Node",
    icon: FileTextIcon,
  },
  conditionalNode: {
    name: "Conditional Node",
    description: "Conditional Node",
    icon: GitBranchIcon,
  },
  yourNewNode: {
    name: "Your New Node",
    description: "Your New Node",
    icon: YourIcon, // Add your icon
  },
};
```

### 5. Update Node Exports

Export your new node component:

**File**: `src/features/custom-api/components/api-workbench/nodes/index.ts`

```typescript
export { default as EndpointNode } from "./endpoint-node";
export { default as ResponseNode } from "./response-node";
export { default as ConditionalNode } from "./conditional-node";
export { default as YourNewNode } from "./your-new-node"; // Add your export
```

### 6. Update Workbench Context (if needed)

If your node has special creation logic, update the workbench context:

**File**: `src/features/custom-api/context/workbench-context.tsx`

```typescript
// In the ADD_NODE reducer case, add your node type
else if (nodeType === "yourNewNode") {
  const newNodeId = `your-new-node-${currentEndpointState.nodeCounter}-${timestamp}`;
  newNode = {
    id: newNodeId,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      type: nodeType,
      name: "Your New Node",
      description: "Your custom node",
      customProperty: "default value", // Add your default values
      anotherProperty: 0,
      hasChildren: true, // Set based on your node's behavior
    },
  };
}
```

### 7. Update Flow Executor (if needed)

If your node needs to be processed during flow execution, update the flow executor:

**File**: `src/features/custom-api/components/api-workbench/flow-executor/endpoint-flow-executor.ts`

```typescript
// Import your node data type
import { YourNewNodeData } from "@/features/custom-api/types/custom-api.type";

// In the processNode method, add your case
case 'yourNewNode':
  return await this.processYourNewNode(node);

// Add your processing method
private async processYourNewNode(node: WorkbenchNode): Promise<{ input?: any; output?: any }> {
  const yourNewData = node.data as YourNewNodeData;
  const input = { ...this.context };

  try {
    // Add your custom processing logic here
    const result = await this.executeYourCustomLogic(yourNewData, input);
    
    // Update context if needed
    this.context = { ...this.context, ...result };
    
    return {
      input,
      output: {
        message: 'Your new node processed successfully',
        result: result,
        customProperty: yourNewData.customProperty,
      }
    };
  } catch (error) {
    console.error('Error processing your new node:', error);
    return {
      input,
      output: {
        message: 'Error processing your new node',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    };
  }
}

// Add your custom logic method
private async executeYourCustomLogic(nodeData: YourNewNodeData, context: any): Promise<any> {
  // Implement your custom business logic here
  // This could involve:
  // - API calls
  // - Data transformations
  // - External service integrations
  // - Database operations
  // etc.
  
  return {
    processedData: "Your processed result",
    customProperty: nodeData.customProperty,
  };
}
```

## Advanced Features

### Custom Handles

If your node needs multiple input/output handles (like the conditional node), you can use the `CustomHandle` component:

```typescript
import { CustomHandle } from "@/features/custom-api/components/api-workbench/custom/custom-handle";

// In your node component
<CustomHandle
  hasChildren={hasChildrenForThisHandle}
  nodeId={id as string}
  handleId="customHandle1"
  handleType="custom"
  style={{ top: "30%" }}
  disableAddButton={hasChildrenForThisHandle}
/>
```

### Node Validation

Add custom validation logic in your edit component:

```typescript
const yourNewNodeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  customProperty: z.string().min(1, "Custom property is required")
    .refine((val) => val.includes("required"), {
      message: "Custom property must contain 'required'",
    }),
});
```

### Conditional Node Creation

If your node should only be available under certain conditions, update the node types list:

```typescript
// In node-types-list.tsx
const checkCanAddYourNewNode = (nodeType: string) => {
  if (nodeType !== 'yourNewNode') return false;
  
  // Add your custom logic here
  const currentEndpointState = state.currentEndpointId
    ? state.endpoints[state.currentEndpointId]
    : null;
  
  // Example: Only allow if parent is an endpoint node
  if (!currentEndpointState || !currentEndpointState.pendingSourceId) return false;
  
  const parentNode = currentEndpointState.nodes.find(
    node => node.id === currentEndpointState.pendingSourceId
  );
  
  return parentNode?.type === 'endpointNode';
};
```

## Testing Your New Node

1. **Create the node**: Add your new node type to the workbench
2. **Edit properties**: Click on the node and verify the edit form works
3. **Test flow execution**: Use the endpoint flow tester to verify your node processes correctly
4. **Check persistence**: Save and reload the workbench to ensure your node data persists

## Best Practices

1. **Follow naming conventions**: Use descriptive names for your node types and components
2. **Add proper TypeScript types**: Ensure all your interfaces are properly typed
3. **Handle errors gracefully**: Add proper error handling in your flow execution logic
4. **Provide clear documentation**: Add helpful descriptions and placeholder text
5. **Test thoroughly**: Verify your node works in all scenarios (creation, editing, execution, persistence)
6. **Use consistent styling**: Follow the existing design patterns for visual consistency

## Example: Database Query Node

Here's a complete example of adding a database query node:

```typescript
// 1. Type definition
export interface DatabaseQueryNodeData extends BaseNodeData {
  type: 'databaseQueryNode';
  query: string;
  connectionString: string;
  timeout?: number;
}

// 2. Node component
const DatabaseQueryNode: React.FC<DatabaseQueryNodeProps> = ({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} selected={selected} className="border-green-500 bg-green-50">
      <div className="p-2">
        <h3 className="font-semibold text-green-900">{data.name}</h3>
        <p className="text-sm text-green-700">{data.description}</p>
        <div className="mt-2 text-xs text-green-600">
          Query: {data.query.substring(0, 30)}...
        </div>
      </div>
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-green-500" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-green-500" />
    </BaseNode>
  );
};

// 3. Flow execution
private async processDatabaseQueryNode(node: WorkbenchNode): Promise<{ input?: any; output?: any }> {
  const dbData = node.data as DatabaseQueryNodeData;
  const input = { ...this.context };

  try {
    // Execute database query
    const result = await this.executeDatabaseQuery(dbData.query, dbData.connectionString);
    
    return {
      input,
      output: {
        message: 'Database query executed successfully',
        result: result,
        query: dbData.query,
      }
    };
  } catch (error) {
    return {
      input,
      output: {
        message: 'Database query failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    };
  }
}
```

This guide should help you successfully add new node types to the API workbench flow system. Remember to test thoroughly and follow the established patterns for consistency.
