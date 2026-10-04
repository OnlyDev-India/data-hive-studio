import type { FieldShape } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import { isWriteOp } from "./operators";
import { isWrapper } from "./scalar";
import type { CardPreview } from "./use-previews";

/** Every dotted path in some preview documents, sorted. Arrays of documents
 *  add their elements' paths under the array's own, the way a query reads
 *  them. */
export function docPaths(docs: unknown[]): string[] {
  const seen = new Set<string>();
  const walk = (v: unknown, prefix: string) => {
    if (Array.isArray(v)) {
      for (const item of v) walk(item, prefix);
      return;
    }
    if (!v || typeof v !== "object" || isWrapper(v)) return;
    for (const [k, w] of Object.entries(v)) {
      const path = prefix ? `${prefix}.${k}` : k;
      seen.add(path);
      walk(w, path);
    }
  };
  for (const d of docs) walk(d, "");
  return [...seen].sort();
}

export function treePaths(tree: FieldShape[]): string[] {
  const out: string[] = [];
  const walk = (nodes: FieldShape[]) => {
    for (const n of nodes) {
      out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** A plain string field of a card's body text, such as `from` in
 *  `{ from: "items", ... }`; null when the body has none. */
export function bodyString(body: string, key: string): string | null {
  const m = new RegExp(
    `(?:^|[{,\\s])["']?${key}["']?\\s*:\\s*(["'])(.*?)\\1`,
  ).exec(body);
  return m ? m[2] : null;
}

/** The collection a `$lookup` (`from`) or `$unionWith` (`coll`, or the
 *  plain string form) card reads, from its body text. */
export function joinedCollection(s: AggregationStage): string | null {
  if (s.op === "$lookup") return bodyString(s.body, "from");
  if (s.op !== "$unionWith") return null;
  const plain = /^(["'])(.+)\1$/.exec(s.body.trim());
  return plain ? plain[2] : bodyString(s.body, "coll");
}

/** Field suggestions down one chain, starting from `input`. */
function chainFields(
  chain: AggregationStage[],
  input: string[],
  previews: Record<string, CardPreview>,
  fallback: string[],
  out: Record<string, string[]>,
): string[] {
  for (const s of chain) {
    out[s.id] = input;
    if (!s.enabled || isWriteOp(s.op)) continue;
    const chunk = previews[s.id]?.chunk;
    input = chunk && !chunk.error ? docPaths(chunk.documents) : fallback;
  }
  return input;
}

/** The fields each card can pick from: what the card before it puts out in
 *  its preview, or the collection's own fields for the first card and for a
 *  card whose input has no usable preview yet. A `$facet` output starts
 *  from its parent's input, a `$lookup` or `$unionWith` side chain from the
 *  fields of the collection it reads (`trees` by name). A card keeps the
 *  list from the last preview while a new one runs. */
export function fieldSuggestions(
  stages: AggregationStage[],
  previews: Record<string, CardPreview>,
  tree: string[],
  trees: Record<string, string[]> = {},
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let input: string[] = tree;
  for (const s of stages) {
    for (const b of s.branches ?? []) {
      const joined = joinedCollection(s);
      const start =
        s.op === "$facet" ? input : ((joined ? trees[joined] : null) ?? []);
      chainFields(b.stages, start, previews, start, out);
    }
    input = chainFields([s], input, previews, tree, out);
  }
  return out;
}
