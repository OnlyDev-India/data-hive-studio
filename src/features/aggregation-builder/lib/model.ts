import type { PipelineSpec, StageDraft, StageSpec } from "@/shared/api";
import type { AggregationBranch, AggregationStage } from "@/shared/store";
import { hasForm } from "./forms";
import { isWriteOp, operatorOf } from "./operators";

/** A chain of cards: the main chain (null), or one side chain of a main
 *  chain card. */
export type ChainRef = { parent: string; key: string } | null;

/** A card a preview refresh starts at. */
export interface StageRef {
  stage_id: string;
  branch_key?: string;
}

/** Stages whose sub pipelines show as side chains on the main chain. */
export function isBranching(op: string): boolean {
  return op === "$facet" || op === "$lookup" || op === "$unionWith";
}

/** The body a main chain card holds once its sub pipelines are side chains.
 *  `$lookup` starts simple and gets its side chain from a switch. */
const SIDE_BODY: Record<string, string> = {
  $facet: "{}",
  $unionWith: '{ coll: "collection" }',
};

function sideStart(op: string): AggregationBranch[] | null {
  if (op === "$facet")
    return [{ key: "output", stages: [newStage("$limit", true)] }];
  if (op === "$unionWith") return [{ key: "pipeline", stages: [] }];
  return null;
}

/** A new card. On the main chain a `$facet` or `$unionWith` starts with its
 *  side chain; inside a side chain it keeps its sub pipeline as JSON. */
export function newStage(op: string, inBranch = false): AggregationStage {
  const branches = inBranch ? null : sideStart(op);
  return {
    id: crypto.randomUUID(),
    op,
    body: (branches && SIDE_BODY[op]) ?? operatorOf(op)?.template ?? "{}",
    enabled: true,
    collapsed: false,
    view: hasForm(op) ? "form" : "json",
    note: null,
    title: null,
    ...(branches ? { branches } : {}),
  };
}

export function insertStage(
  stages: AggregationStage[],
  index: number,
  stage: AggregationStage,
): AggregationStage[] {
  return [...stages.slice(0, index), stage, ...stages.slice(index)];
}

/** `fn` applied to every card, side chain cards included. Unchanged chains
 *  keep their identity. */
function mapDeep(
  stages: AggregationStage[],
  fn: (s: AggregationStage) => AggregationStage,
): AggregationStage[] {
  let changed = false;
  const out = stages.map((s) => {
    let next = fn(s);
    if (next.branches) {
      let moved = false;
      const branches = next.branches.map((b) => {
        const inner = mapDeep(b.stages, fn);
        if (inner === b.stages) return b;
        moved = true;
        return { ...b, stages: inner };
      });
      if (moved) next = { ...next, branches };
    }
    if (next !== s) changed = true;
    return next;
  });
  return changed ? out : stages;
}

export function patchStage(
  stages: AggregationStage[],
  id: string,
  patch: Partial<AggregationStage>,
): AggregationStage[] {
  return mapDeep(stages, (s) => (s.id === id ? { ...s, ...patch } : s));
}

/** Every card, each side chain's cards right after their parent. */
export function allStages(stages: AggregationStage[]): AggregationStage[] {
  return stages.flatMap((s) => [
    s,
    ...(s.branches ?? []).flatMap((b) => b.stages),
  ]);
}

export function findStage(
  stages: AggregationStage[],
  id: string | null,
): AggregationStage | null {
  if (!id) return null;
  return allStages(stages).find((s) => s.id === id) ?? null;
}

/** "Stage 3", or "Stage 2 of output in stage 3" for a side chain card. */
export function stageLabel(stages: AggregationStage[], id: string): string {
  const i = stages.findIndex((s) => s.id === id);
  if (i >= 0) return `Stage ${i + 1}`;
  for (const [p, s] of stages.entries())
    for (const b of s.branches ?? []) {
      const j = b.stages.findIndex((x) => x.id === id);
      if (j >= 0) return `Stage ${j + 1} of ${b.key} in stage ${p + 1}`;
    }
  return "Stage";
}

