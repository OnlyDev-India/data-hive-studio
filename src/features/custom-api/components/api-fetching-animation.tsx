"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface APIFetchingAnimationProps {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const APIFetchingAnimation: React.FC<APIFetchingAnimationProps> = ({
  className,
  size = "md",
}) => {
  const sizeClasses = {
    sm: "w-16 h-12",
    md: "w-24 h-16",
    lg: "w-32 h-20",
  };

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <svg
        className={cn(sizeClasses[size])}
        viewBox="0 0 100 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Server/API Icon */}
        <rect
          x="70"
          y="15"
          width="20"
          height="30"
          rx="2"
          fill="currentColor"
          opacity="0.1"
          className="animate-pulse"
        />
        <rect
          x="72"
          y="17"
          width="16"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="72"
          y="21"
          width="12"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="72"
          y="25"
          width="14"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="72"
          y="29"
          width="10"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="72"
          y="33"
          width="16"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="72"
          y="37"
          width="8"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        
        {/* Client/App Icon */}
        <rect
          x="10"
          y="20"
          width="15"
          height="20"
          rx="2"
          fill="currentColor"
          opacity="0.1"
        />
        <circle
          cx="17.5"
          cy="30"
          r="3"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="12"
          y="35"
          width="11"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        <rect
          x="12"
          y="38"
          width="8"
          height="2"
          rx="1"
          fill="currentColor"
          opacity="0.3"
        />
        
        {/* Data packets flowing from server to client */}
        <g className="animate-pulse">
          {/* Packet 1 */}
          <rect
            x="60"
            y="25"
            width="8"
            height="4"
            rx="1"
            fill="currentColor"
            opacity="0.6"
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0; -40,0; -50,0"
              dur="2s"
              repeatCount="indefinite"
            />
          </rect>
          
          {/* Packet 2 */}
          <rect
            x="60"
            y="30"
            width="6"
            height="3"
            rx="1"
            fill="currentColor"
            opacity="0.4"
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0; -40,0; -50,0"
              dur="2.5s"
              repeatCount="indefinite"
              begin="0.5s"
            />
          </rect>
          
          {/* Packet 3 */}
          <rect
            x="60"
            y="35"
            width="7"
            height="3"
            rx="1"
            fill="currentColor"
            opacity="0.5"
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0; -40,0; -50,0"
              dur="2.2s"
              repeatCount="indefinite"
              begin="1s"
            />
          </rect>
        </g>
        
        {/* Connection line */}
        <line
          x1="25"
          y1="30"
          x2="70"
          y2="30"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.2"
        />
        
        {/* Loading dots */}
        <g className="animate-pulse">
          <circle
            cx="40"
            cy="28"
            r="1.5"
            fill="currentColor"
            opacity="0.6"
          >
            <animate
              attributeName="opacity"
              values="0.2;1;0.2"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx="45"
            cy="28"
            r="1.5"
            fill="currentColor"
            opacity="0.6"
          >
            <animate
              attributeName="opacity"
              values="0.2;1;0.2"
              dur="1.5s"
              repeatCount="indefinite"
              begin="0.3s"
            />
          </circle>
          <circle
            cx="50"
            cy="28"
            r="1.5"
            fill="currentColor"
            opacity="0.6"
          >
            <animate
              attributeName="opacity"
              values="0.2;1;0.2"
              dur="1.5s"
              repeatCount="indefinite"
              begin="0.6s"
            />
          </circle>
        </g>
        
        {/* Status indicator */}
        <circle
          cx="80"
          cy="10"
          r="3"
          fill="currentColor"
          opacity="0.8"
          className="animate-ping"
        />
        <circle
          cx="80"
          cy="10"
          r="2"
          fill="currentColor"
          opacity="0.6"
        />
      </svg>
    </div>
  );
};

export default APIFetchingAnimation;
