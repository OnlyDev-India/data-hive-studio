import React from "react";
import { Skeleton } from "../ui/skeleton";

const Loader = () => {
  return (
    <div className="flex h-full w-full flex-1 p-2 pl-0">
      <div className="flex h-full w-full flex-1 items-center justify-center rounded-lg bg-secondary">
        {/* Content Area with Database Fetching Animation */}
         <div className="mx-auto max-w-lg space-y-12">
           {/* Modern Loading Animation */}
           <div className="flex flex-col items-center justify-center space-y-12">
             {/* Hexagonal Data Hive */}
             <div className="relative">
               {/* Outer Hexagon */}
               <div className="h-32 w-32 rotate-12 animate-spin" style={{ animationDuration: "8s" }}>
                 <svg viewBox="0 0 100 100" className="h-full w-full">
                   <polygon
                     points="50,5 85,25 85,75 50,95 15,75 15,25"
                     fill="none"
                     stroke="hsl(var(--primary) / 0.3)"
                     strokeWidth="2"
                   />
                 </svg>
               </div>
               
               {/* Middle Hexagon */}
               <div className="absolute inset-4 h-24 w-24 -rotate-12 animate-spin" style={{ animationDuration: "6s", animationDirection: "reverse" }}>
                 <svg viewBox="0 0 100 100" className="h-full w-full">
                   <polygon
                     points="50,5 85,25 85,75 50,95 15,75 15,25"
                     fill="none"
                     stroke="hsl(var(--primary) / 0.5)"
                     strokeWidth="2"
                   />
                 </svg>
               </div>
               
               {/* Inner Hexagon */}
               <div className="absolute inset-8 h-16 w-16 rotate-12 animate-spin" style={{ animationDuration: "4s" }}>
                 <svg viewBox="0 0 100 100" className="h-full w-full">
                   <polygon
                     points="50,5 85,25 85,75 50,95 15,75 15,25"
                     fill="hsl(var(--primary) / 0.1)"
                     stroke="hsl(var(--primary))"
                     strokeWidth="2"
                   />
                 </svg>
               </div>
               
               {/* Central Core */}
               <div className="absolute inset-12 flex h-8 w-8 items-center justify-center rounded-full bg-primary/20">
                 <div className="h-4 w-4 rounded-full bg-primary animate-pulse"></div>
               </div>
               
               {/* Floating Data Points */}
               <div className="absolute -top-2 left-1/2 h-2 w-2 -translate-x-1/2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0s" }}></div>
               <div className="absolute -right-2 top-1/2 h-2 w-2 -translate-y-1/2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.2s" }}></div>
               <div className="absolute -bottom-2 left-1/2 h-2 w-2 -translate-x-1/2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.4s" }}></div>
               <div className="absolute -left-2 top-1/2 h-2 w-2 -translate-y-1/2 animate-bounce rounded-full bg-primary" style={{ animationDelay: "0.6s" }}></div>
             </div>

             {/* Pulsing Dots */}
             <div className="flex space-x-3">
               <div className="h-3 w-3 animate-pulse rounded-full bg-primary" style={{ animationDelay: "0s" }}></div>
               <div className="h-3 w-3 animate-pulse rounded-full bg-primary" style={{ animationDelay: "0.2s" }}></div>
               <div className="h-3 w-3 animate-pulse rounded-full bg-primary" style={{ animationDelay: "0.4s" }}></div>
               <div className="h-3 w-3 animate-pulse rounded-full bg-primary" style={{ animationDelay: "0.6s" }}></div>
               <div className="h-3 w-3 animate-pulse rounded-full bg-primary" style={{ animationDelay: "0.8s" }}></div>
             </div>

             {/* Loading Text */}
             <div className="space-y-4 text-center">
               <div className="mx-auto h-6 w-72 animate-pulse rounded bg-primary/20"></div>
               <div className="mx-auto h-4 w-48 animate-pulse rounded bg-primary/15" style={{ animationDelay: "0.3s" }}></div>
             </div>

             {/* Modern Progress Bar */}
             <div className="w-80">
               <div className="h-2 overflow-hidden rounded-full bg-background/10">
                 <div className="relative h-full rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30">
                   <div
                     className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
                     style={{
                       animation: "shimmer 1.5s infinite",
                     }}
                   ></div>
                 </div>
               </div>
             </div>
           </div>
         </div>
      </div>
    </div>
  );
};

export default Loader;
