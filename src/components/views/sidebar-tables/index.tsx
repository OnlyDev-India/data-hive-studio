"use client";
import Tree from "@/components/common/tree";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  changeDataBase,
  currentConnectionDetails,
  getCurrentDatabaseType,
  getDatabases,
  getSchemas,
} from "@/lib/actions/fetch-data";
import { handlers } from "@/lib/databases/db";
import { cn } from "@/lib/utils";
import { addNewTableFile, resetOpenFiles } from "@/redux/features/open-files";
import { resetQuery } from "@/redux/features/query";
import { fetchTables, setCurrentSchema } from "@/redux/features/tables";
import { AppDispatch } from "@/redux/store";
import { ConnectionDetailsType } from "@/types/db.type";
import { CommandSeparator } from "cmdk";
import {
  AtomIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

type LoadingTypes = "DBChanging" | "refetchTables" | null;

const SideBarTables = () => {
  const {
    tables,
    loading: tableLoading,
    currentSchema,
  } = useSelector((state: any) => state.tables);
  const [schemas, setSchemas] = useState<any>([]);
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null);
  const [databases, setDatabases] = useState<any>([]);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [loading, setLoading] = useState<LoadingTypes>(null);
  const [dbType, setDbType] = useState<keyof typeof handlers | null>(null);

  const dispatch = useDispatch<AppDispatch>();

  const handleFetchTables = async (isRefetch?: boolean) => {
    let isUpdateSchema = false;
    if (isRefetch) {
      isUpdateSchema = true;
      setLoading("refetchTables");
    }
    dispatch(fetchTables(isUpdateSchema));
    setLoading(null);
  };

  const handleAddNewTable = () => {
    dispatch(addNewTableFile());
  };

  const handleSchemaChange = (schema: string) => {
    dispatch(setCurrentSchema(schema));
    handleFetchTables(true);
  };

  const fetchSchemasAndDatabases = async () => {
    const result = await getSchemas();
    const result2 = await getDatabases();
    if (dbType === "pgSql" && result?.schemas) {
      setSchemas(result.schemas as any);
    }
    if (result2?.databases) {
      setDatabases(result2.databases as any);
    }
  };

  const handleFetchCurrentDatabase = async () => {
    const connectionDetails: ConnectionDetailsType =
      await currentConnectionDetails();
    setCurrentDatabase(connectionDetails.database || null);
  };

  const handleDatabaseChange = async (database: string) => {
    setLoading("DBChanging");
    setCurrentDatabase(database);
    const response = await changeDataBase({
      newConnectionDetails: { database },
    });
    if (response?.success) {
      handleFetchCurrentDatabase();
      setDatabaseOpen(false);
      fetchSchemasAndDatabases();
      if (dbType && dbType === "pgSql") {
        handleSchemaChange("public");
      } else {
        handleFetchTables(true);
      }
      dispatch(resetOpenFiles());
      dispatch(resetQuery());
    }
  };

  useEffect(() => {
    handleFetchCurrentDatabase();
    fetchSchemasAndDatabases();
    const fetchDbType = async () => {
      const dbType: string | undefined = await getCurrentDatabaseType();
      if (dbType) {
        setDbType(dbType as keyof typeof handlers);
      }
    };
    fetchDbType();
  }, []);

  useEffect(() => {
    if (!schemaOpen && !databaseOpen) return;
    fetchSchemasAndDatabases();
  }, [schemaOpen, databaseOpen]);

  return (
    <div className="group/collapsible flex h-full flex-col overflow-hidden">
      <div className="group sticky top-0 z-10 flex w-full flex-col items-center justify-between gap-2 bg-secondary px-2 pt-2 text-sm font-semibold uppercase shadow-md">
        <Popover open={databaseOpen} onOpenChange={setDatabaseOpen}>
          <PopoverTrigger disabled={loading !== null} asChild>
            <Button
              variant="outline"
              role="combobox"
              className="w-full justify-between border-border"
            >
              <span className="flex items-center gap-2 text-xs">
                <AtomIcon size={14} />
                {currentDatabase || "Select Database..."}
              </span>
              <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="min-w-[200px] w-full bg-popover/60 p-0 backdrop-blur-md"
            align="center"
          >
            <Command className="bg-transparent">
              <CommandInput placeholder="Search database..." />
              <CommandList>
                <CommandEmpty>No Database found.</CommandEmpty>
                <CommandGroup>
                  {databases.map((database: any) => {
                    return (
                      <CommandItem
                        key={database.database_name}
                        value={database.database_name}
                        onSelect={handleDatabaseChange}
                        className={cn("justify-between text-xs")}
                      >
                        {database.database_name}
                        {loading === "DBChanging" ? (
                          <LoaderCircleIcon
                            className={cn(
                              "h-4 w-4 animate-spin",
                              currentDatabase === database.database_name
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                        ) : (
                          <CheckIcon
                            className={cn(
                              "h-4 w-4",
                              currentDatabase === database.database_name
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
              <CommandSeparator className="border-t border-border" />
            </Command>
            <Button
              variant={"ghost"}
              className="w-full justify-start truncate text-xs"
              disabled
            >
              <LayersIcon />{" "}
              <span>
                Create Database <br />
                (coming soon)
              </span>
            </Button>
          </PopoverContent>
        </Popover>
        {dbType === "pgSql" && (
          <Popover open={schemaOpen} onOpenChange={setSchemaOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between border-border"
              >
                <span className="flex items-center gap-2 text-xs">
                  <AtomIcon size={14} />
                  {currentSchema || "Select schema..."}
                </span>
                <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="min-w-[200px] w-full bg-popover/60 p-0 backdrop-blur-md"
              align="center"
            >
              <Command className="bg-transparent">
                <CommandInput placeholder="Search schema..." />
                <CommandList>
                  <CommandEmpty>No schema found.</CommandEmpty>
                  <CommandGroup>
                    {schemas.map((schema: any) => (
                      <CommandItem
                        key={schema.schema_name}
                        value={schema.schema_name}
                        onSelect={(currentValue) => {
                          handleSchemaChange(currentValue);
                          setSchemaOpen(false);
                        }}
                        className="justify-between text-xs"
                      >
                        {schema.schema_name}
                        <CheckIcon
                          className={cn(
                            "mr-2 h-4 w-4",
                            currentSchema === schema.schema_name
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
                <CommandSeparator className="border-t border-border" />
              </Command>
              <Button
                variant={"ghost"}
                className="w-full justify-start truncate text-xs"
                disabled
              >
                <LayersIcon />{" "}
                <span>
                  Create Schema <br />
                  (coming soon)
                </span>
              </Button>
            </PopoverContent>
          </Popover>
        )}
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-1">
            <p className="flex items-center gap-2 py-2">
              Tables
              <span className="rounded-full bg-popover p-0 px-1 text-xs text-muted-foreground">
                {tables ? tables.length : 0}
              </span>
            </p>
          </div>
          <div className="text-xs [&_button]:!h-6 [&_button]:!w-6">
            <Button
              variant={"ghost"}
              size={"icon"}
              onClick={() => handleFetchTables(true)}
              className={cn(
                "invisible text-muted-foreground hover:text-foreground group-hover:visible [&_svg]:size-3.5",
                { visible: tableLoading },
              )}
              title="Reload tables"
            >
              <RotateCwIcon className={cn({ "animate-spin": tableLoading })} />
            </Button>
            <Button
              variant={"ghost"}
              size={"icon"}
              onClick={handleAddNewTable}
              className="text-muted-foreground hover:text-foreground"
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </div>
      {loading === "DBChanging" || tableLoading ? (
        <div className="mx-2 mt-8 flex items-center justify-center gap-2 rounded-md border bg-background p-2 text-xs">
          <LoaderCircleIcon className="h-4 w-4 animate-spin" />{" "}
          {loading === "DBChanging" ? "Changing database" : "Fetching Tables"}
        </div>
      ) : tables && tables.length > 0 ? (
        <Tree item={tables} />
      ) : (
        <div className="mx-2 mt-8 rounded-md border bg-background p-2 text-center text-xs">
          <p>
            No tables found
            {["pgSql"].includes(dbType || "") &&
              " in " + currentSchema + " schema"}
          </p>
        </div>
      )}
    </div>
  );
};

export default SideBarTables;
