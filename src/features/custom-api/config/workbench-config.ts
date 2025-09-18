import { EndpointNode, ResponseNode, ConditionalNode } from "../components/api-workbench/nodes";
import { DatabaseSelectNode } from "../components/api-workbench/nodes/database-select-node";
import { FlaskConicalIcon, CheckCircle, GitBranchIcon, Database } from "lucide-react";
import ResponseNodeEdit from "../components/api-workbench/editbar/response-node-edit";
import EndpointFlowTester from "../components/api-workbench/editbar/endpoint-flow-tester";
import ConditionalNodeEdit from "../components/api-workbench/editbar/conditional-node-edit";
import DatabaseSelectNodeEdit from "../components/api-workbench/editbar/database-select-node-edit";

export const nodeTypes = {
    endpointNode: EndpointNode,
    responseNode: ResponseNode,
    conditionalNode: ConditionalNode,
    databaseSelectNode: DatabaseSelectNode,
  };
  
  type nodeTypesType = Exclude<keyof typeof nodeTypes, "endpointNode">;
  
  interface NodeDetails{
    name: string;
    description: string;
    icon: React.ComponentType<any> | null;
  
  }
  
  const nodeTypeIcons: Record<nodeTypesType, NodeDetails> = {
      responseNode: {
        name: "Response Node",
        description: "Response Node",
        icon: CheckCircle,
      },
      conditionalNode: {
        name: "Conditional Node",
        description: "Conditional Node",
        icon: GitBranchIcon,
      },
      databaseSelectNode: {
        name: "Database Select",
        description: "Database Select Query",
        icon: Database,
      },
  }
  
  
  export const AVAILABLE_NODE_TYPES = Object.keys(nodeTypes).filter((type) => type !== "endpointNode").map((type) => ({
    id: type,
    name: nodeTypeIcons[type as nodeTypesType].name,
    description: nodeTypeIcons[type as nodeTypesType].description,
    icon: nodeTypeIcons[type as nodeTypesType].icon,
  }));

  export const EditBarNodeTypes = {
    endpointNode: EndpointFlowTester,
    responseNode: ResponseNodeEdit,
    conditionalNode: ConditionalNodeEdit,
    databaseSelectNode: DatabaseSelectNodeEdit,
  }