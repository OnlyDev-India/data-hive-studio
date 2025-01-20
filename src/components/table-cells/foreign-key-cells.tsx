import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import React from "react";
import { RenderCellProps } from "react-data-grid";
import InputCell from "./input-cell";

interface ForeignKeyCellsProps extends RenderCellProps<any> {
  disabled?: boolean;
}

const ForeignKeyCells = (props: ForeignKeyCellsProps) => {
  const { row, column, disabled } = props;
  return (
    <div
      className={cn(
        "group relative flex h-full w-full items-center truncate pl-2",
        {
          "text-muted-foreground": !row[column.key],
        },
      )}
    >
      {disabled ? (
        <span className="w-full truncate">
          {!row[column.key] ? "null" : row[column.key]?.toString()}
        </span>
      ) : (
        <InputCell name={column.key} {...props} className="!border-0" />
      )}
      {/* {!row[column.key] ? "null" : row[column.key]?.toString()} */}
      <span className="invisible flex h-full items-center bg-transparent p-0 group-hover:visible">
        <Button
          variant={"ghost"}
          size={"icon"}
          className="h-7 w-7 bg-background text-muted-foreground hover:text-foreground [&_svg]:size-3"
        >
          <ExternalLinkIcon />
        </Button>
      </span>
    </div>
  );
};

export default ForeignKeyCells;
