"use client";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Edge,
  Node,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useCallback, useEffect } from "react";
import "@xyflow/react/dist/style.css";
import "@/styles/visualizer.css";
import { useSelector } from "react-redux";
import Dagre from "@dagrejs/dagre";

import { DatabaseSchemaNode } from "@/components/views/visualizer/database-schema-node";
import { Button } from "@/components/ui/button";
import { LayoutPanelLeftIcon, LayoutPanelTopIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const nodeTypes = {
  databaseSchema: DatabaseSchemaNode,
};

const getLayoutedElements = (nodes: any, edges: any, options: any) => {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: options.direction });

  edges.forEach((edge: Edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node: Node) =>
    g.setNode(node.id, {
      ...node,
      width: node.measured?.width ?? 0,
      height: node.measured?.height ?? 0,
    })
  );

  Dagre.layout(g);

  return {
    nodes: nodes.map((node: Node) => {
      const position = g.node(node.id);
      // We are shifting the dagre node position (anchor=center center) to the top left
      // so it matches the React Flow node anchor point (top left).
      const x = position.x - (node.measured?.width ?? 0) / 2;
      const y = position.y - (node.measured?.height ?? 0) / 2;

      return { ...node, position: { x, y } };
    }),
    edges,
  };
};

const SchemaVisualizer = () => {
  const { tables } = useSelector((state: any) => state.tables);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  const onLayout = useCallback(
    (direction: "TB" | "LR") => {
      if (!nodes || nodes.length === 0) return;
      const layouted = getLayoutedElements(nodes, edges, { direction });

      setNodes([...layouted.nodes]);
      setEdges([...layouted.edges]);

      // window.requestAnimationFrame(() => {
      //   fitView();
      // });
    },
    [nodes, edges]
  );

  const createNodesAndEdges = (tables: any[]) => {
    const nodes: Node[] = tables.map((table, index) => ({
      id: table.table_name,
      type: "databaseSchema",
      data: {
        label: table.table_name,
        schema: table.fields?.map((field: any) => ({
          title: field.name,
          type: field.type,
        })),
      },
      position: { x: index * 100, y: index * 10 }, // Adjust position as needed
    }));

    const edges: Edge[] = [];

    tables.forEach((table) => {
      table.fields
        ?.filter((field: any) => field.foreign_table_name)
        .forEach((field: any) => {
          edges.push({
            id: `${table.table_name}-${field.foreign_table_name}-${field.name}-${field.foreign_column_name}`,
            source: table.table_name,
            target: field.foreign_table_name,
            sourceHandle: field.name,
            targetHandle: field.foreign_column_name,
            type: "smoothstep",
          });
        });
    });
    setNodes(nodes);
    setEdges(edges);
  };
  useEffect(() => {
    if (tables?.length > 0) {
      createNodesAndEdges(tables);
      setTimeout(() => onLayout("LR"), 1000);
    }
  }, [tables]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} />
      <Panel
        position="top-left"
        className="flex gap-2 bg-popover px-4 py-1 rounded-md"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={"secondary"}
              size={"icon"}
              className="bg-popover h-7 w-7"
              onClick={() => onLayout("TB")}
            >
              <LayoutPanelTopIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Vertical Layout</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={"secondary"}
              size={"icon"}
              className="bg-popover h-7 w-7"
              onClick={() => onLayout("LR")}
            >
              <LayoutPanelLeftIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Horizontal Layout</TooltipContent>
        </Tooltip>
      </Panel>
      <Controls showInteractive={false}>
        <ControlButton onClick={() => onLayout("LR")}>
          <LayoutPanelLeftIcon />
        </ControlButton>
      </Controls>
    </ReactFlow>
  );
};

export default SchemaVisualizer;
