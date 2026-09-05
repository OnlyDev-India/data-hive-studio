import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui";
import {
  useStudioStore,
  DEFAULT_PALETTE_KEYWORDS,
  type PaletteKeywords,
} from "@/shared/store";

const FIELDS: {
  key: keyof PaletteKeywords;
  label: string;
  description: string;
}[] = [
  {
    key: "schema",
    label: "Open schema",
    description: "Opens a table/collection's Schema view directly",
  },
  {
    key: "table",
    label: "Search tables",
    description: "Narrows the palette to tables/collections only",
  },
  {
    key: "conn",
    label: "Search connections",
    description: "Narrows the palette to open connections only",
  },
  {
    key: "tab",
    label: "Search open tabs",
    description: "Narrows the palette to already-open tabs only",
  },
  {
    key: "diss",
    label: "Disconnect connection",
    description: "Lists open connections to disconnect from",
  },
];

/** The editable part is the word before the fixed `:` — the colon itself is
 *  never user-editable, only appended back when a word is saved. */
function wordOf(fullKeyword: string): string {
  return fullKeyword.endsWith(":") ? fullKeyword.slice(0, -1) : fullKeyword;
}

function wordsOf(keywords: PaletteKeywords): Record<keyof PaletteKeywords, string> {
  const entries = Object.entries(keywords) as [keyof PaletteKeywords, string][];
  return Object.fromEntries(entries.map(([k, v]) => [k, wordOf(v)])) as Record<
    keyof PaletteKeywords,
    string
  >;
}

function validateWord(
  key: keyof PaletteKeywords,
  word: string,
  drafts: Record<keyof PaletteKeywords, string>,
): string | null {
  if (!word) return "Can't be empty.";
  if (word.startsWith(">")) return `">" is reserved for commands.`;
  for (const other of Object.keys(drafts) as (keyof PaletteKeywords)[]) {
    if (other !== key && drafts[other].trim().toLowerCase() === word.toLowerCase()) {
      return "Already used by another prefix.";
    }
  }
  return null;
}

/** Lets the user rename the command palette's `schema:`/`table:`/`conn:`/
 *  `tab:` trigger prefixes (Cmd/Ctrl+P). `>` (app commands) is fixed and not
 *  editable here, and neither is the trailing `:` on the other four — only
 *  the word before it is; the colon renders as a fixed suffix next to the
 *  input and typing one is simply stripped. Each field is a local draft
 *  committed on blur/Enter, so a half-typed or invalid value never corrupts
 *  the live palette mid-edit. */
export function CommandPaletteSection() {
  const keywords = useStudioStore((s) => s.paletteKeywords);
  const setKeyword = useStudioStore((s) => s.setPaletteKeyword);
  const resetKeywords = useStudioStore((s) => s.resetPaletteKeywords);

  const [drafts, setDrafts] = useState<Record<keyof PaletteKeywords, string>>(
    () => wordsOf(keywords),
  );
  const [errors, setErrors] = useState<
    Partial<Record<keyof PaletteKeywords, string>>
  >({});

  const commit = (key: keyof PaletteKeywords) => {
    const word = drafts[key].trim();
    const err = validateWord(key, word, drafts);
    setErrors((e) => ({ ...e, [key]: err ?? undefined }));
    if (err) return;
    if (word !== drafts[key]) setDrafts((d) => ({ ...d, [key]: word }));
    const full = `${word}:`;
    if (full !== keywords[key]) setKeyword(key, full);
  };

  const handle_reset = () => {
    resetKeywords();
    setDrafts(wordsOf(DEFAULT_PALETTE_KEYWORDS));
    setErrors({});
  };

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Command Palette</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Customize the search prefixes used in the command palette
          (Cmd/Ctrl+P). The command-mode prefix (
          <code className="bg-muted rounded px-1 py-0.5">&gt;</code>) is
          fixed.
        </p>
      </header>

      <div className="divide-border divide-y rounded-xl border">
        {FIELDS.map(({ key, label, description }) => (
          <div
            key={key}
            className="flex items-center justify-between gap-6 px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-muted-foreground text-xs">
                {description}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <Input
                  value={drafts[key]}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      // The colon isn't part of the editable word — strip
                      // any typed so it can't be duplicated/removed here.
                      [key]: e.target.value.replace(/:/g, ""),
                    }))
                  }
                  onBlur={() => commit(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-28 text-right font-mono text-xs"
                />
                <span
                  aria-hidden
                  className="text-muted-foreground select-none font-mono text-xs"
                >
                  :
                </span>
              </div>
              {errors[key] && (
                <span className="text-destructive text-xs">{errors[key]}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className="w-fit"
        disabled={
          JSON.stringify(keywords) === JSON.stringify(DEFAULT_PALETTE_KEYWORDS)
        }
        onClick={handle_reset}
      >
        <RotateCcw className="size-4" /> Reset to defaults
      </Button>
    </div>
  );
}
