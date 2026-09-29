import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("keeps a named size next to a color", () => {
    expect(cn("text-caption", "text-muted-foreground")).toBe(
      "text-caption text-muted-foreground",
    );
    expect(cn("text-small", "text-diff-add-foreground")).toBe(
      "text-small text-diff-add-foreground",
    );
  });

  it("lets a later named size or radius win", () => {
    expect(cn("text-small", "text-body")).toBe("text-body");
    expect(cn("rounded-control", "rounded-surface")).toBe("rounded-surface");
  });
});
