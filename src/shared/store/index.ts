export { useStudioStore, bootstrapWorkspaceRestore } from "./store";
export {
  DEFAULT_PALETTE_KEYWORDS,
  type StudioStore,
  type StudioView,
  type WorkspaceTabs,
  type GridBridge,
  type ImportTarget,
  type JsonRow,
  type SchemaEditHandle,
  type SchemaPaneHandle,
  type StudioNotification,
  type SavedConnParams,
  type LandingEditTarget,
  type PaletteKeywords,
  type UpdatePhase,
} from "./types";
export type { ShortcutBinding } from "../hooks/shortcut-registry";
export {
  useActiveBottomPanelOpen,
  useActiveConnection,
  useActiveConnectionId,
  usePaneMode,
  useWorkspace,
} from "./hooks";
export { tabEquals, tabKey, tabLabel, type StudioTab } from "./tab-utils";
export {
  listUnappliedWork,
  listUnappliedWorkFor,
  summarizeUnappliedWork,
} from "./unapplied-work";
export { findOwnerLeaf, type PaneNode } from "./pane-layout";
export { stableConnKey } from "./workspace-persistence";
