"use client";
import { useCallback, useEffect, useState } from "react";
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
  Viewport,
} from "@xyflow/react";
import { useSelector, useDispatch } from "react-redux";
import { DatabaseSchemaNode } from "@/components/views/visualizer/database-schema-node";
import { Button } from "@/components/ui/button";
import { RotateCcwIcon, Scale3DIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { updateFile } from "@/redux/features/open-files";

import "@xyflow/react/dist/style.css";
import "@/styles/visualizer.css";
import { AppDispatch, RootState } from "@/redux/store";
import { VisualizerFileType } from "@/types/file.type";
import AddTableToView from "./add-table-to-view";

const nodeTypes = {
  databaseSchema: DatabaseSchemaNode,
};
const SchemaVisualizer = () => {
  const dispatch = useDispatch<AppDispatch>();
  // const { tables } = useSelector((state: RootState) => state.tables);
  const { currentFile } = useSelector((state: RootState) => state.openFiles);
  const cFile = currentFile as VisualizerFileType; //current file is of type VisualizerFileType
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const { fitView, getViewport, setViewport } = useReactFlow();
  const [originalPositions, setOriginalPositions] = useState<{
    [key: string]: { x: number; y: number };
  }>({});

  const [highlightedNode, setHighlightedNode] = useState<string | null>(null);

  // Update nodes to show highlighting
  const highlightedNodes = nodes.map((node) => ({
    ...node,
    selected: highlightedNode === node.id,
  }));

  // Save viewport and node positions to file data
  const saveViewportData = useCallback(
    (viewport: Viewport) => {
      if (!cFile) return;

      // const viewport = getViewport();
      // const nodePositions: { [key: string]: { x: number; y: number } } = {};

      // nodes.forEach((node) => {
      //   nodePositions[node.id] = { x: node.position.x, y: node.position.y };
      // });

      const updatedFile: VisualizerFileType = {
        ...cFile,
        visualizerData: {
          ...cFile.visualizerData,
          tables: cFile.visualizerData?.tables || [],
          viewport: viewport,
        },
      };

      dispatch(updateFile(updatedFile));
    },
    [cFile, nodes, getViewport, dispatch],
  );

  // Restore viewport and node positions from file data
  // const restoreViewportData = useCallback(() => {
  //   if (!cFile?.visualizerData?.viewport) return;

  //   const { viewport } = cFile.visualizerData;

  //   // Restore viewport
  //   if (viewport) {
  //     setViewport(viewport, { duration: 0 });
  //   }

  //   // Restore node positions
  //   if (nodePositions) {
  //     const updatedNodes = nodes.map((node) => ({
  //       ...node,
  //       position: nodePositions[node.id] || node.position,
  //     }));
  //     setNodes(updatedNodes);
  //   }
  // }, [cFile, nodes, setViewport, setNodes]);

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
    if (
      !cFile.visualizerData?.tables ||
      cFile.visualizerData?.tables.length === 0
    )
      return;

    const positions = calculateOptimalPositions(cFile.visualizerData?.tables);
    setOriginalPositions(positions);

    const updatedNodes = nodes.map((node) => ({
      ...node,
      position: positions[node.id] || { x: 0, y: 0 },
    }));

    setNodes(updatedNodes);
  }, [cFile.visualizerData?.tables, nodes]);

  const handleResetView = useCallback(() => {
    fitView({
      padding: 0.3,
      duration: 1200,
      minZoom: 0.1,
      maxZoom: 0.8,
    });
  }, [fitView]);

  const createNodesAndEdges = (tables: any[]) => {
    // Use saved positions if available, otherwise calculate new ones
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
              strokeWidth: 4,
              strokeDasharray: "12,6",
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

    // Restore viewport after nodes are created
    if (cFile?.visualizerData?.viewport) {
      setViewport(cFile.visualizerData.viewport, { duration: 0 });
    } else {
      setTimeout(() => {
        fitView();
      }, 100);
    }
  };

  useEffect(() => {
    if (cFile.visualizerData?.tables) {
      createNodesAndEdges(cFile.visualizerData?.tables);
    } else {
      createNodesAndEdges([]);
    }
  }, [cFile.id, cFile.visualizerData?.tables]);

  return (
    <div className="flex h-[calc(100%-var(--tabs-height))] flex-col p-2 pt-0">
      <ReactFlow
        nodes={highlightedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onViewportChange={saveViewportData}
        fitView
        minZoom={0.005}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.2 }}
        fitViewOptions={{ padding: 0.8 }}
        className="bg-transparent [&_.react-flow\_\_attribution]:hidden"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={50}
          size={10}
          className="opacity-20 dark:opacity-10"
          color="hsl(var(--muted-foreground))"
        />
        {/* Clean Control Panel */}
        <Panel
          position="bottom-center"
          className="!ml-1.5 !mt-1.5 flex !-translate-x-[30%] rounded-lg border border-border p-0 shadow-lg backdrop-blur-sm"
        >
          <AddTableToView />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"ghost"}
                size={"icon"}
                className="h-[1.65rem] w-[1.65rem] rounded-r-none border-r bg-secondary/80 text-foreground transition-all duration-200 hover:bg-accent/80 [&_svg]:size-3"
                onClick={handleResetView}
              >
                <RotateCcwIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset View</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"ghost"}
                size={"icon"}
                className="h-[1.65rem] w-[1.65rem] rounded-l-none bg-secondary/80 text-foreground transition-all duration-200 hover:bg-accent/80 [&_svg]:size-3"
                onClick={resetPositions}
              >
                <Scale3DIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset Positions</TooltipContent>
          </Tooltip>
        </Panel>
        <Controls
          showInteractive={false}
          className="overflow-hidden rounded-lg border border-border bg-secondary shadow-lg backdrop-blur-sm"
          position="bottom-center"
          orientation="horizontal"
        />
      </ReactFlow>
    </div>
  );
};

export default SchemaVisualizer;
