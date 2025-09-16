"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteModal from "@/components/modals/delete-modal";
import {
  MoreVertical,
  Play,
  Pause,
  Trash2,
  TextCursorInputIcon,
} from "lucide-react";
import Link from "next/link";
import { APIEndpoint } from "@/features/custom-api/types/custom-api.type";
import { useSearchParams } from "next/navigation";
import { API_METHOD_COLORS } from "../config/api-config";

interface EndpointItemProps {
  endpoint: APIEndpoint;
  apiId: string;
  groupPath?: string;
}

const EndpointItem: React.FC<EndpointItemProps> = ({
  endpoint,
  apiId,
  groupPath,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const searchParams = useSearchParams();
  const displayPath = groupPath
    ? `${groupPath}${endpoint.path.startsWith("/") ? "" : "/"}${endpoint.path}`
    : endpoint.path;

  const handleDeleteEndpoint = () => {
    console.log("Deleting endpoint:", endpoint.id);
  };
  const handleToggleEndpoint = () => {
    console.log("Toggling endpoint:", endpoint.id);
  };
  const methodColor =
    API_METHOD_COLORS[endpoint.method as keyof typeof API_METHOD_COLORS];
  return (
    <div className="group relative cursor-pointer rounded-lg border bg-background transition-colors hover:bg-accent">
      <Link
        href={{
          pathname: `/app/custom-api/endpoint/${apiId}/${endpoint.id}`,
          search: searchParams.toString(),
        }}
        className="flex items-start justify-between overflow-hidden p-2"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge
              variant={endpoint.enabled ? "default" : "outline"}
              className="text-xs"
              style={endpoint.enabled ? { ...methodColor } : {}}
            >
              {endpoint.method}
            </Badge>
            <h4 className="min-w-6 truncate text-sm font-medium">
              {endpoint.name}
            </h4>
          </div>
          {endpoint.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {endpoint.description}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{displayPath}</span>
            <span>•</span>
            <span>{endpoint.enabled ? "Enabled" : "Disabled"}</span>
          </div>
        </div>

        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
              }}
            >
              <TextCursorInputIcon className="mr-2 h-3 w-3" />
              Rename
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={(e: React.MouseEvent) => {
                setIsDropdownOpen(false);
                e.stopPropagation();
                handleToggleEndpoint();
              }}
            >
              {endpoint.enabled ? (
                <>
                  <Pause className="mr-2 h-3 w-3" />
                  Disable
                </>
              ) : (
                <>
                  <Play className="mr-2 h-3 w-3" />
                  Enable
                </>
              )}
            </DropdownMenuItem>
            <DeleteModal
              title="Delete Endpoint"
              description={`Are you sure you want to delete the endpoint "${endpoint.name}"? This action cannot be undone.`}
              onConfirm={() => handleDeleteEndpoint()}
            >
              <div className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none hover:bg-destructive/20 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0">
                <Trash2 className="h-3 w-3" />
                Delete
              </div>
            </DeleteModal>
          </DropdownMenuContent>
        </DropdownMenu>
      </Link>
    </div>
  );
};

export default EndpointItem;
