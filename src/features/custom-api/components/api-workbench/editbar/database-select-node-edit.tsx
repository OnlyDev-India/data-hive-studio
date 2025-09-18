"use client";

import { useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatabaseSelectNodeData } from "@/features/custom-api/types/custom-api.type";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";
import { compareFilter } from "@/config/filter";

const databaseSelectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  tableName: z.string().min(1, "Table name is required"),
  queryName: z.string().optional(),
  columns: z.string().optional(),
  limit: z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }, z.number().min(1).optional()),
  orderBy: z.string().optional(),
  orderDirection: z.enum(["ASC", "DESC"]).optional(),
  isCustomQuery: z.boolean().optional().default(true),
  customQuery: z.string().optional(),
  conditions: z
    .array(
      z.object({
        column: z.string().min(1, "Column is required"),
        operator: z.enum(
          compareFilter.map((filter) => filter.value) as [string, ...string[]],
        ),
        value: z.string().min(1, "Value is required"),
        logicalOperator: z.enum(["AND", "OR", "WHERE"]).optional(),
      }),
    )
    .optional(),
});

type DatabaseSelectFormData = z.infer<typeof databaseSelectSchema>;

// Use the same operator options from the global filter configuration
// Remove duplicates by using a Map to ensure unique values
const uniqueOperators = new Map();
compareFilter.forEach((filter) => {
  if (!uniqueOperators.has(filter.value)) {
    uniqueOperators.set(filter.value, {
      value: filter.value,
      label: filter.key,
    });
  }
});
const operatorOptions = Array.from(uniqueOperators.values());

const logicalOperatorOptions = [
  { value: "WHERE", label: "WHERE" },
  { value: "AND", label: "AND" },
  { value: "OR", label: "OR" },
];

