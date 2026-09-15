/** A generic "turn a pasted list into a quoted, joined string" transform —
 *  more configurable than `pasteAsSqlInCondition` (fixed single-quote/comma/
 *  parens), used by the delimited-list builder dialog. */
export interface DelimitedListSettings {
  /** Splits the source text into items. `\n`/`\t`/`\r` are recognized as
   *  escape sequences (so "split on tab" can be typed literally); any other
   *  string is used as a literal separator. */
  splitOn: string;
  /** Wraps each item — "" for no quoting, otherwise the item's own
   *  occurrences of the quote character are doubled (SQL-style escaping). */
  quote: string;
  /** Joins the quoted items back together. */
  joinWith: string;
}

export const DEFAULT_DELIMITED_LIST_SETTINGS: DelimitedListSettings = {
  splitOn: "\\n",
  quote: "'",
  joinWith: ", ",
};

function resolveEscapes(s: string): string {
  return s
    .replaceAll("\\n", "\n")
    .replaceAll("\\t", "\t")
    .replaceAll("\\r", "\r");
}

export function buildDelimitedList(
  input: string,
  { splitOn, quote, joinWith }: DelimitedListSettings,
): string {
  const sep = resolveEscapes(splitOn) || "\n";
  const items = input
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
  const quoted = items.map((item) =>
    quote ? quote + item.replaceAll(quote, quote + quote) + quote : item,
  );
  return quoted.join(joinWith);
}
