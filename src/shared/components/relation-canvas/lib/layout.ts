import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import {
  positionsOf,
  toElkGraph,
  type LayoutRequest,
  type LayoutResult,
} from "./elk-graph";

type Elk = InstanceType<typeof ELK>;
let elk: Elk | null = null;

/** Box positions from ELK. The layout runs in ELK's own web worker, so a
 *  big schema never blocks the UI; this side only posts messages. */
export async function layoutGraph(req: LayoutRequest): Promise<LayoutResult> {
  if (req.nodes.length === 0) return {};
  elk ??= new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
  return positionsOf(await elk.layout(toElkGraph(req)));
}