/** The chain holding card `id`; undefined when no chain does. */
export function chainOf(
  stages: AggregationStage[],
  id: string,
): ChainRef | undefined {
  if (stages.some((s) => s.id === id)) return null;
  for (const s of stages)
    for (const b of s.branches ?? [])
      if (b.stages.some((x) => x.id === id))
        return { parent: s.id, key: b.key };
  return undefined;
}

export function chainStages(
  stages: AggregationStage[],
  ref: ChainRef,
): AggregationStage[] {
  if (!ref) return stages;
  const parent = stages.find((s) => s.id === ref.parent);
  return parent?.branches?.find((b) => b.key === ref.key)?.stages ?? [];
}

/** The pipeline with chain `ref` replaced by `fn` of it. */
export function withChain(
  stages: AggregationStage[],
  ref: ChainRef,
  fn: (chain: AggregationStage[]) => AggregationStage[],
): AggregationStage[] {
  if (!ref) return fn(stages);
  return stages.map((s) =>
    s.id === ref.parent && s.branches
      ? {
          ...s,
          branches: s.branches.map((b) =>
            b.key === ref.key ? { ...b, stages: fn(b.stages) } : b,
          ),
        }
      : s,
  );
}

export function removeStage(
  stages: AggregationStage[],
  id: string,
): AggregationStage[] {
  const ref = chainOf(stages, id);
  if (ref === undefined) return stages;
  return withChain(stages, ref, (c) => c.filter((s) => s.id !== id));
}

function withoutBranches(s: AggregationStage): AggregationStage {
  const out = { ...s };
  delete out.branches;
  return out;
}

/** A new operator for a card. The body becomes the new operator's template
 *  unless it holds the user's own text. On the main chain the side chains
 *  start over for the new operator. */
export function changeOp(
  stage: AggregationStage,
  op: string,
  inBranch = false,
): AggregationStage {
  if (op === stage.op) return stage;
  const body = stage.body.trim();
  const untouched =
    !body ||
    body === operatorOf(stage.op)?.template ||
    body === SIDE_BODY[stage.op];
  const fresh = newStage(op, inBranch);
  return {
    ...withoutBranches(stage),
    op,
    body: untouched ? fresh.body : stage.body,
    view: hasForm(op) ? stage.view : "json",
    ...(fresh.branches ? { branches: fresh.branches } : {}),
  };
}

/** A copy with new ids all the way down. */
function fresh(s: AggregationStage): AggregationStage {
  return {
    ...s,
    id: crypto.randomUUID(),
    ...(s.branches
      ? {
          branches: s.branches.map((b) => ({
            ...b,
            stages: b.stages.map(fresh),
          })),
        }
      : {}),
  };
}

/** A copy of card `id` right after it in its chain, side chains included,
 *  every card with its own id. */
export function duplicateStage(
  stages: AggregationStage[],
  id: string,
): { stages: AggregationStage[]; copy: AggregationStage | null } {
  const ref = chainOf(stages, id);
  if (ref === undefined) return { stages, copy: null };
  const chain = chainStages(stages, ref);
  const i = chain.findIndex((s) => s.id === id);
  if (isWriteOp(chain[i].op)) return { stages, copy: null };
  const copy = fresh(chain[i]);
  return {
    stages: withChain(stages, ref, (c) => insertStage(c, i + 1, copy)),
    copy,
  };
}

/** The last place a card that does not write can take: before a final
 *  `$out` or `$merge`, which stays last. */
export function lastSlot(stages: AggregationStage[]): number {
  const tail = stages.at(-1);
  return tail && isWriteOp(tail.op) ? stages.length - 1 : stages.length;
}

function moveIn(
  stages: AggregationStage[],
  id: string,
  index: number,
): AggregationStage[] {
  const from = stages.findIndex((s) => s.id === id);
  if (from < 0 || isWriteOp(stages[from].op)) return stages;
  const rest = stages.filter((s) => s.id !== id);
  const to = Math.max(0, Math.min(index, lastSlot(rest)));
  if (to === from) return stages;
  return insertStage(rest, to, stages[from]);
}

