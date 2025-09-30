"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchTables } from "@/redux/features/tables";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { AppDispatch } from "@/redux/store";
import { initConnectedConnection } from "@/redux/features/appdb";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    const checkConnection = async () => {
      try {
        await dispatch(fetchTables());
        dispatch(initConnectedConnection());
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
      <div className="flex h-full w-full flex-1 p-2 pl-0">
        <div className="h-full w-full flex-1 rounded-lg bg-secondary">
          {/* Content Area with Database Fetching Animation */}
          <div className="flex-1 p-8">
            <div className="mx-auto max-w-md space-y-8">
              {/* Header */}
              <div className="space-y-2 text-center">
                <Skeleton className="mx-auto h-8 w-64 animate-pulse" />
                <Skeleton className="mx-auto h-4 w-96 animate-pulse" />
              </div>
              {/* Database Fetching Animation */}
              <div className="flex flex-col items-center justify-center space-y-6">
                {/* Database Icon with Animation */}
                <div className="relative">
                  <svg
                    className="h-24 w-24 animate-pulse text-primary"
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
                  <div className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 transform space-x-1">
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: "0ms" }}
                    ></div>
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: "150ms" }}
                    ></div>
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-primary"
                      style={{ animationDelay: "300ms" }}
                    ></div>
                  </div>
                </div>
                {/* Connection Lines Animation */}
                <div className="relative h-16 w-32">
                  <svg className="h-full w-full" viewBox="0 0 128 64">
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
                <div className="space-y-2 text-center">
                  <Skeleton className="mx-auto h-4 w-32 animate-pulse" />
                  <Skeleton className="mx-auto h-3 w-24 animate-pulse" />
                </div>
                {/* Progress Bar */}
                <div className="h-2 w-48 overflow-hidden rounded-full bg-background/10">
                  <div
                    className="h-full animate-pulse rounded-full bg-primary"
                    style={{ width: "60%" }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default MainLayout;
