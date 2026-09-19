import type { ComponentProps } from "react";
import Markdown from "markdown-to-jsx";

/** The href as a normalized URL string when it is `http` or `https`, else
 *  null. Release notes come from `latest.json`, which the package signature
 *  does not cover, so every link is untrusted. */
export function safe_link_url(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function NoteLink({ href, children }: ComponentProps<"a">) {
  const url = safe_link_url(href);
  // Any other scheme (javascript:, file:, a bare #anchor…) is plain text.
  if (!url) return <span>{children}</span>;
  return (
    <a
      href={url}
      className="text-primary underline underline-offset-2"
      onClick={(e) => {
        // The webview would navigate itself away from the app otherwise.
        e.preventDefault();
        void import("@tauri-apps/plugin-opener")
          .then(({ openUrl }) => openUrl(url))
          .catch(() => {});
      }}
    >
      {children}
    </a>
  );
}

/** Images are not shown: a note can point at any host, and loading one is a
 *  network request the user never asked for. */
function NoImage() {
  return null;
}

const overrides = {
  h1: { props: { className: "mt-3 mb-1 text-base font-semibold" } },
  h2: { props: { className: "mt-3 mb-1 text-sm font-semibold" } },
  h3: { props: { className: "mt-2 mb-1 text-sm font-medium" } },
  h4: { props: { className: "mt-2 mb-1 text-sm font-medium" } },
  p: { props: { className: "mb-2 last:mb-0" } },
  ul: { props: { className: "mb-2 list-disc space-y-1 pl-5" } },
  ol: { props: { className: "mb-2 list-decimal space-y-1 pl-5" } },
  blockquote: {
    props: { className: "text-muted-foreground mb-2 border-l-2 pl-3" },
  },
  pre: {
    props: {
      className:
        "bg-muted mb-2 overflow-x-auto rounded-md p-2 text-xs [&>code]:bg-transparent [&>code]:p-0",
    },
  },
  code: {
    props: {
      className: "bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]",
    },
  },
  table: { props: { className: "mb-2 w-full border-collapse text-xs" } },
  th: { props: { className: "border px-2 py-1 text-left font-medium" } },
  td: { props: { className: "border px-2 py-1" } },
  hr: { props: { className: "border-border my-2" } },
  a: { component: NoteLink },
  img: { component: NoImage },
};

/** A release's notes as formatted markdown. Raw HTML in the notes is shown
 *  as inert text (`disableParsingRawHTML`), images are dropped, and only
 *  `http` and `https` links do anything. Element overrides mirror
 *  `doc-markdown.tsx`. */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <Markdown options={{ disableParsingRawHTML: true, overrides }}>
      {markdown}
    </Markdown>
  );
}
