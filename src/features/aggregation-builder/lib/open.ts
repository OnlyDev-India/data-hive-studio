import {
  composePipeline,
  getActiveSchema,
  parsePipeline,
  type ParsedPipeline,
} from "@/shared/api";
import { pickCollection } from "@/shared/components/collection-picker";
import { pickPipelineFile } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";
import { stagesFromDrafts, toSpec } from "./model";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fail(title: string, e: unknown) {
  useStudioStore
    .getState()
    .pushNotification({ kind: "error", title, detail: message(e) });
}

/** A new builder tab on a collection the user picks. */
export async function openAggregationPicked(conn_id: string): Promise<void> {
  const picked = await pickCollection(conn_id, {
    title: "New aggregation",
    description: "Pick the collection the pipeline reads from.",
  });
  if (picked)
    useStudioStore
      .getState()
      .openAggregation(conn_id, picked.database, picked.collection);
}

/** Pipeline text in a new builder tab. The collection is the one the text
 *  names, else `collection`, else one the user picks in `database`. Text
 *  that does not parse shows the parser's error and opens nothing. */
export async function openPipelineText(
  conn_id: string,
  text: string,
  {
    database,
    collection,
    file_path = null,
  }: {
    database: string;
    collection?: string | null;
    file_path?: string | null;
  },
): Promise<boolean> {
  let parsed: ParsedPipeline;
  try {
    parsed = await parsePipeline(text);
  } catch (e) {
    fail("Could not read the pipeline", e);
    return false;
  }
  let target = { database, collection: parsed.collection ?? collection ?? "" };
  if (!target.collection) {
    const picked = await pickCollection(conn_id, {
      title: "Open pipeline",
      description:
        "The pipeline names no collection. Pick the one it reads from.",
      database: database || undefined,
    });
    if (!picked) return false;
    target = picked;
  }
  const stages = stagesFromDrafts(parsed.stages);
  // A tab opened from a file starts as saved.
  let saved_text: string | null = null;
  if (file_path) {
    try {
      saved_text = (await composePipeline(target.collection, toSpec(stages)))
        .file;
    } catch {
      saved_text = null;
    }
  }
  useStudioStore
    .getState()
    .openAggregation(conn_id, target.database, target.collection, null, {
      stages,
      file_path,
      saved_text,
    });
  return true;
}

/** A picked `.js` or `.json` pipeline file in a new builder tab. `from` is
 *  the builder tab it was opened from, whose database and collection fill
 *  in what the file leaves out. */
export async function openPipelineFile(
  conn_id: string,
  from?: { database: string; collection: string },
): Promise<void> {
  try {
    const file = await pickPipelineFile();
    if (!file) return;
    const database =
      from?.database ?? (await getActiveSchema(conn_id).catch(() => ""));
    await openPipelineText(conn_id, file.text, {
      database,
      collection: from?.collection,
      file_path: file.path,
    });
  } catch (e) {
    fail("Could not open the file", e);
  }
}
