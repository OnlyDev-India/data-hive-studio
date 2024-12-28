import Tree from "../common/tree";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTablesWithFieldsFromDb,
  isConnectedToDb,
} from "@/lib/actions/fetch-data";
import { redirect } from "next/navigation";
import SideBarTables from "../views/sidebar-tables";

const SubSideBar = async () => {
  const isDbConnected = await isConnectedToDb();

  // if (!isDbConnected) {
  //   redirect("/");
  // }

  return (
    <div className="bg-secondary h-full px-1 overflow-auto relative">
      {/* <div className="h-10 flex items-center gap-2 border-b-2 py-2 bg-secondary shadow-md z-10">
        <div
          className={cn("h-2 w-2 rounded-full bg-green-500", {
            "bg-red-400": !isDbConnected,
          })}
        />
        <p className="text-foreground">
          {isDbConnected ? "Connected" : "Not Connected"}
        </p>
      </div> */}
      <div className="h-[100%] overflow-auto scrollable-container-gutter pb-4">
        <SideBarTables />
      </div>
    </div>
  );
};

export default SubSideBar;
