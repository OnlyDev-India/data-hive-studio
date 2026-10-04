import { useCallback, useEffect } from "react";
import {
  composePipeline,
  writeFile,
  type ComposedPipeline,
} from "@/shared/api";
import { pickPipelineSavePath } from "@/shared/lib/platform";
import {
  DEFAULT_AGGREGATION_SETUP,
  useStudioStore,
  type AggregationSetup,
} from "@/shared/store";
import { toSpec } from "./model";

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p;

/** A builder tab's file: Save writes the pipeline in the comment marker
 *  format, and the tab registers like an editor tab so the strip shows the
 *  file name and the dirty dot and closing asks first. Only a tab tied to a
 *  file is ever unsaved. */
export function usePipelineFile({
  tab_key,
  collection,
  setup,
  composed,
}: {
  tab_key: string;
  collection: string;
  setup: AggregationSetup;
  composed: ComposedPipeline | null;
}) {
  const is_dirty =
    !!setup.file_path && !!composed && composed.file !== setup.saved_text;
  const file_name = setup.file_path ? basename(setup.file_path) : null;

  const save = useCallback(
    async (as = false): Promise<boolean> => {
      const notify = (title: string, detail: string) =>
        useStudioStore
          .getState()
          .pushNotification({ kind: "error", title, detail });
      const cur =
        useStudioStore.getState().aggregationTabs[tab_key] ??
        DEFAULT_AGGREGATION_SETUP;
      try {
        const c = await composePipeline(collection, toSpec(cur.stages));
        if (c.errors.length > 0) {
          notify(
            "Could not save the pipeline",
            "Fix or disable the stages with errors first.",
          );
          return false;
        }
        const path =
          !as && cur.file_path
            ? cur.file_path
            : await pickPipelineSavePath(
                cur.file_path
                  ? basename(cur.file_path).replace(/\.[^.]+$/, "")
                  : collection,
              );
        if (!path) return false;
        await writeFile(path, Array.from(new TextEncoder().encode(c.file)));
        const latest =
          useStudioStore.getState().aggregationTabs[tab_key] ?? cur;
        useStudioStore.getState().setAggregationSetup(tab_key, {
          ...latest,
          file_path: path,
          saved_text: c.file,
        });
        return true;
      } catch (e) {
        notify(
          "Could not save file",
          e instanceof Error ? e.message : String(e),
        );
        return false;
      }
    },
    [tab_key, collection],
  );

  const set_tab = useStudioStore((s) => s.setSqlTab);
  const clear_tab = useStudioStore((s) => s.clearSqlTab);
  const has_text = setup.stages.length > 0;
  useEffect(() => {
    set_tab(tab_key, {
      has_text,
      is_dirty,
      save: () => save(false),
      file_name,
    });
    return () => clear_tab(tab_key);
  }, [tab_key, has_text, is_dirty, file_name, save, set_tab, clear_tab]);

  return { is_dirty, file_name, save };
}
