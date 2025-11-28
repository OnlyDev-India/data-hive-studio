"use client";
import ConnectionForm from "@/components/form/connection-form";
import ResizableLayout from "@/components/common/resizable-layout";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import SettingsView from "@/components/views/settings";

const ConnectionSidebar = dynamic(() => import("@/components/navbar/connection-side"), { ssr: false });
const ConnectionsPage = () => {
  const searchParams = useSearchParams();
  const homePage = searchParams.get("homePage");
  const CurrentPage = homePage === "settings" ? SettingsView : ConnectionForm;
  return (
    <ResizableLayout
      child1={<ConnectionSidebar />}
      child2={<CurrentPage />}
    />
  );
};

export default ConnectionsPage;
