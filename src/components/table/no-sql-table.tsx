import React, { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { 
  ChevronRight, 
  Trash2Icon, 
  FileTextIcon,
  Edit3Icon,
  CheckIcon,
  XIcon,
  PlusIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Card } from "../ui/card";
import { useSelector } from "react-redux";
import { FileTableType } from "@/types/file.type";

import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";


const NoSqlTable = ({
  rows,
  handleRemoveNewRecord,
  selectedRows,
  setSelectedRows,
}: any) => {
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto px-6 pb-4">
      {/* JSON View Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileTextIcon size={16} />
          <span className="font-medium">JSON View</span>
        </div>
        <div className="text-sm text-muted-foreground">
          {rows.length} document{rows.length !== 1 ? 's' : ''}
        </div>
      </div>

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
const JsonView = ({ rows, handleRemoveNewRecord, selectedRows, setSelectedRows }: any) => {
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
  
  const handleCheckedChanges = (checked: boolean) => {
    if (checked) {
      setSelectedRows([...selectedRows, index]);
    } else {
      setSelectedRows(selectedRows.filter((i: number) => i !== index));
    }
  };

  return (
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
      <div>
        {Object.keys(row)
          .filter((key: any) => key !== "isNew")
          .map((key: any, index: number) => (
            <SingleDataView
              objectKey={key}
              objectValue={row[key]}
              key={index}
              isNew={row.isNew}
            />
          ))}
      </div>
    </Card>
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



// Enhanced SingleDataView with in-place editing
const SingleDataView = ({ objectValue, objectKey, isNew }: any) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(objectValue);
  const [editType, setEditType] = useState(getDataType(objectValue));
  
  const isObject = typeof objectValue === "object" && objectValue !== null;
  const isArray = Array.isArray(objectValue);

  const handleSave = () => {
    // Convert value based on selected type
    let convertedValue = editValue;
    switch (editType) {
      case "number":
        convertedValue = Number(editValue);
        break;
      case "boolean":
        convertedValue = editValue === "true" || editValue === true;
        break;
      case "null":
        convertedValue = null;
        break;
      case "string":
        convertedValue = String(editValue);
        break;
    }
    
    // Here you would typically update the data in your state/store
    // For now, we'll just update the local state
    // In a real implementation, you'd dispatch an action to update the Redux store
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(objectValue);
    setEditType(getDataType(objectValue));
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex gap-2 overflow-hidden pl-6 text-sm">
        <span className="text-foreground">{objectKey}:</span>
        <div className="flex items-center gap-2">
          <Select value={editType} onValueChange={setEditType}>
            <SelectTrigger className="h-6 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string">string</SelectItem>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="boolean">boolean</SelectItem>
              <SelectItem value="null">null</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={editValue === null ? "" : String(editValue)}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-6 w-32 text-xs"
            disabled={editType === "null"}
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={handleSave} className="h-6 w-6 p-0">
              <CheckIcon size={12} />
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel} className="h-6 w-6 p-0">
              <XIcon size={12} />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1 overflow-hidden pl-6 text-sm">
      <Collapsible className="group/collapsible flex gap-1 [&[data-state=open]>svg:first-child]:rotate-90">
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
          <span className={cn("pl-2 text-foreground", { "text-black": isNew })}>
            {isArray
              ? `Array (${objectValue.length})`
              : isObject
                ? "Object"
                : ""}
          </span>
          <Badge variant="outline" className="text-xs">
            {getDataType(objectValue)}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
                onClick={() => setIsEditing(true)}
              >
                <Edit3Icon size={12} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit value</TooltipContent>
          </Tooltip>
          {isArray && (
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
              onClick={() => {/* Add array item logic */}}
            >
              <PlusIcon size={12} />
            </Button>
          )}
          {isObject && (
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100"
              onClick={() => {/* Add object property logic */}}
            >
              <PlusIcon size={12} />
            </Button>
          )}
          {isArray ? (
            <CollapsibleContent>
              <div>
                {objectValue.map((item: any, index: number) => (
                  <SingleDataView
                    objectKey={index}
                    objectValue={item}
                    key={index}
                    isNew={isNew}
                  />
                ))}
              </div>
            </CollapsibleContent>
          ) : isObject ? (
            <CollapsibleContent>
              <div>
                {objectValue &&
                  Object.keys(objectValue).map((key: any, index: number) => (
                    <SingleDataView
                      objectKey={key}
                      objectValue={objectValue[key]}
                      key={index}
                      isNew={isNew}
                    />
                  ))}
              </div>
            </CollapsibleContent>
          ) : (
            <span
              className={cn("truncate pl-1 text-primary", {
                "text-muted-foreground": !objectValue,
              })}
            >
              {objectValue ? `"${objectValue}"` : "null"}
            </span>
          )}
        </div>
      </Collapsible>
    </div>
  );
};





export default NoSqlTable;
