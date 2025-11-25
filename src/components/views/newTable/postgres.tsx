"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PlusIcon,
  TrashIcon,
  LoaderCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  KeyIcon,
  HashIcon,
  CalendarIcon,
  TypeIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import { toast } from "sonner";
import { createTable } from "@/lib/actions/fetch-data";
import { useDispatch } from "react-redux";
import { fetchTables } from "@/redux/features/tables";
import { AppDispatch } from "@/redux/store";

interface PostgreSQLColumn {
  id: string;
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isForeignKey: boolean;
  foreignTable: string;
  foreignColumn: string;
  autoIncrement: boolean;
}

interface PostgreSQLConstraint {
  id: string;
  name: string;
  type: "CHECK" | "UNIQUE" | "FOREIGN KEY" | "EXCLUDE";
  definition: string;
  columns: string[];
}

interface PostgreSQLIndex {
  id: string;
  name: string;
  type: "BTREE" | "HASH" | "GIN" | "GIST";
  columns: string[];
  unique: boolean;
  where?: string;
}

interface PostgreSQLTable {
  name: string;
  columns: PostgreSQLColumn[];
  constraints: PostgreSQLConstraint[];
  indexes: PostgreSQLIndex[];
}

const PostgreSQLTableCreator = () => {
  const [table, setTable] = useState<PostgreSQLTable>({
    name: "",
    columns: [
      {
        id: "1",
        name: "id",
        type: "UUID",
        nullable: false,
        defaultValue: "gen_random_uuid()",
        isPrimaryKey: true,
        isUnique: false,
        isForeignKey: false,
        foreignTable: "",
        foreignColumn: "",
        autoIncrement: false,
      },
    ],
    constraints: [],
    indexes: [],
  });
  const [loading, setLoading] = useState(false);
  const [expandedColumns, setExpandedColumns] = useState<string[]>(["1"]);
  const [expandedConstraints, setExpandedConstraints] = useState<string[]>([]);
  const [expandedIndexes, setExpandedIndexes] = useState<string[]>([]);
  const [sqlCopied, setSqlCopied] = useState(false);
  const dispatch = useDispatch<AppDispatch>();

  const postgresDataTypes = [
    {
      category: "Numeric",
      types: ["INTEGER", "BIGINT", "SMALLINT", "SERIAL", "BIGSERIAL"],
    },
    { category: "Text", types: ["TEXT", "VARCHAR", "CHAR"] },
    {
      category: "Date/Time",
      types: ["TIMESTAMP", "TIMESTAMPTZ", "DATE", "TIME", "TIMETZ", "INTERVAL"],
    },
    {
      category: "Other",
      types: ["BOOLEAN", "UUID", "JSON", "JSONB", "BYTEA", "XML"],
    },
    {
      category: "Numeric Precision",
      types: ["DECIMAL", "NUMERIC", "REAL", "DOUBLE PRECISION", "MONEY"],
    },
    { category: "Network", types: ["INET", "CIDR", "MACADDR"] },
    {
      category: "Geometric",
      types: ["POINT", "LINE", "LSEG", "BOX", "PATH", "POLYGON", "CIRCLE"],
    },
  ];

  const allDataTypes = postgresDataTypes.flatMap((category) => category.types);

  const getTypeIcon = (type: string) => {
    if (
      [
        "INTEGER",
        "BIGINT",
        "SMALLINT",
        "SERIAL",
        "BIGSERIAL",
        "DECIMAL",
        "NUMERIC",
      ].includes(type)
    ) {
      return <HashIcon size={16} className="" />;
    }
    if (["TEXT", "VARCHAR", "CHAR"].includes(type)) {
      return <TypeIcon size={16} className="text-green-500" />;
    }
    if (["TIMESTAMP", "DATE", "TIME"].includes(type)) {
      return <CalendarIcon size={16} className="text-purple-500" />;
    }
    if (["UUID", "JSON", "JSONB"].includes(type)) {
      return <DatabaseIcon size={16} className="text-orange-500" />;
    }
    return <DatabaseIcon size={16} className="text-gray-500" />;
  };

  const toggleColumnExpansion = (columnId: string) => {
    setExpandedColumns((prev) =>
      prev.includes(columnId)
        ? prev.filter((id) => id !== columnId)
        : [...prev, columnId],
    );
  };

  const toggleConstraintExpansion = (constraintId: string) => {
    setExpandedConstraints((prev) =>
      prev.includes(constraintId)
        ? prev.filter((id) => id !== constraintId)
        : [...prev, constraintId],
    );
  };

  const toggleIndexExpansion = (indexId: string) => {
    setExpandedIndexes((prev) =>
      prev.includes(indexId)
        ? prev.filter((id) => id !== indexId)
        : [...prev, indexId],
    );
  };

  const addColumn = () => {
    const newColumn: PostgreSQLColumn = {
      id: Date.now().toString(),
      name: "",
      type: "VARCHAR",
      length: 255,
      nullable: true,
      defaultValue: "",
      isPrimaryKey: false,
      isUnique: false,
      isForeignKey: false,
      foreignTable: "",
      foreignColumn: "",
      autoIncrement: false,
    };
    setTable((prev) => ({
      ...prev,
      columns: [...prev.columns, newColumn],
    }));
  };

  const removeColumn = (id: string) => {
    setTable((prev) => ({
      ...prev,
      columns: prev.columns.filter((col) => col.id !== id),
    }));
  };

  const updateColumn = (
    id: string,
    field: keyof PostgreSQLColumn,
    value: any,
  ) => {
    setTable((prev) => ({
      ...prev,
      columns: prev.columns.map((col) =>
        col.id === id ? { ...col, [field]: value } : col,
      ),
    }));
  };

  const updateTableName = (name: string) => {
    setTable((prev) => ({ ...prev, name }));
  };

  // Constraint management
  const addConstraint = () => {
    const newConstraint: PostgreSQLConstraint = {
      id: Date.now().toString(),
      name: "",
      type: "CHECK",
      definition: "",
      columns: [],
    };
    setTable((prev) => ({
      ...prev,
      constraints: [...prev.constraints, newConstraint],
    }));
  };

  const removeConstraint = (id: string) => {
    setTable((prev) => ({
      ...prev,
      constraints: prev.constraints.filter(
        (constraint) => constraint.id !== id,
      ),
    }));
  };

  const updateConstraint = (
    id: string,
    field: keyof PostgreSQLConstraint,
    value: any,
  ) => {
    setTable((prev) => ({
      ...prev,
      constraints: prev.constraints.map((constraint) =>
        constraint.id === id ? { ...constraint, [field]: value } : constraint,
      ),
    }));
  };

  // Index management
  const addIndex = () => {
    const newIndex: PostgreSQLIndex = {
      id: Date.now().toString(),
      name: "",
      type: "BTREE",
      columns: [],
      unique: false,
      where: "",
    };
    setTable((prev) => ({
      ...prev,
      indexes: [...prev.indexes, newIndex],
    }));
  };

  const removeIndex = (id: string) => {
    setTable((prev) => ({
      ...prev,
      indexes: prev.indexes.filter((index) => index.id !== id),
    }));
  };

  const updateIndex = (
    id: string,
    field: keyof PostgreSQLIndex,
    value: any,
  ) => {
    setTable((prev) => ({
      ...prev,
      indexes: prev.indexes.map((index) =>
        index.id === id ? { ...index, [field]: value } : index,
      ),
    }));
  };

  const generateCreateTableSQL = () => {
    // if (!table.name || table.columns.length === 0) {
    //   return "";
    // }

    let sql = "";

    // Generate CREATE TABLE statement
    const columnDefinitions = table.columns.map((col) => {
      let definition = `"${col.name}" ${col.type}`;

      // Add length for types that support it
      if (
        col.length &&
        ["VARCHAR", "CHAR", "DECIMAL", "NUMERIC"].includes(col.type)
      ) {
        definition += `(${col.length})`;
      }

      // Add constraints
      if (!col.nullable) {
        definition += " NOT NULL";
      }

      if (col.defaultValue) {
        definition += ` DEFAULT ${col.defaultValue}`;
      }

      if (col.autoIncrement) {
        definition += " GENERATED ALWAYS AS IDENTITY";
      }

      return definition;
    });

    // Add primary key constraint
    const primaryKeys = table.columns.filter((col) => col.isPrimaryKey);
    if (primaryKeys.length > 0) {
      const pkColumns = primaryKeys.map((col) => `"${col.name}"`).join(", ");
      columnDefinitions.push(`PRIMARY KEY (${pkColumns})`);
    }

    // Add unique constraints from columns
    const uniqueColumns = table.columns.filter(
      (col) => col.isUnique && !col.isPrimaryKey,
    );
    uniqueColumns.forEach((col) => {
      columnDefinitions.push(`UNIQUE ("${col.name}")`);
    });

    // Add foreign key constraints from columns
    const foreignKeys = table.columns.filter(
      (col) => col.isForeignKey && col.foreignTable && col.foreignColumn,
    );
    foreignKeys.forEach((col) => {
      columnDefinitions.push(
        `FOREIGN KEY ("${col.name}") REFERENCES "${col.foreignTable}"("${col.foreignColumn}")`,
      );
    });

    // Add table-level constraints
    table.constraints.forEach((constraint) => {
      if (constraint.name && constraint.definition) {
        if (constraint.type === "CHECK") {
          columnDefinitions.push(
            `CONSTRAINT "${constraint.name}" CHECK ${constraint.definition}`,
          );
        } else if (constraint.type === "UNIQUE") {
          columnDefinitions.push(
            `CONSTRAINT "${constraint.name}" UNIQUE ${constraint.definition}`,
          );
        } else if (constraint.type === "FOREIGN KEY") {
          columnDefinitions.push(
            `CONSTRAINT "${constraint.name}" FOREIGN KEY ${constraint.definition}`,
          );
        } else if (constraint.type === "EXCLUDE") {
          columnDefinitions.push(
            `CONSTRAINT "${constraint.name}" EXCLUDE ${constraint.definition}`,
          );
        }
      }
    });

    sql += `CREATE TABLE "public"."${table.name}" (\n  ${columnDefinitions.join(",\n  ")}\n);`;

    // Add indexes
    table.indexes.forEach((index) => {
      if (index.name && index.columns.length > 0) {
        const uniqueKeyword = index.unique ? "UNIQUE " : "";
        const whereClause = index.where ? ` WHERE ${index.where}` : "";
        const columnsStr = index.columns.map((col) => `"${col}"`).join(", ");

        sql += `\n\nCREATE ${uniqueKeyword}INDEX "${index.name}" ON "public"."${table.name}" USING ${index.type} (${columnsStr})${whereClause};`;
      }
    });

    return sql;
  };

  const handleCreateTable = async () => {
    try {
      if (!table.name.trim()) {
        toast.error("Table name is required");
        return;
      }

      if (table.columns.length === 0) {
        toast.error("At least one column is required");
        return;
      }

      // Validate columns
      for (const col of table.columns) {
        if (!col.name.trim()) {
          toast.error("All columns must have a name");
          return;
        }
      }

      setLoading(true);

      // Convert to the format expected by the backend
      const tableData = {
        name: table.name,
        columns: table.columns.map((col) => ({
          name: col.name,
          type: col.type,
          isNull: col.nullable,
          defaultValue: col.defaultValue,
          keyType: col.isPrimaryKey
            ? "PRIMARY"
            : col.isForeignKey
              ? "FOREIGN KEY"
              : "",
          foreignTable: col.foreignTable,
          foreignTableColumn: col.foreignColumn,
        })),
      };

      const result = await createTable(tableData as any);

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Table created successfully!");
        dispatch(fetchTables());
        // Reset form
        setTable({
          name: "",
          columns: [
            {
              id: "1",
              name: "id",
              type: "UUID",
              nullable: false,
              defaultValue: "gen_random_uuid()",
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
              foreignTable: "",
              foreignColumn: "",
              autoIncrement: false,
            },
          ],
          constraints: [],
          indexes: [],
        });
      }
    } catch (error) {
      toast.error("Failed to create table");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const typeSupportsLength = (type: string) => {
    return ["VARCHAR", "CHAR", "DECIMAL", "NUMERIC"].includes(type);
  };

  const copySQL = async () => {
    try {
      const sql = generateCreateTableSQL();
      await navigator.clipboard.writeText(sql);
      setSqlCopied(true);
      toast.success("SQL copied to clipboard!");
      setTimeout(() => setSqlCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy SQL");
    }
  };

  return (
    <div className="h-[calc(100%-var(--tabs-height))] w-full overflow-auto p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
          <div className="flex flex-1 items-center gap-2">
            <Label className="w-full max-w-20 truncate text-xs">
              Table name
            </Label>
            <Input
              value={table.name}
              onChange={(e) => updateTableName(e.target.value)}
              placeholder="Table name"
              className="h-8 bg-background"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={"outline"}
              onClick={handleCreateTable}
              disabled={
                loading || !table.name.trim() || table.columns.length === 0
              }
              className="h-8 gap-2 text-foreground border-border"
            >
              {loading && (
                <LoaderCircleIcon size={16} className="animate-spin" />
              )}
              create
            </Button>
          </div>
        </div>

        {/* Columns Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold">COLUMNS</h3>
              <Button
                onClick={addColumn}
                variant="link"
                size="sm"
                className="h-auto p-0"
              >
                Add column
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {table.columns.map((column, index) => {
              const isExpanded = expandedColumns.includes(column.id);
              const typeIcon = getTypeIcon(column.type);

              return (
                <Card key={column.id} className="overflow-hidden border">
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleColumnExpansion(column.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <div className="w-full cursor-pointer px-4 py-2 text-xs transition-colors hover:bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDownIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            ) : (
                              <ChevronRightIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            )}
                            <div className="flex items-center gap-2">
                              <PlusIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                              <span className="font-mono">
                                {column.name || "column_name"} {column.type}
                                {column.isPrimaryKey && " PRIMARY KEY"}
                                {column.autoIncrement &&
                                  " GENERATED ALWAYS AS IDENTITY"}
                              </span>
                            </div>
                          </div>

                          {table.columns.length > 1 && (
                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeColumn(column.id);
                              }}
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/20 hover:text-red-500"
                            >
                              <TrashIcon size={14} />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t border-border/50 bg-secondary">
                        <Tabs defaultValue="column-name" className="w-full">
                          <div className="flex border-b border-border/30">
                            <div className="w-64 border-r border-border/30 bg-muted/50">
                              <TabsList className="h-full w-full flex-col justify-start bg-transparent p-0">
                                <TabsTrigger
                                  value="column-name"
                                  className="w-full justify-start rounded-none border-b border-border/20 px-4 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-none"
                                >
                                  Column name
                                </TabsTrigger>
                                <TabsTrigger
                                  value="data-type"
                                  className="w-full justify-start rounded-none border-b border-border/20 px-4 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-none"
                                >
                                  Data type
                                </TabsTrigger>
                                <TabsTrigger
                                  value="constraints"
                                  className="w-full justify-start rounded-none border-b border-border/20 px-4 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-none"
                                >
                                  Constraints
                                </TabsTrigger>
                                <TabsTrigger
                                  value="default"
                                  className="w-full justify-start rounded-none border-b border-border/20 px-4 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-none"
                                >
                                  Default
                                </TabsTrigger>
                                <TabsTrigger
                                  value="generated"
                                  className="w-full justify-start rounded-none px-4 py-2 text-left data-[state=active]:bg-background data-[state=active]:shadow-none"
                                >
                                  Generated
                                </TabsTrigger>
                              </TabsList>
                            </div>

                            <div className="flex-1">
                              {/* Column Name Tab */}
                              <TabsContent
                                value="column-name"
                                className="custom-scrollbar m-0 max-h-44 overflow-auto p-6"
                              >
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-medium">
                                      Column name
                                    </Label>
                                    <Input
                                      value={column.name}
                                      onChange={(e) =>
                                        updateColumn(
                                          column.id,
                                          "name",
                                          e.target.value,
                                        )
                                      }
                                      placeholder="id"
                                      className="h-8"
                                    />
                                  </div>
                                </div>
                              </TabsContent>

                              {/* Data Type Tab */}
                              <TabsContent
                                value="data-type"
                                className="custom-scrollbar m-0 max-h-44 overflow-auto p-6"
                              >
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-medium">
                                      Data type
                                    </Label>
                                    <Select
                                      value={column.type}
                                      onValueChange={(value) =>
                                        updateColumn(column.id, "type", value)
                                      }
                                    >
                                      <SelectTrigger className="h-8">
                                        <SelectValue>
                                          <div className="flex items-center gap-2">
                                            {typeIcon}
                                            {column.type}
                                          </div>
                                        </SelectValue>
                                      </SelectTrigger>
                                      <SelectContent className="max-h-[400px]">
                                        {postgresDataTypes.map((category) => (
                                          <div key={category.category}>
                                            <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                                              {category.category}
                                            </div>
                                            {category.types.map((type) => (
                                              <SelectItem
                                                key={type}
                                                value={type}
                                              >
                                                <div className="flex items-center gap-2">
                                                  {getTypeIcon(type)}
                                                  {type}
                                                </div>
                                              </SelectItem>
                                            ))}
                                          </div>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  {typeSupportsLength(column.type) && (
                                    <div className="space-y-2">
                                      <Label className="text-xs font-medium">
                                        Array dimensions
                                      </Label>
                                      <Input
                                        type="number"
                                        value={column.length || ""}
                                        onChange={(e) =>
                                          updateColumn(
                                            column.id,
                                            "length",
                                            parseInt(e.target.value) ||
                                              undefined,
                                          )
                                        }
                                        placeholder="Length"
                                        className="h-8"
                                      />
                                    </div>
                                  )}
                                </div>
                              </TabsContent>

                              {/* Constraints Tab */}
                              <TabsContent
                                value="constraints"
                                className="custom-scrollbar m-0 max-h-44 overflow-auto p-6"
                              >
                                <div className="space-y-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <Label className="text-xs">
                                          Not null
                                        </Label>
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Column must not assume the null value
                                      </p>
                                    </div>
                                    <Switch
                                      checked={!column.nullable}
                                      onCheckedChange={(checked) =>
                                        updateColumn(
                                          column.id,
                                          "nullable",
                                          !checked,
                                        )
                                      }
                                    />
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <KeyIcon
                                          size={14}
                                          className="text-muted-foreground"
                                        />
                                        <Label className="text-xs">
                                          Primary key
                                        </Label>
                                      </div>
                                      <p className="text-xs text-muted-foreground">
                                        Can be used as a unique identifier for
                                        rows in the table
                                      </p>
                                    </div>
                                    <Switch
                                      checked={column.isPrimaryKey}
                                      onCheckedChange={(checked) =>
                                        updateColumn(
                                          column.id,
                                          "isPrimaryKey",
                                          checked,
                                        )
                                      }
                                    />
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <Label className="text-xs">Unique</Label>
                                      <p className="text-xs text-muted-foreground">
                                        Ensure that the data contained in a
                                        column is unique among all the rows
                                      </p>
                                    </div>
                                    <Switch
                                      checked={column.isUnique}
                                      onCheckedChange={(checked) =>
                                        updateColumn(
                                          column.id,
                                          "isUnique",
                                          checked,
                                        )
                                      }
                                    />
                                  </div>

                                  {column.isForeignKey && (
                                    <>
                                      <div className="space-y-2">
                                        <Label className="text-xs font-medium">
                                          Reference table
                                        </Label>
                                        <Input
                                          value={column.foreignTable}
                                          onChange={(e) =>
                                            updateColumn(
                                              column.id,
                                              "foreignTable",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="Reference table"
                                          className="h-8"
                                        />
                                      </div>

                                      <div className="space-y-2">
                                        <Label className="text-xs font-medium">
                                          Reference column
                                        </Label>
                                        <Input
                                          value={column.foreignColumn}
                                          onChange={(e) =>
                                            updateColumn(
                                              column.id,
                                              "foreignColumn",
                                              e.target.value,
                                            )
                                          }
                                          placeholder="Reference column"
                                          className="h-8"
                                        />
                                      </div>
                                    </>
                                  )}
                                </div>
                              </TabsContent>

                              {/* Default Tab */}
                              <TabsContent
                                value="default"
                                className="custom-scrollbar m-0 max-h-44 overflow-auto p-6"
                              >
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label className="text-xs font-medium">
                                      Default Value
                                    </Label>
                                    <Input
                                      value={column.defaultValue}
                                      onChange={(e) =>
                                        updateColumn(
                                          column.id,
                                          "defaultValue",
                                          e.target.value,
                                        )
                                      }
                                      placeholder="Default Value"
                                      className="h-8"
                                    />
                                  </div>

                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <div className="space-y-1">
                                        <Label className="text-xs">
                                          expression
                                        </Label>
                                        <p className="text-xs text-muted-foreground">
                                          Set the default value as an expression
                                        </p>
                                      </div>
                                      <Switch
                                        checked={column.defaultValue.includes(
                                          "expression",
                                        )}
                                        onCheckedChange={(checked) => {
                                          if (checked) {
                                            updateColumn(
                                              column.id,
                                              "defaultValue",
                                              "expression",
                                            );
                                          } else {
                                            updateColumn(
                                              column.id,
                                              "defaultValue",
                                              "",
                                            );
                                          }
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </TabsContent>

                              {/* Generated Tab */}
                              <TabsContent
                                value="generated"
                                className="custom-scrollbar m-0 max-h-44 overflow-auto p-6"
                              >
                                <div className="space-y-6">
                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <Label className="text-xs">
                                        always as identity
                                      </Label>
                                      <p className="text-xs text-muted-foreground">
                                        Identity column always generates a new
                                        value
                                      </p>
                                    </div>
                                    <Switch
                                      checked={column.autoIncrement}
                                      onCheckedChange={(checked) =>
                                        updateColumn(
                                          column.id,
                                          "autoIncrement",
                                          checked,
                                        )
                                      }
                                    />
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                      <Label className="text-xs">
                                        by default as identity
                                      </Label>
                                      <p className="text-xs text-muted-foreground">
                                        Identity column generates a new value by
                                        default
                                      </p>
                                    </div>
                                    <Switch checked={false} />
                                  </div>
                                </div>
                              </TabsContent>
                            </div>
                          </div>
                        </Tabs>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Constraints Section */}
        {/* <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">CONSTRAINTS</h3>
            <Button
              onClick={addConstraint}
              variant="link"
              size="sm"
              className="h-auto p-0"
            >
              Add constraint
            </Button>
          </div>

          <div className="space-y-2">
            {table.constraints.map((constraint) => {
              const isExpanded = expandedConstraints.includes(constraint.id);

              return (
                <Card key={constraint.id} className="overflow-hidden border">
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() =>
                      toggleConstraintExpansion(constraint.id)
                    }
                  >
                    <CollapsibleTrigger asChild>
                      <div className="w-full cursor-pointer px-4 py-2 text-xs transition-colors hover:bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDownIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            ) : (
                              <ChevronRightIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            )}
                            <div className="flex items-center gap-2">
                              <PlusIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                              <span className="font-mono">
                                {constraint.name || "constraint_name"}{" "}
                                {constraint.type}
                                {constraint.definition &&
                                  ` ${constraint.definition}`}
                              </span>
                            </div>
                          </div>

                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeConstraint(constraint.id);
                            }}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/20 hover:text-red-500"
                          >
                            <TrashIcon size={14} />
                          </Button>
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t border-border/50 bg-secondary p-6">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">
                              Constraint Name
                            </Label>
                            <Input
                              value={constraint.name}
                              onChange={(e) =>
                                updateConstraint(
                                  constraint.id,
                                  "name",
                                  e.target.value,
                                )
                              }
                              placeholder="constraint_name"
                              className="h-8"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Type</Label>
                            <Select
                              value={constraint.type}
                              onValueChange={(value) =>
                                updateConstraint(constraint.id, "type", value)
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CHECK">CHECK</SelectItem>
                                <SelectItem value="UNIQUE">UNIQUE</SelectItem>
                                <SelectItem value="FOREIGN KEY">
                                  FOREIGN KEY
                                </SelectItem>
                                <SelectItem value="EXCLUDE">EXCLUDE</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label className="text-xs font-medium">
                              Definition
                            </Label>
                            <Input
                              value={constraint.definition}
                              onChange={(e) =>
                                updateConstraint(
                                  constraint.id,
                                  "definition",
                                  e.target.value,
                                )
                              }
                              placeholder={
                                constraint.type === "CHECK"
                                  ? "age > 0"
                                  : constraint.type === "UNIQUE"
                                    ? "(email)"
                                    : constraint.type === "FOREIGN KEY"
                                      ? "(user_id) REFERENCES users(id)"
                                      : "definition"
                              }
                              className="h-8"
                            />
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        </div> */}

        {/* Indexes Section */}
        {/* <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">INDEXES</h3>
            <Button
              onClick={addIndex}
              variant="link"
              size="sm"
              className="h-auto p-0"
            >
              Add index
            </Button>
          </div>

          <div className="space-y-2">
            {table.indexes.map((index) => {
              const isExpanded = expandedIndexes.includes(index.id);

              return (
                <Card key={index.id} className="overflow-hidden border">
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={() => toggleIndexExpansion(index.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <div className="w-full cursor-pointer px-4 py-2 text-xs transition-colors hover:bg-muted/50">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDownIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            ) : (
                              <ChevronRightIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                            )}
                            <div className="flex items-center gap-2">
                              <PlusIcon
                                size={16}
                                className="text-muted-foreground"
                              />
                              <span className="font-mono">
                                {index.name || "index_name"} {index.type}
                                {index.columns.length > 0 &&
                                  ` ON (${index.columns.join(", ")})`}
                                {index.unique && " UNIQUE"}
                              </span>
                            </div>
                          </div>

                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeIndex(index.id);
                            }}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0 text-muted-foreground hover:bg-destructive/20 hover:text-red-500"
                          >
                            <TrashIcon size={14} />
                          </Button>
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="border-t border-border/50 bg-secondary p-6">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label className="text-xs font-medium">
                              Index Name
                            </Label>
                            <Input
                              value={index.name}
                              onChange={(e) =>
                                updateIndex(index.id, "name", e.target.value)
                              }
                              placeholder="idx_table_column"
                              className="h-8"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium">Type</Label>
                            <Select
                              value={index.type}
                              onValueChange={(value) =>
                                updateIndex(index.id, "type", value)
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BTREE">BTREE</SelectItem>
                                <SelectItem value="HASH">HASH</SelectItem>
                                <SelectItem value="GIN">GIN</SelectItem>
                                <SelectItem value="GIST">GIST</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium">
                              Columns
                            </Label>
                            <Select
                              value={index.columns[0] || ""}
                              onValueChange={(value) =>
                                updateIndex(index.id, "columns", [value])
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Select column" />
                              </SelectTrigger>
                              <SelectContent>
                                {table.columns.map((column) => (
                                  <SelectItem
                                    key={column.id}
                                    value={column.name}
                                  >
                                    {column.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs font-medium">
                              Unique
                            </Label>
                            <div className="flex items-center space-x-2">
                              <Switch
                                checked={index.unique}
                                onCheckedChange={(checked) =>
                                  updateIndex(index.id, "unique", checked)
                                }
                              />
                              <Label className="text-xs">Unique index</Label>
                            </div>
                          </div>

                          <div className="space-y-2 md:col-span-2">
                            <Label className="text-xs font-medium">
                              WHERE clause (optional)
                            </Label>
                            <Input
                              value={index.where || ""}
                              onChange={(e) =>
                                updateIndex(index.id, "where", e.target.value)
                              }
                              placeholder="status = 'active'"
                              className="h-8"
                            />
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        </div> */}

        {/* SQL Preview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold">SQL Preview</Label>
            <Button
              onClick={copySQL}
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              disabled={!table.name || table.columns.length === 0}
            >
              {sqlCopied ? (
                <>
                  <CheckIcon size={14} className="text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <CopyIcon size={14} />
                  Copy SQL
                </>
              )}
            </Button>
          </div>
          <div className="relative rounded-md border bg-muted p-4 font-mono text-sm">
            <pre className="whitespace-pre-wrap text-xs">
              {generateCreateTableSQL()}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostgreSQLTableCreator;
