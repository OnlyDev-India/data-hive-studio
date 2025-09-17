"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { GroupIcon } from "lucide-react";
import EndpointItem from "./endpoint-item";
import {
  APIDetails
} from "@/features/custom-api/types/custom-api.type";
import { APIGroup } from "@/features/custom-api/types/custom-api.type";
import { cn } from "@/lib/utils";

interface EndpointsListProps {
  groups: APIGroup[];
  currentAPI: APIDetails;
  apiId: string;
}

// Recursive component for rendering groups with children
const GroupComponent: React.FC<{
  groupData: APIGroup;
  apiId: string;
  currentAPI: APIDetails;
  level: number;
}> = ({ groupData, apiId, currentAPI, level }) => {
  const totalEndpoints =
    (groupData.subGroups?.length || 0) + (groupData.endpoints?.length || 0);

  return (
    <div className={cn("space-y-2 rounded-md border", { "ml-4": level > 0 })}>
      {/* Group Header */}
      <div
        className={`group flex items-center gap-2 overflow-hidden rounded-md bg-muted/50 px-2 py-1`}
      >
        <span className="min-w-6">
          <GroupIcon size={16} className="text-muted-foreground" />
        </span>
        <span className="text-sm font-medium">{groupData.path}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {groupData.path}
        </span>
        {"children" in groupData && (
          <Badge variant="outline" className="text-xs">
            {totalEndpoints}
          </Badge>
        )}
      </div>

      <div className={`space-y-2 p-1 pl-4`}>
        {/* Render child groups recursively */}
        {"children" in groupData &&
          groupData.subGroups?.map((childGroup: APIGroup) => (
            <GroupComponent
              key={childGroup.id}
              groupData={childGroup}
              apiId={apiId}
              currentAPI={currentAPI}
              level={level + 1}
            />
          ))}
        {groupData.endpoints?.map((endpoint) => (
          <div key={endpoint.id} className={`space-y-1`}>
            <EndpointItem endpoint={endpoint} apiId={apiId} />
          </div>
        ))}
      </div>
    </div>
  );
};

const EndpointsList: React.FC<EndpointsListProps> = ({
  groups,
  currentAPI,
  apiId,
}) => {
  const isGrouped = groups.length > 0;
  return (
    <div className="space-y-4">
      {/* Show Groups */}
      {isGrouped
        ? groups.map((groupData) => (
            <GroupComponent
              key={groupData.id}
              groupData={groupData}
              apiId={apiId}
              currentAPI={currentAPI}
              level={0}
            />
          ))
        : currentAPI.endpoints?.map((endpoint) => (
            <div key={endpoint.id} className={`space-y-1`}>
              <EndpointItem endpoint={endpoint} apiId={apiId} />
            </div>
          ))}
    </div>
  );
};

export default EndpointsList;
