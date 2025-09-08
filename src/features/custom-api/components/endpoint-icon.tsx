"use client";

import React from "react";

interface EndpointIconProps {
  className?: string;
}

const EndpointIcon: React.FC<EndpointIconProps> = ({ className = "h-4 w-4" }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* API endpoint representation - server/endpoint icon */}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10" />
      <path d="M7 12h6" />
      <path d="M7 16h4" />
      <circle cx="17" cy="8" r="1" fill="currentColor" />
      <circle cx="17" cy="12" r="1" fill="currentColor" />
      <circle cx="17" cy="16" r="1" fill="currentColor" />
    </svg>
  );
};

export default EndpointIcon;
