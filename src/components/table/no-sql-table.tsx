import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ChevronRight, Trash2Icon, Edit3Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Card } from "../ui/card";
import { useDispatch, useSelector } from "react-redux";
import { FileTableType } from "@/types/file.type";

import { Badge } from "../ui/badge";
import { EditorModal } from "./editor-modal";
import { updateFile } from "@/redux/features/open-files";

const NoSqlTable = ({
  rows,
  handleRemoveNewRecord,
  selectedRows,
  setSelectedRows,
}: any) => {
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto px-6 pb-4">
      {/* JSON View Content */}
      <JsonView
        rows={rows}
        handleRemoveNewRecord={handleRemoveNewRecord}
        selectedRows={selectedRows}
        setSelectedRows={setSelectedRows}
      />
    </div>
  );
};

// JSON View Component
const JsonView = ({
  rows,
  handleRemoveNewRecord,
  selectedRows,
  setSelectedRows,
}: any) => {
  return (
    <div className="space-y-4">
      {rows.map((row: any, index: number) => (
        <DataView
          key={index}
          row={row}
          index={index}
          handleRemoveNewRecord={handleRemoveNewRecord}
          selectedRows={selectedRows}
          setSelectedRows={setSelectedRows}
        />
      ))}
    </div>
  );
};

// Enhanced DataView for JSON format
const DataView = ({
  row,
  index,
  handleRemoveNewRecord,
  selectedRows,
  setSelectedRows,
}: any) => {
  const isChecked = selectedRows && selectedRows.includes(index);
  const { currentFile }: { currentFile: FileTableType } = useSelector(
    (state: any) => state.openFiles,
  );
  const dispatch = useDispatch();
  const handleCheckedChanges = (checked: boolean) => {
    if (checked) {
      setSelectedRows([...selectedRows, index]);
    } else {
      setSelectedRows(selectedRows.filter((i: number) => i !== index));
    }
  };

  const handleSaveObject = (type: string) => {
    switch (type) {
      case "update":
        dispatch(
          updateFile({
            id: currentFile?.id,
            tableOperations: {
              ...currentFile?.tableOperations,
              changedRows: {},
            },
          }),
        );
        return;
    }
  };

  return (
    <>
      <Card
        className={cn(
          "group relative rounded-lg bg-background/70 py-6 backdrop-blur-sm",
          { "bg-yellow-100": row.isNew },
          { "bg-destructive/20": isChecked },
        )}
      >
        {currentFile?.tableName && (
          <>
            <div className="absolute left-2 top-2 flex items-center gap-2">
              <Checkbox
                checked={isChecked}
                className={cn("invisible group-hover:visible", {
                  visible: selectedRows && selectedRows.length > 0,
                })}
                onCheckedChange={handleCheckedChanges}
              />
            </div>
            <div className="absolute right-2 top-2 flex items-center gap-2">
              <EditorModal
                data={row}
                onSave={handleSaveObject}
                title="Edit Object"
                index={index}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="invisible h-7 px-3 text-xs group-hover:visible"
                >
                  <Edit3Icon size={12} className="mr-1" />
                </Button>
              </EditorModal>
              {row.isNew && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 border border-border bg-secondary [&_svg]:size-3"
                  onClick={() => handleRemoveNewRecord(index)}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
          </>
        )}
        <div className="space-y-1">
          {Object.keys(row)
            .filter((key: any) => key !== "isNew")
            .map((key: any, fieldIndex: number) => (
              <SingleDataView
                objectKey={key}
                objectValue={row[key]}
                key={fieldIndex}
                isNew={row.isNew}
                originalValue={row[key]}
              />
            ))}
        </div>
      </Card>
    </>
  );
};

// Helper function for data type detection
const getDataType = (value: any): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "unknown";
};

// Simplified SingleDataView for display only
const SingleDataView = ({
  objectValue,
  objectKey,
  isNew,
  originalValue,
}: any) => {
  const isObject = typeof objectValue === "object" && objectValue !== null;
  const isArray = Array.isArray(objectValue);

  return (
    <div className="flex justify-between gap-1 overflow-hidden pl-6 text-sm">
      <Collapsible
        className={
          "group/collapsible flex w-full flex-col gap-1 [&[data-state=open]>svg:first-child]:rotate-90"
        }
      >
        <div className="flex items-center gap-1">
          <CollapsibleTrigger
            asChild
            className={cn({ invisible: !isObject && !isArray })}
          >
            <ChevronRight
              className="min-w-4 text-muted-foreground transition-transform hover:text-foreground"
              size={16}
            />
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            <span className={cn("text-foreground", { "text-black": isNew })}>
              {objectKey}:
            </span>
          </div>
          {!isArray && !isObject && (
            <div className="flex items-center gap-2">
              <span
                className={cn("truncate pl-1 text-primary", {
                  "text-muted-foreground": !objectValue,
                })}
              >
                {objectValue ? `"${objectValue}"` : "null"}
              </span>
            </div>
          )}
        </div>

        {isArray ? (
          <CollapsibleContent className="w-full">
            <div className="w-full">
              {objectValue.map((item: any, index: number) => (
                <SingleDataView
                  objectKey={index}
                  objectValue={item}
                  key={index}
                  isNew={isNew}
                  originalValue={objectValue[index]}
                />
              ))}
            </div>
          </CollapsibleContent>
        ) : (
          isObject && (
            <CollapsibleContent className="w-full">
              <div className="w-full">
                {objectValue &&
                  Object.keys(objectValue).map((key: any, index: number) => (
                    <SingleDataView
                      objectKey={key}
                      objectValue={objectValue[key]}
                      key={index}
                      isNew={isNew}
                      originalValue={objectValue[key]}
                    />
                  ))}
              </div>
            </CollapsibleContent>
          )
        )}
      </Collapsible>
      <Badge
        variant="outline"
        className="mr-2 h-6 w-16 truncate text-center text-xs"
      >
        {getDataType(objectValue)}
        {isArray ? `Array (${objectValue.length})` : ""}
      </Badge>
    </div>
  );
};

export default NoSqlTable;