/** Card `id` moved to `index` of its chain without it. A card never leaves
 *  its chain, a write stage never moves, and nothing moves past one. */
export function moveStage(
  stages: AggregationStage[],
  id: string,
  index: number,
): AggregationStage[] {
  const ref = chainOf(stages, id);
  if (ref === undefined) return stages;
  const next = withChain(stages, ref, (c) => moveIn(c, id, index));
  return chainStages(next, ref) === chainStages(stages, ref) ? stages : next;
}

/** Why a `$facet` output name cannot be used, or null. */
export function facetKeyError(key: string, others: string[]): string | null {
  if (!key) return "An output needs a name";
  if (key.includes("$") || key.includes("."))
    return "An output name cannot hold $ or .";
  if (others.includes(key)) return `There is already an output ${key}`;
  return null;
}

/** A new, empty output on `$facet` card `parent`. */
export function addBranch(
  stages: AggregationStage[],
  parent: string,
): { stages: AggregationStage[]; key: string } {
  const keys = new Set(
    stages.find((s) => s.id === parent)?.branches?.map((b) => b.key) ?? [],
  );
  let n = 1;
  while (keys.has(n === 1 ? "output" : `output${n}`)) n++;
  const key = n === 1 ? "output" : `output${n}`;
  return {
    key,
    stages: stages.map((s) =>
      s.id === parent
        ? { ...s, branches: [...(s.branches ?? []), { key, stages: [] }] }
        : s,
    ),
  };
}

export function renameBranch(
  stages: AggregationStage[],
  parent: string,
  key: string,
  next: string,
): AggregationStage[] {
  return stages.map((s) =>
    s.id === parent && s.branches
      ? {
          ...s,
          branches: s.branches.map((b) =>
            b.key === key ? { ...b, key: next } : b,
          ),
        }
      : s,
  );
}

export function removeBranch(
  stages: AggregationStage[],
  parent: string,
  key: string,
): AggregationStage[] {
  return stages.map((s) =>
    s.id === parent && s.branches
      ? { ...s, branches: s.branches.filter((b) => b.key !== key) }
      : s,
  );
}

/** A `$lookup` card's sub pipeline switch: on gives it an empty side chain,
 *  off drops the side chain and its cards. */
export function setSubPipeline(
  stages: AggregationStage[],
  parent: string,
  on: boolean,
): AggregationStage[] {
  return stages.map((s) => {
    if (s.id !== parent) return s;
    if (on) return { ...s, branches: [{ key: "pipeline", stages: [] }] };
    return withoutBranches(s);
  });
}

function stageSpec(s: AggregationStage): StageSpec {
  return {
    id: s.id,
    op: s.op,
    body: s.body,
    enabled: s.enabled,
    title: s.title,
    note: s.note,
    ...(s.branches?.length
      ? {
          branches: s.branches.map((b) => ({
            key: b.key,
            stages: b.stages.map(stageSpec),
          })),
        }
      : {}),
  };
}

export function toSpec(stages: AggregationStage[]): PipelineSpec {
  return { stages: stages.map(stageSpec) };
}

/** What a preview depends on, per card, side chains aside. */
function previewKey(s: AggregationStage): string {
  return `${s.id}\u0000${s.op}\u0000${s.body}\u0000${s.enabled}`;
}

function chainKey(stages: AggregationStage[]): string {
  return stages.map(previewKey).join("\u0001");
}

function branchesKey(s: AggregationStage): string {
  return (s.branches ?? [])
    .map((b) => `${b.key}\u0000${chainKey(b.stages)}`)
    .join("\u0002");
}

function firstIn(
  prev: AggregationStage[],
  next: AggregationStage[],
): string | null | undefined {
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i];
    if (a && b && previewKey(a) === previewKey(b)) continue;
    if (!a && !b) continue;
    return b ? b.id : null;
  }
  return undefined;
}

