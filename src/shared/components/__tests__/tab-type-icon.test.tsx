import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { StudioTab } from "@/shared/store";
import { TAB_ICON_CLASS } from "@/shared/components/icons/types";
import { TabTypeIcon } from "../tab-type-icon";

const TABS = {
  table: { kind: "table", name: "users", tabId: 1 },
  sql: { kind: "sql", id: 1 },
  "new-table": { kind: "new-table", id: 1 },
  "mongo-console": { kind: "mongo-console", id: 1 },
} as Record<keyof typeof TAB_ICON_CLASS, StudioTab>;

describe("TabTypeIcon", () => {
  it.each(Object.keys(TABS) as (keyof typeof TABS)[])(
    "colors a %s tab from TAB_ICON_CLASS",
    (kind) => {
      const { container } = render(<TabTypeIcon tab={TABS[kind]} />);
      expect(container.querySelector("svg")).toHaveClass(TAB_ICON_CLASS[kind]);
    },
  );
});
