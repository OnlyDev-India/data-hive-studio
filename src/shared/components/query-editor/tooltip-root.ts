/** Shared host for every editor's `tooltips({ parent })` (query-editor's SQL/
 *  Mongo console, bson-json-editor's row viewer). CodeMirror appends one
 *  child container per LIVE editor into whatever `parent` it's given —
 *  pointing that straight at `document.body` meant every open editor (the
 *  JSON row panel, its expanded dialog, the SQL console, …) left its own
 *  unlabeled `<div class="ͼ1 ͼ3 …">` as a direct child of `<body>`, which
 *  read as stray/leaked elements in devtools even though each one is
 *  properly removed when its editor unmounts. Routing every editor through
 *  one lazily created, clearly-named root keeps `<body>` itself down to a
 *  single recognizable child — the per-editor containers still land outside
 *  every editor's own clipping/transformed ancestors, same as before. */
let root: HTMLElement | null = null;

export function getTooltipRoot(): HTMLElement {
  if (!root) {
    root = document.createElement("div");
    root.id = "cm-tooltip-root";
    document.body.appendChild(root);
  }
  return root;
}
