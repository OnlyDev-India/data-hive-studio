import {
  BinaryIcon,
  Brackets,
  ClockIcon,
  HashIcon,
  UserIcon,
  WholeWordIcon,
} from "lucide-react";

export const TypeIcons = {
  text: WholeWordIcon,
  boolean: BinaryIcon,
  bool: BinaryIcon,
  "user-defined": UserIcon,
  "timestamp without time zone": ClockIcon,
  timestamp: ClockIcon,
  array: Brackets,
  integer: HashIcon,
};

export type TypeIconsType = keyof typeof TypeIcons;
