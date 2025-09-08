"use client";

import React from "react";
import { GroupIcon, Settings } from "lucide-react";
import EndpointIcon from "./endpoint-icon";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import CreateEndpointDialog from "./create-endpoint-dialog";

interface APIHeaderProps {
  connectionName: string;
  totalGroups: number;
  totalEndpoints: number;
  apiId: string;
}

const APIHeader: React.FC<APIHeaderProps> = ({
  connectionName,
  totalGroups,
  totalEndpoints,
  apiId,
}) => {
  return (
    <div className="border-b p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-start gap-2">
          <div>
            <h3 className="text-sm font-semibold">Endpoints</h3>
            <p className="text-xs text-muted-foreground">
              {connectionName
                ? `for ${connectionName}`
                : "No connection selected"}
            </p>
          </div>
          <Badge variant="outline" className="gap-1 rounded-full">
            <EndpointIcon className="h-4 w-4" />
            {totalEndpoints}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <CreateEndpointDialog connectionName={connectionName} />
          <Link
            href={`/app/custom-api/settings/${apiId}`}
            className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted [&_svg]:size-3"
            title="API Settings"
          >
            <Settings />
          </Link>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"></div>
      </div>
    </div>
  );
};

export default APIHeader;
