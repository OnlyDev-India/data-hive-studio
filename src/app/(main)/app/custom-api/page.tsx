"use client";

import { Globe } from "@/components/magicui/globe";
import React from "react";

const CustomAPIPage: React.FC = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative max-h-[50%] text-center">
        <Globe className="-top-[50%]"/>
        <div className="h-[310px]"/>
        <h1 className="mb-2 text-2xl font-bold">API Management</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          🚀 Build powerful APIs with visual drag-and-drop workflows
        </p>
        <p className="text-muted-foreground text-sm">
          ⚡ Create endpoints, manage groups, and monitor performance in real-time
        </p>
        <div className="mt-4 text-xs text-muted-foreground/70">
          💡 Pro tip: Use the sidebar to explore your API ecosystem
        </div>
      </div>
    </div>
  );
};

export default CustomAPIPage;
