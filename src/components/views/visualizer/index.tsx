"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useReactFlow,
} from "@xyflow/react";
import { useSelector } from "react-redux";
import { DatabaseSchemaNode } from "@/components/views/visualizer/database-schema-node";
import { Button } from "@/components/ui/button";
import {
  RotateCcwIcon,
  Grid3X3Icon,
  SearchIcon,
  XIcon,
  ZoomInIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

import "@xyflow/react/dist/style.css";
import "@/styles/visualizer.css";
import Dagre from "@dagrejs/dagre";

import BuildingBlocks from "@public/building-blocks.json";
import Lottie from "lottie-react";
import { KeyIcon, LinkIcon } from "lucide-react";

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
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();
  const [originalPositions, setOriginalPositions] = useState<{
    [key: string]: { x: number; y: number };
  }>({});

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Search functionality
  const filteredTables =
    tables?.filter((table: any) =>
      table.table_name?.toLowerCase().includes(searchQuery.toLowerCase()),
    ) || [];

  const handleNodeSelect = useCallback(
    (tableName: string) => {
      setSelectedNode(tableName);
      setHighlightedNode(tableName);
      setSearchOpen(false);
      setSelectedIndex(0);

      // Find the node and zoom to it
      const node = nodes.find((n) => n.id === tableName);
      if (node) {
        fitView({
          nodes: [node],
          padding: 0.5,
          duration: 800,
        });
      }
    },
    [nodes, fitView],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!searchQuery || filteredTables.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredTables.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredTables.length - 1,
        );
        break;
      case "Enter":
        e.preventDefault();
        if (filteredTables[selectedIndex]) {
          handleNodeSelect(filteredTables[selectedIndex].table_name);
        }
        break;
      case "Escape":
        setSearchQuery("");
        setSelectedIndex(0);
        break;
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSelectedNode(null);
    setHighlightedNode(null);
    setSelectedIndex(0);
    handleResetView();
  };

  // Update nodes to show highlighting
  const highlightedNodes = nodes.map((node) => ({
    ...node,
    selected: highlightedNode === node.id,
  }));

  // Custom positioning algorithm for ER diagram with force-directed layout
  const calculateOptimalPositions = (tables: any[]) => {
    // Safety check for valid data
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return {};
    }

    const positions: { [key: string]: { x: number; y: number } } = {};
    const tableWidth = 450; // Increased from 400
    const tableHeight = 500; // Increased from 450
    const minSpacing = 500; // Increased from 300
    const centerX = 2000; // Increased from 1500
    const centerY = 1500; // Increased from 1200
    const gridSpacing = Math.max(tableWidth, tableHeight) + minSpacing;

    // Separate root tables (those with primary keys) and child tables
    const rootTables = tables.filter(
      (table: any) =>
        table.fields &&
        Array.isArray(table.fields) &&
        table.fields.some(
          (field: any) => field && (field.is_primary_key || field.primary_key),
        ),
    );
    const childTables = tables.filter(
      (table: any) =>
        !table.fields ||
        !Array.isArray(table.fields) ||
        !table.fields.some(
          (field: any) => field && (field.is_primary_key || field.primary_key),
        ),
    );

    // Position root tables in a circle around the center
    const radius = 1500; // Increased from 1000
    rootTables.forEach((table: any, index: number) => {
      const angle = (index * 2 * Math.PI) / rootTables.length;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      positions[table.table_name] = { x, y };
    });

    // Position child tables around their related root tables
    childTables.forEach((table: any, childIndex: number) => {
      const foreignKeyFields =
        table.fields && Array.isArray(table.fields)
          ? table.fields.filter(
              (field: any) => field && field.foreign_table_name,
            )
          : [];
      let bestPosition = { x: centerX, y: centerY };
      let minDistance = Infinity;

      // Find the closest root table to position this child table near
      foreignKeyFields.forEach((field: any, fieldIndex: number) => {
        if (field && field.foreign_table_name) {
          const relatedTable = tables.find(
            (t: any) => t.table_name === field.foreign_table_name,
          );
          if (relatedTable && positions[relatedTable.table_name]) {
            const distance = 2500; // Increased from 1800 for more space

            // Count how many child tables are connected to this parent
            const childTablesForParent = childTables.filter((childTable) => {
              const childFields =
                childTable.fields && Array.isArray(childTable.fields)
                  ? childTable.fields.filter(
                      (f: any) => f && f.foreign_table_name,
                    )
                  : [];
              return childFields.some(
                (f: any) => f.foreign_table_name === field.foreign_table_name,
              );
            });

            // Find the index of this child table among all children of this parent
            const childIndexForParent = childTablesForParent.findIndex(
              (childTable) => childTable.table_name === table.table_name,
            );

            // Calculate angle based on child index for this specific parent
            const totalChildrenForParent = childTablesForParent.length;
            const angleStep =
              (2 * Math.PI) / Math.max(totalChildrenForParent, 1);
            const angle = childIndexForParent * angleStep + Math.PI / 2;

            const x =
              positions[relatedTable.table_name].x + distance * Math.cos(angle);
            const y =
              positions[relatedTable.table_name].y + distance * Math.sin(angle);

            const distToCenter = Math.sqrt(x * x + y * y);
            if (distToCenter < minDistance) {
              minDistance = distToCenter;
              bestPosition = { x, y };
            }
          }
        }
      });

      positions[table.table_name] = bestPosition;
    });

    // Additional collision resolution for child tables
    const childTableNames = childTables.map((table) => table.table_name);
    for (let i = 0; i < childTableNames.length; i++) {
      for (let j = i + 1; j < childTableNames.length; j++) {
        const table1Name = childTableNames[i];
        const table2Name = childTableNames[j];
        const pos1 = positions[table1Name];
        const pos2 = positions[table2Name];

        if (pos1 && pos2) {
          const dx = Math.abs(pos1.x - pos2.x);
          const dy = Math.abs(pos1.y - pos2.y);

          // Check if child tables are too close to each other
          if (dx < tableWidth + minSpacing && dy < tableHeight + minSpacing) {
            const pushDistanceX = tableWidth + minSpacing - dx + 300;
            const pushDistanceY = tableHeight + minSpacing - dy + 300;
            const pushDistance = Math.max(pushDistanceX, pushDistanceY);

            const angle = Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);
            positions[table1Name].x -= (pushDistance * Math.cos(angle)) / 2;
            positions[table1Name].y -= (pushDistance * Math.sin(angle)) / 2;
            positions[table2Name].x += (pushDistance * Math.cos(angle)) / 2;
            positions[table2Name].y += (pushDistance * Math.sin(angle)) / 2;
          }
        }
      }
    }

    // Fallback grid positioning for any tables that don't have positions yet
    const positionedTables = Object.keys(positions);
    const unpositionedTables = tables.filter(
      (table) => !positionedTables.includes(table.table_name),
    );

    let gridX = 0;
    let gridY = 0;
    const maxGridX = 3;

    unpositionedTables.forEach((table: any) => {
      let x = 500 + gridX * gridSpacing;
      let y = 500 + gridY * gridSpacing;

      // Check for collisions and find a free position
      let attempts = 0;
      let found = false;

      while (attempts < 100 && !found) {
        let collision = false;

        // Check collision with all placed tables
        for (const [tableName, pos] of Object.entries(positions)) {
          const dx = Math.abs(x - pos.x);
          const dy = Math.abs(y - pos.y);
          // Check both horizontal and vertical spacing
          if (dx < tableWidth + minSpacing && dy < tableHeight + minSpacing) {
            collision = true;
            break;
          }
        }

        if (!collision) {
          found = true;
        } else {
          // Try different positions in a larger spiral pattern
          const spiralRadius = Math.floor(attempts / 12) + 3;
          const spiralAngle = ((attempts % 12) * Math.PI) / 6;
          x = 500 + spiralRadius * gridSpacing * Math.cos(spiralAngle);
          y = 500 + spiralRadius * gridSpacing * Math.sin(spiralAngle);
          attempts++;
        }
      }

      positions[table.table_name] = { x, y };
      gridX++;
      if (gridX > maxGridX) {
        gridX = 0;
        gridY++;
      }
    });

    // Final collision resolution - push overlapping tables much further apart
    const tableNames = Object.keys(positions);
    for (let i = 0; i < tableNames.length; i++) {
      for (let j = i + 1; j < tableNames.length; j++) {
        const table1 = tableNames[i];
        const table2 = tableNames[j];
        const pos1 = positions[table1];
        const pos2 = positions[table2];
        const dx = Math.abs(pos1.x - pos2.x);
        const dy = Math.abs(pos1.y - pos2.y);
        // Check both horizontal and vertical overlap
        if (dx < tableWidth + minSpacing && dy < tableHeight + minSpacing) {
          const pushDistanceX = tableWidth + minSpacing - dx + 200;
          const pushDistanceY = tableHeight + minSpacing - dy + 200;
          const pushDistance = Math.max(pushDistanceX, pushDistanceY);

          const angle = Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);
          positions[table1].x -= (pushDistance * Math.cos(angle)) / 2;
          positions[table1].y -= (pushDistance * Math.sin(angle)) / 2;
          positions[table2].x += (pushDistance * Math.cos(angle)) / 2;
          positions[table2].y += (pushDistance * Math.sin(angle)) / 2;
        }
      }
    }

    // Advanced collision detection with free position finding
    let collisionDetected = true;
    let collisionIterations = 0;
    const maxCollisionIterations = 10;

    while (collisionDetected && collisionIterations < maxCollisionIterations) {
      collisionDetected = false;
      collisionIterations++;

      for (let i = 0; i < tableNames.length; i++) {
        for (let j = i + 1; j < tableNames.length; j++) {
          const table1 = tableNames[i];
          const table2 = tableNames[j];
          const pos1 = positions[table1];
          const pos2 = positions[table2];

          const dx = Math.abs(pos1.x - pos2.x);
          const dy = Math.abs(pos1.y - pos2.y);

          if (dx < tableWidth + minSpacing && dy < tableHeight + minSpacing) {
            collisionDetected = true;

            // Try to find a free position for table2 in different directions
            const directions = [
              { dx: 0, dy: -1 }, // Up
              { dx: 0, dy: 1 }, // Down
              { dx: -1, dy: 0 }, // Left
              { dx: 1, dy: 0 }, // Right
              { dx: -1, dy: -1 }, // Up-Left
              { dx: 1, dy: -1 }, // Up-Right
              { dx: -1, dy: 1 }, // Down-Left
              { dx: 1, dy: 1 }, // Down-Right
            ];

            let newPosition = null;
            let searchRadius = 1;

            // Search in expanding radius until we find a free position
            while (!newPosition && searchRadius <= 5) {
              for (const direction of directions) {
                const testX =
                  pos2.x +
                  direction.dx * (tableWidth + minSpacing) * searchRadius;
                const testY =
                  pos2.y +
                  direction.dy * (tableHeight + minSpacing) * searchRadius;

                // Check if this position is free from all other tables
                let positionFree = true;
                for (const [tableName, pos] of Object.entries(positions)) {
                  if (tableName !== table2) {
                    const testDx = Math.abs(testX - pos.x);
                    const testDy = Math.abs(testY - pos.y);
                    if (
                      testDx < tableWidth + minSpacing &&
                      testDy < tableHeight + minSpacing
                    ) {
                      positionFree = false;
                      break;
                    }
                  }
                }

                if (positionFree) {
                  newPosition = { x: testX, y: testY };
                  break;
                }
              }
              searchRadius++;
            }

            // If we found a free position, move table2 there
            if (newPosition) {
              positions[table2] = newPosition;
            } else {
              // If no free position found, push tables apart aggressively
              const pushDistance = tableWidth + minSpacing + 500;
              const angle = Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);
              positions[table1].x -= (pushDistance * Math.cos(angle)) / 2;
              positions[table1].y -= (pushDistance * Math.sin(angle)) / 2;
              positions[table2].x += (pushDistance * Math.cos(angle)) / 2;
              positions[table2].y += (pushDistance * Math.sin(angle)) / 2;
            }
          }
        }
      }
    }

    return positions;
  };

  const resetPositions = useCallback(() => {
    if (!tables || tables.length === 0) return;
    
    const positions = calculateOptimalPositions(tables);
    setOriginalPositions(positions);
    
    const updatedNodes = nodes.map((node) => ({
      ...node,
      position: positions[node.id] || { x: 0, y: 0 },
    }));
    
    setNodes(updatedNodes);
  }, [tables, nodes]);

  const handleResetView = useCallback(() => {
    fitView({
      padding: 0.3,
      duration: 1200,
      minZoom: 0.1,
      maxZoom: 0.8,
    });
  }, [fitView]);

  const createNodesAndEdges = (tables: any[]) => {
    const positions = calculateOptimalPositions(tables);
    setOriginalPositions(positions);

    const nodes: Node[] = tables.map((table) => ({
      id: table.table_name,
      type: "databaseSchema",
      data: {
        label: table.table_name,
        schema: table.fields?.map((field: any) => ({
          title: field.name,
          type: field.type,
          isPrimary: field.is_primary_key || field.primary_key,
          isForeign: !!field.foreign_table_name,
          foreignTable: field.foreign_table_name,
          foreignColumn: field.foreign_column_name,
        })),
      },
      position: positions[table.table_name] || { x: 0, y: 0 },
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
            style: {
              stroke: "hsl(var(--primary))", // Use primary color from theme
              strokeWidth: 3,
              strokeDasharray: field.isForeign ? "12,6" : "none",
            },
            label: `${field.name}`,
            labelStyle: {
              fontSize: "11px",
              fill: "hsl(var(--foreground))", // Use foreground color for text
              fontWeight: "600",
            },
            labelBgStyle: {
              fill: "hsl(var(--card))", // Use card background color
              fillOpacity: 0.95,
            },
            labelBgPadding: [8, 6],
            labelBgBorderRadius: 8,
          });
        });
    });
    setNodes(nodes);
    setEdges(edges);
    setTimeout(() => fitView(), 100);
  };
  useEffect(() => {
    if (tables?.length > 0) {
      createNodesAndEdges(tables);
      setTimeout(() => {
        // onLayout("LR"); // Removed as per edit hint
      }, 4000);
    }
  }, [tables]);

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel
        defaultSize={30}
        minSize={20}
        maxSize={30}
        className="py-2"
      >
        {/* Search Sub-Sidebar */}
        <div className="group/collapsible h-full rounded-lg bg-secondary">
          <div className="group sticky top-0 z-10 flex w-full flex-col items-center justify-between gap-2 rounded-t-lg bg-secondary pl-2 pt-2 text-xs font-semibold uppercase shadow-md">
            <div className="flex w-full items-center justify-between px-3">
              <div className="flex items-center gap-1">
                <p className="flex items-center gap-2 py-2">
                  <SearchIcon className="h-3 w-3" />
                  Table Search
                  <span className="rounded-full bg-popover p-0 px-1 text-xs text-muted-foreground">
                    {tables ? tables.length : 0}
                  </span>
                </p>
              </div>
              {selectedNode && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearSearch}
                  className="h-5 w-5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          <div className="scrollable-container-gutter h-[calc(100%-60px)] overflow-auto rounded-b-lg pb-4">
            <div className="space-y-3 p-3">
              {/* Search Input */}
              <div className="space-y-2 sticky top-0 z-10 bg-secondary pb-3">
                <div className="text-xs font-medium text-foreground">
                  Search Tables
                </div>
                <div className="relative">
                  <SearchIcon className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 transform text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search tables..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
              {/* Selected Table Info */}
              {selectedNode && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-foreground">
                    Selected Table
                  </div>
                  <div className="rounded-lg border border-border bg-background p-2">
                    <div className="text-xs font-medium text-foreground">
                      {selectedNode}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Click the X button to clear selection
                    </div>
                  </div>
                </div>
              )}
              {/* Search Results */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">
                  Search Results
                </div>
                <div className="h-full space-y-1 overflow-y-auto">
                  {filteredTables.map((table: any, index: number) => (
                    <div
                      key={table.table_name}
                      className={cn(
                        "group cursor-pointer rounded-md border border-transparent p-2.5 transition-all duration-200 hover:border-border/50",
                        selectedNode === table.table_name
                          ? "border-primary/30 bg-primary/10 shadow-sm"
                          : index === selectedIndex
                            ? "border-accent/30 bg-accent/10 shadow-sm"
                            : "hover:bg-muted/30 hover:shadow-sm",
                      )}
                      onClick={() => handleNodeSelect(table.table_name)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full bg-primary/60 group-hover:bg-primary/80 transition-colors" />
                          <span className="text-xs font-medium text-foreground group-hover:text-foreground/90">
                            {table.table_name}
                          </span>
                        </div>
                        <Badge 
                          variant="secondary" 
                          className="text-xs bg-muted/50 text-muted-foreground border-0"
                        >
                          {table.fields?.length || 0}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {filteredTables.length === 0 && (
                    <div className="rounded-md border border-dashed border-muted-foreground/20 p-3 text-center">
                      <div className="text-xs text-muted-foreground">
                        No tables found
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle className="!w-2 bg-background" />

      <ResizablePanel
        defaultSize={70}
        minSize={50}
        maxSize={100}
        className="p-2 pl-0"
      >
        {/* Visualizer Main Area */}
        <div className="h-full w-full flex-1 overflow-hidden rounded-lg bg-background">
          <ReactFlow
            nodes={highlightedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.005}
            maxZoom={1.5}
            defaultViewport={{ x: 0, y: 0, zoom: 0.2 }}
            fitViewOptions={{ padding: 0.8 }}
            className="bg-transparent [&_.react-flow\_\_attribution]:hidden"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={30}
              size={1}
              className="opacity-20 dark:opacity-10"
              color="hsl(var(--muted-foreground))"
            />

            {/* Clean Control Panel */}
            <Panel
              position="top-left"
              className="flex gap-2 rounded-lg border border-border/50 bg-background/95 px-4 py-1 shadow-lg backdrop-blur-sm"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    className="h-6 w-6 [&_svg]:size-3 bg-secondary/80 text-foreground transition-all duration-200 hover:bg-accent/80"
                    onClick={handleResetView}
                  >
                    <RotateCcwIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset View</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    className="h-6 w-6 [&_svg]:size-3 bg-secondary/80 text-foreground transition-all duration-200 hover:bg-accent/80"
                    onClick={resetPositions}
                  >
                    <Grid3X3Icon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset Positions</TooltipContent>
              </Tooltip>
            </Panel>

            {/* Clean Legend */}
            <Panel
              position="top-right"
              className="rounded-lg border border-border/50 bg-background/95 px-4 py-3 shadow-lg backdrop-blur-sm"
            >
              <div className="mb-3 text-sm font-semibold text-foreground">
                Schema Legend
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                  <span className="text-foreground">Primary Key</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-primary"></div>
                  <span className="text-foreground">Foreign Key</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-muted-foreground"></div>
                  <span className="text-foreground">Regular Field</span>
                </div>
              </div>
            </Panel>

            <Controls
              showInteractive={false}
              className="rounded-lg border border-border/50 bg-card/95 shadow-lg backdrop-blur-sm"
            />
          </ReactFlow>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default SchemaVisualizer;
