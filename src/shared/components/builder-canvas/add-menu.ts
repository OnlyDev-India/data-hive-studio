import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";

/** A place a new card can go: `index` in a chain, the main one when `chain`
 *  is absent. The chain is the builder's own value. */
export interface AddPlace {
  index: number;
  chain?: unknown;
}

/** How the canvas offers new cards. The builder wraps `trigger` in its own
 *  picker for `place`; `end` is the "Add" button under a chain. */
export interface AddMenu {
  render: (place: AddPlace, trigger: ReactElement, end: boolean) => ReactNode;
  /** "stage" or "clause", for labels. */
  noun: string;
}

export const AddMenuContext = createContext<AddMenu | null>(null);

export function useAddMenu(): AddMenu {
  const menu = useContext(AddMenuContext);
  if (!menu) throw new Error("useAddMenu outside a builder canvas");
  return menu;
}
