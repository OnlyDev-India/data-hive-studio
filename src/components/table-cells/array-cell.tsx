import { RenderCellProps } from "react-data-grid";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import React, { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { XIcon } from "lucide-react";
import { Button } from "../ui/button";

interface ArrayCellProps extends RenderCellProps<any> {
  name: string;
  disabled?: boolean;
}

const ArrayCell = ({
  row,
  onRowChange,
  name,
  disabled = false,
}: ArrayCellProps) => {
  const [array, setArray] = useState(row[name]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (Array.isArray(row[name])) {
      setArray(row[name]);
    }
  }, [row, name]);

  const handleUpdateChanges = (
    e: React.ChangeEvent<HTMLInputElement>,
    index: number,
  ) => {
    const newArray = [...array];
    newArray[index] = e.target.value;
    setArray(newArray);
  };

  const handleRemove = (index: number) => {
    const newArray = [...array];
    newArray.splice(index, 1);
    setArray(newArray);
  };

  const handleAdd = () => {
    const newArray = [...array];
    newArray.push("");
    setArray(newArray);
  };

  useEffect(() => {
    const handleUpdateRow = () => {
      onRowChange({ ...row, [name]: array });
    };
    if (!isOpen) {
      handleUpdateRow();
    }
  }, [isOpen]);

  return (
    <div className="flex h-full w-full items-center">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          disabled={disabled}
          className="flex w-full justify-start"
        >
          <p>{JSON.stringify(array)}</p>
        </PopoverTrigger>
        <PopoverContent
          className="bg-background/60 p-2 backdrop-blur-md"
          align="start"
        >
          <div className="space-y-0.5">
            {array.map((item: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                {typeof item === "string" ? (
                  <Input
                    value={item}
                    onChange={(e) => handleUpdateChanges(e, index)}
                    className="h-7 bg-secondary !text-xs focus-visible:outline-none focus-visible:ring-0"
                  />
                ) : null}
                <Button
                  variant={"ghost"}
                  size={"icon"}
                  className="h-7 w-7 [&_svg]:size-3"
                  onClick={() => handleRemove(index)}
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              variant={"ghost"}
              className="h-7 w-full bg-secondary text-foreground/45 hover:bg-secondary/60 hover:text-foreground"
              onClick={handleAdd}
            >
              Add
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default ArrayCell;
