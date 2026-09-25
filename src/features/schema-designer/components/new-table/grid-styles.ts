/** Shared look of the designer grids: ruled cells and a solid header, so rows
 *  scrolling underneath never show through. */
export const TH =
  "bg-muted text-foreground sticky top-0 z-10 border-b border-l px-3 py-1 text-left text-sm font-medium whitespace-nowrap first:border-l-0";
/** The narrow row number column. */
export const TH_NUM = TH.replace("px-3", "px-1");
export const TD_NUM = "border-b px-1";
export const TD = "border-b border-l px-2 first:border-l-0";
export const ROW_PAD = "py-1";

export const EMPTY_HINT = "text-muted-foreground px-4 py-6 text-sm";
