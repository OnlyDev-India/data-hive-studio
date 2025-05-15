import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ChevronRight, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import EditJsonRow from "../table-cells/edit-json-row";
import { Checkbox } from "../ui/checkbox";
import { Card } from "../ui/card";
import { useSelector } from "react-redux";
import { FileTableType } from "@/types/file.type";

const NoSqlTable = ({
  rows,
  handleRemoveNewRecord,
  selectedRows,
  setSelectedRows,
}: any) => {
  return (
    <div className="flex h-full flex-col gap-2 overflow-auto px-6 pb-4">
      {rows.map((row: any, index: number) => {
        return (
          <DataView
            key={index}
            row={row}
            index={index}
            handleRemoveNewRecord={handleRemoveNewRecord}
            selectedRows={selectedRows}
            setSelectedRows={setSelectedRows}
          />
        );
      })}
    </div>
  );
};

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
                // "!invisible": !currentFile?.tableName,
              })}
              onCheckedChange={handleCheckedChanges}
            />
          </div>
          <div className="absolute right-2 top-2 flex items-center gap-2">
            <EditJsonRow data={row} index={index} />
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

const SingleDataView = ({ objectValue, objectKey, isNew }: any) => {
  const isObject = typeof objectValue === "object";
  const isArray = Array.isArray(objectValue);
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
        <div>
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
