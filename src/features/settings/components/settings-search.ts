import { SHORTCUT_ACTIONS } from "@/shared/hooks/shortcut-registry";
import { FIELDS as PALETTE_FIELDS } from "./command-palette-section";

export type SectionId =
  | "appearance"
  | "command-palette"
  | "shortcuts"
  | "sql-format"
  | "library"
  | "activity"
  | "about";

export interface SettingEntry {
  section: SectionId;
  /** Matches the visible label in the section, so a result can scroll to it. */
  label: string;
  keywords?: string;
}

export const SETTING_ENTRIES: SettingEntry[] = [
  { section: "appearance", label: "Theme", keywords: "light dark auto mode" },
  { section: "appearance", label: "Accent color", keywords: "colour" },
  { section: "appearance", label: "Corners", keywords: "radius rounded" },
  { section: "appearance", label: "Font", keywords: "typeface text" },
  { section: "appearance", label: "Scaling", keywords: "zoom size" },
  ...PALETTE_FIELDS.map((f) => ({
    section: "command-palette" as const,
    label: f.label,
    keywords: `prefix keyword ${f.description}`,
  })),
  ...SHORTCUT_ACTIONS.map((a) => ({
    section: "shortcuts" as const,
    label: a.label,
    keywords: "keyboard keybinding hotkey",
  })),
  { section: "sql-format", label: "Keyword case", keywords: "upper lower" },
  { section: "sql-format", label: "Indent width", keywords: "spaces tabs" },
  {
    section: "library",
    label: "Library",
    keywords: "saved queries snippets triggers import export",
  },
  {
    section: "activity",
    label: "Save app queries",
    keywords: "history log background",
  },
  { section: "about", label: "Support information", keywords: "copy" },
  {
    section: "about",
    label: "Updates & source",
    keywords: "version update release github",
  },
];

/** Every query word must appear in the section name, label or keywords. */
export function searchSettings(
  query: string,
  sectionLabels: Map<SectionId, string>,
): SettingEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return SETTING_ENTRIES.filter((e) => {
    if (!sectionLabels.has(e.section)) return false;
    const haystack =
      `${sectionLabels.get(e.section)} ${e.label} ${e.keywords ?? ""}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
