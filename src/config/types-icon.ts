import {
  BinaryIcon,
  Brackets,
  ClockIcon,
  HashIcon,
  UserIcon,
  WholeWordIcon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  CodeIcon,
  PercentIcon,
  CurlyBracesIcon,
  CircleOffIcon,
} from "lucide-react";

export const TypeIcons = {
  // JSON types
  objectid: CurlyBracesIcon,
  object: CurlyBracesIcon,
  null: CircleOffIcon,

  // Text types
  text: WholeWordIcon,
  varchar: WholeWordIcon,
  char: WholeWordIcon,
  string: WholeWordIcon,

  // Numeric types
  integer: HashIcon,
  int: HashIcon,
  bigint: HashIcon,
  smallint: HashIcon,
  decimal: PercentIcon,
  numeric: PercentIcon,
  float: PercentIcon,
  double: PercentIcon,
  real: PercentIcon,

  // Date/Time types
  timestamp: ClockIcon,
  "timestamp without time zone": ClockIcon,
  "timestamp with time zone": ClockIcon,
  date: CalendarIcon,
  time: ClockIcon,
  datetime: ClockIcon,

  // Boolean types
  boolean: BinaryIcon,
  bool: BinaryIcon,

  // Complex types
  array: Brackets,
  json: CodeIcon,
  jsonb: CodeIcon,

  // Other types
  "user-defined": UserIcon,
  blob: DatabaseIcon,
  clob: FileTextIcon,
  xml: CodeIcon,
  uuid: HashIcon,
};

export type TypeIconsType = keyof typeof TypeIcons;
