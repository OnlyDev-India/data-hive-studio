"use client";

import React from "react";
import { LogsIcon, Settings } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface APIHeaderProps {
  connectionName: string;
  apiId: string;
}

const APIHeader: React.FC<APIHeaderProps> = ({ connectionName, apiId }) => {
  const searchParams = useSearchParams();

  return (
    <div className="pt-2">
      <div className="flex flex-wrap justify-between gap-2 px-2">
        <div className="flex items-start gap-2">
          <div>
            <p className="text-sm font-semibold">
              {connectionName
                ? `${connectionName}`
                : "No connection selected"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {apiId && (
            <>
              <Link
                href={`/app/custom-api/settings/${apiId}?tab=settings&${searchParams.toString()}`}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-secondary hover:bg-background [&_svg]:size-3"
                title="API Settings"
              >
                <Settings />
              </Link>
              <Link
                href={`/app/custom-api/settings/${apiId}?tab=logs&${searchParams.toString()}`}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-secondary hover:bg-background [&_svg]:size-3"
                title="API Settings"
              >
                <LogsIcon />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default APIHeader;
