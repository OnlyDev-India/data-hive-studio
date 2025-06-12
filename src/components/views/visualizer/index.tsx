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
import { useCallback, useEffect, useState } from "react";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";

import BuildingBlocks from "@public/building-blocks.json";
import Lottie from "lottie-react";

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
    }),
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
  const [loading, setLoading] = useState(true);

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
    [nodes, edges],
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
    onLayout("LR");
  };
  useEffect(() => {
    if (tables?.length > 0) {
      createNodesAndEdges(tables);
      setTimeout(() => {
        onLayout("LR");
        setLoading(false);
      }, 4000);
    }
  }, [tables]);

  return (
    <div className="relative h-full w-full">
      {loading && (
        <>
          <div className="absolute left-1/2 top-1/2 z-[1000] h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 transform rounded-lg bg-popover/40 shadow-lg backdrop-blur-md">
            <Lottie animationData={BuildingBlocks} className="h-full" />
          </div>
          <div className="absolute left-0 top-0 z-[999] h-full w-full rounded-md bg-transparent" />
        </>
      )}
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
          className="flex gap-2 rounded-md bg-popover px-4 py-1"
        >
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant={"secondary"}
                size={"icon"}
                className="h-7 w-7 bg-popover"
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
                className="h-7 w-7 bg-popover"
                onClick={() => onLayout("LR")}
              >
                <LayoutPanelLeftIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Horizontal Layout</TooltipContent>
          </Tooltip>
        </Panel>
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default SchemaVisualizer;
