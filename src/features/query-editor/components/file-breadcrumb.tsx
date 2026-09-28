import { ChevronRight, FileCode } from "lucide-react";
import { Fragment, useCallback, useState, type UIEvent } from "react";
import { editorSurfaceColors } from "@/shared/theme/codemirror-theme";

/** Whether the editor below is scrolled off its first line. Scroll events
 *  don't bubble, so the editor's wrapper listens in the capture phase. */
export function useEditorScrolled() {
  const [scrolled, setScrolled] = useState(false);
  const onScrollCapture = useCallback((e: UIEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    if (el.classList.contains("cm-scroller")) setScrolled(el.scrollTop > 0);
  }, []);
  return { scrolled, onScrollCapture };
}

/** VS Code style path strip for a tab tied to a file on disk. Folder
 *  segments shrink first, so the file name stays visible in narrow panes. */
export function FileBreadcrumb({
  path,
  scrolled = false,
}: {
  path: string;
  scrolled?: boolean;
}) {
  const segments = path.split(/[/\\]/).filter(Boolean);
  const last = segments.length - 1;
  return (
    <div
      className="relative z-10 flex min-w-0 shrink-0 items-center gap-0.5 px-3 py-0.5 text-xs"
      style={{
        backgroundColor: editorSurfaceColors.background,
        color: editorSurfaceColors.muted,
        boxShadow: scrolled ? "0 6px 6px -6px #000" : undefined,
      }}
      title={path}
      data-testid="file-breadcrumb"
    >
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
          {i === last ? (
            <span
              className="flex shrink-0 items-center gap-1"
              style={{ color: editorSurfaceColors.foreground }}
            >
              <FileCode className="size-3.5" />
              {seg}
            </span>
          ) : (
            <span className="min-w-0 truncate">{seg}</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
