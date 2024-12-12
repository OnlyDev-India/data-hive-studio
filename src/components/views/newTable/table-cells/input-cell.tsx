import React from "react";
import { RenderCellProps } from "react-data-grid";
import { Input } from "../../../ui/input";

interface InputCellProps extends RenderCellProps<any> {
  name: string;
}

const InputCell = ({ row, onRowChange, name }: InputCellProps) => {
  return (
    <Input
      value={row[name]}
      title="Double click to edit"
      onChange={(e) => onRowChange({ ...row, [name]: e.target.value })}
      className="focus-visible:outline-none focus-visible:ring-0 border-0 p-0 focus-visible:border-b-2 hover:border-b-2 border-primary rounded-none"
    />
  );
};

export default InputCell;
