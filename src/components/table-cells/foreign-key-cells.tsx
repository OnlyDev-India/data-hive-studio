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
        "relative group w-full h-full pl-2 truncate flex items-center",
        {
          "text-muted-foreground": !row[column.key],
        }
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
      <span className="invisible h-full p-0 bg-transparent group-hover:visible flex items-center">
        <Button
          variant={"ghost"}
          size={"icon"}
          className="h-7 w-7 [&_svg]:size-3 bg-background text-muted-foreground hover:text-foreground"
        >
          <ExternalLinkIcon />
        </Button>
      </span>
    </div>
  );
};

export default ForeignKeyCells;