export default function DatabaseSelectNodeEdit() {
  const { selectedNode, updateNode } = useWorkbenchRedux();

  // TODO: condition and order direction is not working as expected

  const currentNode = selectedNode();

  const form = useForm<DatabaseSelectFormData>({
    resolver: zodResolver(databaseSelectSchema),
    defaultValues: {
      name: "",
      tableName: "",
      queryName: "",
      columns: "",
      limit: undefined,
      orderBy: "",
      orderDirection: "ASC" as const,
      conditions: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  const {
    formState: { isDirty, errors, isValid },
  } = form;

  useEffect(() => {
    if (
      currentNode &&
      (currentNode.data as any).type === "databaseSelectNode"
    ) {
      const nodeData = currentNode.data as DatabaseSelectNodeData;
      form.reset({
        name: nodeData.name || "",
        tableName: nodeData.tableName || "",
        queryName: nodeData.queryName || "",
        columns: nodeData.columns?.join(", ") || "",
        limit: nodeData.limit || undefined,
        orderBy: nodeData.orderBy || "",
        orderDirection: (nodeData.orderDirection || "ASC") as "ASC" | "DESC",
        isCustomQuery: (nodeData as any).isCustomQuery || true,
        customQuery: (nodeData as any).customQuery || "",
      });

      // Force update the orderDirection field
      form.setValue(
        "orderDirection",
        (nodeData.orderDirection || "ASC") as "ASC" | "DESC",
        {
          shouldDirty: false,
          shouldValidate: true,
        },
      );
    }
  }, [currentNode, form]);

  const onSubmit = (data: DatabaseSelectFormData) => {
    if (!currentNode) return;

    const nodeData: DatabaseSelectNodeData = {
      ...currentNode.data,
      type: "databaseSelectNode",
      name: data.name,
      tableName: data.tableName,
      queryName: data.queryName,
      columns: data.columns
        ? data.columns
            .split(",")
            .map((col) => col.trim())
            .filter((col) => col)
        : undefined,
      limit: data.limit,
      orderBy: data.orderBy,
      orderDirection: data.orderDirection,
      isCustomQuery: data.isCustomQuery,
      customQuery: data.customQuery,
    };

    updateNode(currentNode.id, nodeData);
  };

  const addCondition = () => {
    append({
      column: "",
      operator: "equals",
      value: "",
      logicalOperator: form.watch("conditions")?.length === 0 ? "WHERE" : "AND",
    });
  };

  if (!currentNode || (currentNode.data as any).type !== "databaseSelectNode") {
    return (
      <div className="p-4">
        <h3 className="mb-2 text-lg font-semibold">Database Select Node</h3>
        <p className="text-sm text-gray-600">
          Select a database select node to edit its properties.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h3 className="mb-4 text-lg font-semibold">Edit Database Select Node</h3>
      <div className="space-y-4">
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Basic Information */}
          <div className="space-y-2">
            <Label htmlFor="name">{"Node Name*"}</Label>
            <Input
              id="name"
              {...form.register("name")}
              placeholder="Enter node name"
              className="bg-background"
            />
            {errors.name && (
              <p className="text-sm text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tableName">{"Table Name*"}</Label>
            <Input
              id="tableName"
              {...form.register("tableName")}
              placeholder="Enter table name"
              className="bg-background"
            />
            {errors.tableName && (
              <p className="text-sm text-red-600">{errors.tableName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="queryName">Query Name</Label>
            <Input
              id="queryName"
              {...form.register("queryName")}
              placeholder="Enter query name"
              className="bg-background"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="columns">Columns</Label>
            <Input
              id="columns"
              {...form.register("columns")}
              placeholder="Enter columns separated by commas (e.g., id, name, email)"
              className="bg-background"
            />
          </div>

          {/* Query Options */}
          <div className="space-y-2">
            <Label htmlFor="limit">Limit</Label>
            <Input
              id="limit"
              type="number"
              {...form.register("limit", { valueAsNumber: true })}
              placeholder="Enter limit"
              className="bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="orderBy">Order By</Label>
              <Input
                id="orderBy"
                {...form.register("orderBy")}
                placeholder="Enter column name"
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orderDirection">Order Direction</Label>
              <Select
                value={form.watch("orderDirection") || "ASC"}
                onValueChange={(value) => {
                  form.setValue("orderDirection", value as "ASC" | "DESC", {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }}
              >
                <SelectTrigger
                  className="truncate bg-background"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  <SelectValue placeholder="Select order direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASC">Ascending (ASC)</SelectItem>
                  <SelectItem value="DESC">Descending (DESC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Custom Query Option */}
          {form.watch("isCustomQuery") && (
            <div className="space-y-2">
              <Label htmlFor="customQuery">Custom SQL Query</Label>
              <Textarea
                id="customQuery"
                placeholder="SELECT * FROM users WHERE age > 25"
                className="min-h-[120px] bg-background"
                {...form.register("customQuery")}
              />
              <p className="text-xs text-muted-foreground">
                Write your custom SQL query. Use {`{tableName}`} as placeholder
                for the table name.
              </p>
            </div>
          )}

          {/* Conditions */}
          {/* {!form.watch("useCustomQuery") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addCondition}
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Condition
                </Button>
              </div>

            {fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border bg-gray-50 p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Logical</Label>
                    <Select
                      value={form.watch(`conditions.${index}.logicalOperator`)}
                      onValueChange={(value) =>
                        form.setValue(
                          `conditions.${index}.logicalOperator`,
                          value as "AND" | "OR",
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                    >
                      <SelectTrigger className="bg-background" disabled={index === 0}>
                        <SelectValue placeholder="Select operator" />
                      </SelectTrigger>
                      <SelectContent>
                        {logicalOperatorOptions.map((option, index) => (
                          <SelectItem key={index} value={option.value} disabled={index === 0}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Column</Label>
                    <Input
                      {...form.register(`conditions.${index}.column`)}
                      placeholder="Enter column name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Operator</Label>
                    <Select
                      value={form.watch(`conditions.${index}.operator`)}
                      onValueChange={(value) =>
                        form.setValue(
                          `conditions.${index}.operator`,
                          value as any,
                          { shouldDirty: true, shouldValidate: true },
                        )
                      }
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select operator" />
                      </SelectTrigger>
                      <SelectContent style={{ maxHeight: "200px" }}>
                        {operatorOptions.map((option, index) => (
                          <SelectItem key={index} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Value</Label>
                    <Input
                      {...form.register(`conditions.${index}.value`)}
                      placeholder="Enter value"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => remove(index)}
                  className="mt-2 flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Condition
                </Button>
              </div>
            ))}
            </div>
          )} */}

          <Button
            type="submit"
            disabled={!isValid || !isDirty}
            className="w-full"
          >
            Save Changes
          </Button>
        </form>
      </div>
    </div>
  );
}
