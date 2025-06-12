import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLinkIcon } from "lucide-react";
import React from "react";
import { RenderCellProps } from "react-data-grid";
import InputCell from "./input-cell";
import { useDispatch } from "react-redux";
import { addTableFile } from "@/redux/features/open-files";
import { ColumnProps } from "../table";
interface ForeignKeyCellsProps extends Omit<RenderCellProps<any>, "column"> {
  disabled?: boolean;
  column: ColumnProps;
}

const ForeignKeyCells = (props: ForeignKeyCellsProps) => {
  const { row, column, disabled } = props;
  const dispatch = useDispatch();
  const handleOpenFile = () => {
    dispatch(
      addTableFile({
        table_name: column.foreignTable,
        tableFilter: {
          filter: {
            oldFilter: [],
            newFilter: [
              {
                column: column.foreignColumn,
                compare: "equals",
                value: row[column.key],
                separator: "WHERE",
              },
            ],
          },
          applyFilter: true,
          filterOpened: false,
        },
      }),
    );
  };
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
          onClick={() => handleOpenFile()}
        >
          <ExternalLinkIcon />
        </Button>
      </span>
    </div>
  );
};

export default ForeignKeyCells;
