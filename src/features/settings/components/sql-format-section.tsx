import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";

const KEYWORD_CASES: {
  id: "preserve" | "upper" | "lower";
  label: string;
  preview: string;
}[] = [
  { id: "preserve", label: "Preserve", preview: "select * from users" },
  { id: "upper", label: "Upper", preview: "SELECT * FROM users" },
  { id: "lower", label: "Lower", preview: "select * from users" },
];

/** Fixed stops, not a free-form number input — same "pick one of a few"
 *  pattern as Appearance's Scaling row. */
const INDENT_WIDTHS = [2, 4, 8];

/** The `sql-formatter` options behind the SQL editor's "Format" toolbar
 *  button — previously always `preserve` case at 2-space indent. */
export function SqlFormatSection() {
  const keyword_case = useStudioStore((s) => s.sqlFormatKeywordCase);
  const setKeywordCase = useStudioStore((s) => s.setSqlFormatKeywordCase);
  const indent_width = useStudioStore((s) => s.sqlFormatIndentWidth);
  const setIndentWidth = useStudioStore((s) => s.setSqlFormatIndentWidth);

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">SQL Format</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Options for the SQL editor's Format button. Keyword case also applies
          to keyword suggestions.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <SettingCard label="Keyword case" className="col-span-2">
          <div className="flex flex-wrap gap-2">
            {KEYWORD_CASES.map((c) => (
              <button
                key={c.id}
                aria-label={`Keyword case ${c.label}`}
                aria-pressed={keyword_case === c.id}
                onClick={() => setKeywordCase(c.id)}
                title={c.preview}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-2 text-sm transition-colors",
                  keyword_case === c.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
                )}
              >
                <span className="font-medium">{c.label}</span>
                <code className="text-2xs font-mono">{c.preview}</code>
              </button>
            ))}
          </div>
        </SettingCard>

        <SettingCard label="Indent width">
          <div className="flex flex-wrap gap-2">
            {INDENT_WIDTHS.map((n) => (
              <button
                key={n}
                aria-label={`Indent width ${n} spaces`}
                aria-pressed={indent_width === n}
                onClick={() => setIndentWidth(n)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2 text-sm transition-colors",
                  indent_width === n
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
                )}
              >
                <span className="font-medium">{n}</span>
                <span className="text-2xs">spaces</span>
              </button>
            ))}
          </div>
        </SettingCard>
      </div>
    </div>
  );
}

function SettingCard({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-muted/40 flex flex-col gap-2.5 rounded-xl border p-4",
        className,
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
