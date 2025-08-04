"use client";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ResizableHandle } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { connectDb } from "@/lib/actions/fetch-data";
import { fetchTables } from "@/redux/features/tables";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const dispatch = useDispatch();

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { response } = await connectDb();
        if (!response?.success) {
          router.push("/");
        }
        dispatch(fetchTables() as any);
      } catch (error) {
        router.push("/");
      } finally {
        setIsLoading(false);
      }
    };

    checkConnection();
  }, [router, dispatch]);

  if (isLoading) {
    return (
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={20} maxSize={30} className="py-2">
          <div className="relative h-full overflow-auto bg-secondary rounded-lg">
            <div className="scrollable-container-gutter h-[100%] overflow-auto pb-4">
              {/* Database/Schema Selection Buttons */}
              <div className="p-4 space-y-2">
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>

              {/* Tables Section Header */}
              <div className="px-4 pb-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-16" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <Skeleton className="h-4 w-3" />
                  </div>
                </div>
              </div>

              {/* Tables List */}
              <div className="px-4 space-y-1">
                {[...Array(13)].map((_, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <Skeleton className="h-3 w-3" />
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle className="!w-2 bg-background" />
        <ResizablePanel defaultSize={80} minSize={50} maxSize={100} className="p-2 pl-0">
          <div className="h-full w-full flex-1 bg-secondary rounded-lg">

            {/* Content Area with Database Fetching Animation */}
            <div className="flex-1 p-8">
              <div className="max-w-md mx-auto space-y-8">
                {/* Header */}
                <div className="text-center space-y-2">
                  <Skeleton className="h-8 w-64 mx-auto animate-pulse" />
                  <Skeleton className="h-4 w-96 mx-auto animate-pulse" />
                </div>

                {/* Database Fetching Animation */}
                <div className="flex flex-col items-center justify-center space-y-6">
                  {/* Database Icon with Animation */}
                  <div className="relative">
                    <svg 
                      className="w-24 h-24 text-primary animate-pulse" 
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={1.5}
                        d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                      />
                    </svg>
                    
                    {/* Animated Dots */}
                    <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>

                  {/* Connection Lines Animation */}
                  <div className="relative w-32 h-16">
                    <svg className="w-full h-full" viewBox="0 0 128 64">
                      <path
                        d="M10 32 Q32 10 64 32 Q96 54 118 32"
                        stroke="hsl(var(--primary))"
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray="4 4"
                        className="animate-pulse"
                      />
                      <circle
                        cx="64"
                        cy="32"
                        r="3"
                        fill="hsl(var(--primary))"
                        className="animate-ping"
                      />
                    </svg>
                  </div>

                  {/* Loading Text */}
                  <div className="text-center space-y-2">
                    <Skeleton className="h-4 w-32 mx-auto animate-pulse" />
                    <Skeleton className="h-3 w-24 mx-auto animate-pulse" />
                  </div>

                  {/* Progress Bar */}
                  <div className="w-48 h-2 bg-background/10 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '60%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  return <>{children}</>;
};

export default MainLayout;
