import { maskStringsAndComments } from "@/shared/lib/utils";
import type { BuilderQuery } from "@/shared/store";

/** What Open in SQL editor and Copy SQL send: the picked queries when two
 *  or more are picked, else every query, in canvas order. */
export function sendSet(
  queries: BuilderQuery[],
  picked: string[],
): BuilderQuery[] {
  return picked.length >= 2 ? pickedSet(queries, picked) : queries;
}

/** The picked queries in canvas order. */
export function pickedSet(
  queries: BuilderQuery[],
  picked: string[],
): BuilderQuery[] {
  const set = new Set(picked);
  return queries.filter((q) => set.has(q.id));
}

/** One script: each statement ends with `;`, a named one has its
 *  `-- name: <text>` line above it, and a blank line sits between. */
export function scriptText(
  items: { name: string | null; text: string }[],
): string {
  return items
    .map(({ name, text }) => {
      const bare = text.trim().replace(/;\s*$/, "");
      // A trailing line comment would swallow the `;`.
      const comment =
        maskStringsAndComments(bare).trimEnd().length < bare.length;
      const body = `${bare}${comment ? "\n" : ""};`;
      const label = name?.trim();
      return label ? `-- name: ${label}\n${body}` : body;
    })
    .join("\n\n");
}
