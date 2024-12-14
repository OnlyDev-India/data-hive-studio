import React from "react";
import { RenderCellProps } from "react-data-grid";
import { Checkbox } from "../ui/checkbox";

interface CheckBoxCellProps extends RenderCellProps<any> {
  name: string;
  disabled?: boolean;
}

const CheckBoxCell = ({
  row,
  onRowChange,
  name,
  disabled = false,
}: CheckBoxCellProps) => {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Checkbox
        id="terms"
        checked={row[name]}
        disabled={disabled}
        onCheckedChange={(checked) => onRowChange({ ...row, [name]: checked })}
      />
    </div>
  );
};

export default CheckBoxCell;
