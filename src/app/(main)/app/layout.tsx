"use client";
import { connectDb } from "@/lib/actions/fetch-data";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { response } = await connectDb();
        if (!response?.success) {
          router.push("/");
        }
      } catch (error) {
        router.push("/");
      } finally {
        setIsLoading(false);
      }
    };

    checkConnection();
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return <>{children}</>;
};

export default MainLayout;