/** The first card whose preview `next` changed against `prev`: an edit, an
 *  insert, a move or a toggle at that place. A removed card makes the card
 *  that took its place the first changed one. A change in one side chain
 *  starts at that chain's card; any other side chain change starts at the
 *  parent. `undefined` when nothing a preview reads changed; `null` when
 *  the change has no card left after it. */
export function firstChanged(
  prev: AggregationStage[],
  next: AggregationStage[],
): StageRef | null | undefined {
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i];
    if (!a && !b) continue;
    if (!a || !b || previewKey(a) !== previewKey(b))
      return b ? { stage_id: b.id } : null;
    if (branchesKey(a) === branchesKey(b)) continue;
    const pa = a.branches ?? [];
    const pb = b.branches ?? [];
    const same_keys =
      pa.length === pb.length && pa.every((x, k) => x.key === pb[k].key);
    if (same_keys) {
      const changed = pb.flatMap((x, k) =>
        chainKey(x.stages) === chainKey(pa[k].stages) ? [] : [k],
      );
      if (changed.length === 1) {
        const k = changed[0];
        const at = firstIn(pa[k].stages, pb[k].stages);
        if (at) return { stage_id: at, branch_key: pb[k].key };
      }
    }
    return { stage_id: b.id };
  }
  return undefined;
}

/** The cards a refresh from `from` previews, the way Rust picks them: from
 *  a main card, it and every later enabled card with their side chains;
 *  from a side chain card, the rest of that chain, then its parent and
 *  every later main card. A main chain write stage is never one. */
export function previewTargets(
  stages: AggregationStage[],
  from: StageRef | null,
): Set<string> {
  let at = 0;
  let side: { key: string; index: number } | null = null;
  if (from) {
    const main = stages.findIndex((s) => s.id === from.stage_id);
    if (main >= 0) at = main;
    else
      stages.forEach((s, i) =>
        s.branches?.forEach((b) => {
          const j = b.stages.findIndex((x) => x.id === from.stage_id);
          if (j >= 0) {
            at = i;
            side = { key: b.key, index: j };
          }
        }),
      );
  }
  const out = new Set<string>();
  const start = side as { key: string; index: number } | null;
  stages.forEach((s, i) => {
    if (i < at || !s.enabled) return;
    if (isBranching(s.op))
      for (const b of s.branches ?? []) {
        if (i === at && start && b.key !== start.key) continue;
        const skip = i === at && start ? start.index : 0;
        for (const x of b.stages.slice(skip)) if (x.enabled) out.add(x.id);
      }
    if (!isWriteOp(s.op)) out.add(s.id);
  });
  return out;
}

/** Cards read back from text, each with its own id. A main chain
 *  `$unionWith` always gets its side chain, as a new one does. */
export function stagesFromDrafts(
  drafts: StageDraft[],
  inBranch = false,
): AggregationStage[] {
  return drafts.map((d) => {
    const branches: AggregationBranch[] | null = inBranch
      ? null
      : d.branches?.length
        ? d.branches.map((b) => ({
            key: b.key,
            stages: stagesFromDrafts(b.stages, true),
          }))
        : d.op === "$unionWith"
          ? [{ key: "pipeline", stages: [] }]
          : null;
    return {
      id: crypto.randomUUID(),
      op: d.op,
      body: d.body,
      enabled: d.enabled,
      collapsed: false,
      view: hasForm(d.op) ? "form" : "json",
      note: d.note,
      title: d.title,
      ...(branches ? { branches } : {}),
    };
  });
}

/** The cards without the disabled ones, side chain cards included: what
 *  Copy hands out. */
export function enabledOnly(stages: AggregationStage[]): AggregationStage[] {
  return stages
    .filter((s) => s.enabled)
    .map((s) =>
      s.branches
        ? {
            ...s,
            branches: s.branches.map((b) => ({
              ...b,
              stages: b.stages.filter((x) => x.enabled),
            })),
          }
        : s,
    );
}
