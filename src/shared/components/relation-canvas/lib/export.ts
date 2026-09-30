import type { Node, ReactFlowInstance } from "@xyflow/react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@/shared/api/connection";
import { WEB } from "@/shared/api/web";

export type ExportFormat = "png" | "svg";

const PAD = 32;
/** WebKit refuses canvases past this many pixels a side. */
const MAX_SIDE = 16384;

function dataUrlBytes(url: string): Uint8Array {
  const [head, body] = url.split(",", 2);
  if (head.includes(";base64")) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Render every box of the diagram (not just what is on screen) and save
 *  it: the native save dialog on desktop, a download on the web. Returns
 *  where it went, or null when the save was cancelled. */
export async function exportDiagram<N extends Node>(
  rf: ReactFlowInstance<N>,
  wrapper: HTMLElement | null,
  format: ExportFormat,
  baseName: string,
): Promise<string | null> {
  const viewport = wrapper?.querySelector<HTMLElement>(".react-flow__viewport");
  const nodes = rf.getNodes();
  if (!wrapper || !viewport || nodes.length === 0)
    throw new Error("There is nothing to export.");
  const bounds = rf.getNodesBounds(nodes);
  const width = Math.ceil(bounds.width + PAD * 2);
  const height = Math.ceil(bounds.height + PAD * 2);
  const { toPng, toSvg } = await import("html-to-image");
  const options = {
    backgroundColor: getComputedStyle(wrapper).backgroundColor,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px) scale(1)`,
    },
  };
  const url =
    format === "png"
      ? await toPng(viewport, {
          ...options,
          pixelRatio: Math.min(2, MAX_SIDE / Math.max(width, height)),
        })
      : await toSvg(viewport, options);
  const bytes = dataUrlBytes(url);
  const name = `${baseName}.${format}`;
  if (WEB) {
    download(name, bytes, format === "png" ? "image/png" : "image/svg+xml");
    return name;
  }
  const path = await save({
    defaultPath: name,
    filters: [
      {
        name: format === "png" ? "PNG image" : "SVG image",
        extensions: [format],
      },
    ],
  });
  if (!path || Array.isArray(path)) return null;
  await writeFile(path, Array.from(bytes));
  return path;
}

/** `<database or file>-<schema>-diagram`, the default export file name. */
export function exportBase(
  conn: { name: string },
  database?: string,
  schema?: string,
): string {
  const db = (database ?? conn.name).replace(/\.(db|sqlite3?)$/i, "");
  return [db, schema, "diagram"].filter(Boolean).join("-");
}
