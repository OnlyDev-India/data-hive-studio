import type {
  ImportSummary,
  LibraryDraft,
  LibraryField,
  LibraryFile,
  LibraryItem,
} from "./types";

export const NAME_MAX = 80;
export const TEXT_MAX = 100_000;
const TRIGGER_RE = /^[A-Za-z0-9_]{1,32}$/;

type Check =
  | { ok: true; draft: LibraryDraft }
  | { ok: false; field: LibraryField; message: string };

/** Trims and fills in what the rules fix: a query never has a trigger, and a
 *  blank trigger is no trigger. */
export function normalizeDraft(draft: LibraryDraft): LibraryDraft {
  const trigger = draft.trigger?.trim() ?? "";
  return {
    ...draft,
    name: draft.name.trim(),
    trigger: draft.kind === "snippet" && trigger ? trigger : null,
  };
}

export function triggerTaken(
  trigger: string,
  draft: Pick<LibraryDraft, "language">,
  items: LibraryItem[],
  selfId?: string,
): boolean {
  const t = trigger.toLowerCase();
  return items.some(
    (i) =>
      i.id !== selfId &&
      i.kind === "snippet" &&
      i.language === draft.language &&
      i.trigger?.toLowerCase() === t,
  );
}

/** The save rules every path runs (dialog, Settings, import). `selfId` is the
 *  item being edited, so its own trigger never clashes with itself. */
export function checkDraft(
  input: LibraryDraft,
  items: LibraryItem[],
  selfId?: string,
): Check {
  const draft = normalizeDraft(input);
  if (!draft.name) return fail("name", "Give it a name.");
  if (draft.name.length > NAME_MAX)
    return fail("name", `Keep the name to ${NAME_MAX} characters or fewer.`);
  if (!draft.text.trim()) return fail("text", "The text can't be blank.");
  if (draft.text.length > TEXT_MAX)
    return fail(
      "text",
      `Keep the text to ${TEXT_MAX.toLocaleString()} characters or fewer.`,
    );
  if (draft.trigger !== null) {
    if (!TRIGGER_RE.test(draft.trigger))
      return fail(
        "trigger",
        "Use up to 32 letters, digits or underscores, with no spaces.",
      );
    if (triggerTaken(draft.trigger, draft, items, selfId))
      return fail(
        "trigger",
        `Another ${draft.language === "sql" ? "SQL" : "Mongo"} snippet already uses this trigger.`,
      );
  }
  return { ok: true, draft };
}

function fail(field: LibraryField, message: string): Check {
  return { ok: false, field, message };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** An item read from storage or a file, or null when a field is missing or
 *  has the wrong type. */
export function parseItem(v: unknown): LibraryItem | null {
  if (!isObj(v)) return null;
  const { id, kind, language, name, text, trigger, created_at, updated_at } = v;
  if (typeof id !== "string" || !id) return null;
  if (kind !== "query" && kind !== "snippet") return null;
  if (language !== "sql" && language !== "mongo") return null;
  if (typeof name !== "string" || typeof text !== "string") return null;
  if (trigger !== undefined && trigger !== null && typeof trigger !== "string")
    return null;
  if (!Number.isFinite(created_at) || !Number.isFinite(updated_at)) return null;
  return {
    id,
    kind,
    language,
    name,
    text,
    trigger: (trigger as string | null | undefined) ?? null,
    created_at: created_at as number,
    updated_at: updated_at as number,
  };
}

/** The stored library, or null when it is not that shape (version 1). */
export function parseLibraryFile(v: unknown): LibraryFile | null {
  if (!isObj(v) || v.version !== 1 || typeof v.seeded !== "boolean")
    return null;
  if (!Array.isArray(v.items)) return null;
  const items: LibraryItem[] = [];
  for (const raw of v.items) {
    const item = parseItem(raw);
    if (!item) return null;
    items.push(item);
  }
  return { version: 1, seeded: v.seeded, items };
}

/** The items of an export file, still unchecked, or null when the file is not
 *  `{version: 1, items: [...]}`. */
export function parseExportFile(v: unknown): unknown[] | null {
  if (!isObj(v) || v.version !== 1 || !Array.isArray(v.items)) return null;
  return v.items;
}

export function exportFile(items: LibraryItem[]): {
  version: 1;
  items: LibraryItem[];
} {
  return { version: 1, items };
}

/** Merges imported items into the library. A new id is added; a known id
 *  keeps the copy with the newer `updated_at` (a tie keeps the existing one);
 *  a trigger already used by another snippet of the language is dropped; any
 *  other rule failure skips the item. */
export function mergeImport(
  existing: LibraryItem[],
  incoming: unknown[],
): { items: LibraryItem[]; summary: ImportSummary } {
  const items = [...existing];
  const summary: ImportSummary = {
    added: 0,
    updated: 0,
    unchanged: 0,
    triggersCleared: 0,
    skipped: 0,
  };
  for (const raw of incoming) {
    const item = parseItem(raw);
    if (!item) {
      summary.skipped++;
      continue;
    }
    const at = items.findIndex((i) => i.id === item.id);
    if (at >= 0 && item.updated_at <= items[at].updated_at) {
      summary.unchanged++;
      continue;
    }
    let check = checkDraft(item, items, item.id);
    let cleared = false;
    if (!check.ok && check.field === "trigger" && item.trigger !== null) {
      check = checkDraft({ ...item, trigger: null }, items, item.id);
      cleared = true;
    }
    if (!check.ok) {
      summary.skipped++;
      continue;
    }
    const next: LibraryItem = { ...item, ...check.draft };
    if (at >= 0) items[at] = next;
    else items.push(next);
    if (cleared) summary.triggersCleared++;
    else if (at >= 0) summary.updated++;
    else summary.added++;
  }
  return { items, summary };
}

export function summaryText(s: ImportSummary): string {
  return [
    `${s.added} added`,
    `${s.updated} updated`,
    `${s.unchanged} unchanged`,
    `${s.triggersCleared} triggers cleared`,
    `${s.skipped} skipped`,
  ].join(", ");
}

/** Case insensitive substring match on name, trigger and text. */
export function matchesSearch(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    (item.trigger?.toLowerCase().includes(q) ?? false) ||
    item.text.toLowerCase().includes(q)
  );
}

export function newestFirst(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort((a, b) => b.updated_at - a.updated_at);
}
