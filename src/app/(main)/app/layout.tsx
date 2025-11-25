"use client";
import { fetchTables } from "@/redux/features/tables";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { AppDispatch } from "@/redux/store";
import { initConnectedConnection } from "@/redux/features/appdb";
import Loader from "@/components/common/loader";

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
    return <Loader/>;
  }

  return <>{children}</>;
};

export default MainLayout;
