"use client";
import Table from "./table";
import { useEffect, useState } from "react";
import { columns, relationColumns } from "./column";
import { useDispatch, useSelector } from "react-redux";
import { getTableColumns, getTableRelations } from "@/lib/actions/fetch-data";
import { updateFile } from "@/redux/features/open-files";
import { Button } from "@/components/ui/button";
import { RotateCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const StructureView = () => {
  const [loading, setLoading] = useState(false);
  const { currentFile } = useSelector((state: any) => state.openFiles);
  const dispatch = useDispatch();

  const handleGetTableStructure = async () => {
    if (!currentFile) return;
    setLoading(true);
    const { columns } = await getTableColumns(currentFile.tableName);
    const { data } = await getTableRelations(currentFile.tableName);

    if (columns && data) {
      dispatch(updateFile({ tableData: { columns, relations: data } }));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!currentFile?.tableName) return;
    const tableData = currentFile?.tableData;
    if (tableData) return;
    handleGetTableStructure();
  }, [currentFile?.tableName]);

  return (
    <Tabs
      defaultValue="columns"
      className="h-[calc(100vh-var(--tabs-height))] flex flex-col"
    >
      <TabsList className="h-[var(--tabs-height)] bg-background border-b-2 p-0">
        <CustomTabsTrigger value="columns">Columns</CustomTabsTrigger>
        <CustomTabsTrigger value="relations">Relations</CustomTabsTrigger>
      </TabsList>
      <CustomTabsContent value="columns">
        <div className="flex items-center justify-between py-2">
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-bold">Column</span>
            <span className="text-muted-foreground text-xs">{`(${currentFile?.tableName})`}</span>
          </p>
          <Button
            variant={"ghost"}
            size={"icon"}
            onClick={handleGetTableStructure}
            className="h-4 w-4 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
          >
            <RotateCwIcon className={cn({ "animate-spin": loading })} />
          </Button>
        </div>
        <Table columns={columns} data={currentFile?.tableData?.columns || []} />
      </CustomTabsContent>
      <CustomTabsContent value="relations">
        <div className="flex items-center justify-between py-2">
          <p className="flex items-baseline gap-2">
            <span className="text-lg font-bold">Relations</span>
            <span className="text-muted-foreground text-xs">{`(${currentFile?.tableName})`}</span>
          </p>
          <Button
            variant={"ghost"}
            size={"icon"}
            onClick={handleGetTableStructure}
            className="h-4 w-4 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
          >
            <RotateCwIcon className={cn({ "animate-spin": loading })} />
          </Button>
        </div>
        <Table
          columns={relationColumns}
          data={currentFile?.tableData?.relations || []}
        />
      </CustomTabsContent>
    </Tabs>
  );
};

const CustomTabsTrigger = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) => {
  return (
    <TabsTrigger
      className="data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full"
      value={value}
    >
      {children}
    </TabsTrigger>
  );
};

const CustomTabsContent = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) => {
  return (
    <TabsContent
      className="h-[calc(100vh-3.3*var(--tabs-height))] px-4"
      value={value}
    >
      {children}
    </TabsContent>
  );
};

export default StructureView;
