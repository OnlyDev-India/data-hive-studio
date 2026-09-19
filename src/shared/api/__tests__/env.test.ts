import { describe, expect, it } from "vitest";
import {
  ENV_COLORS,
  ENV_LABEL_MAX,
  envColorKey,
  envConfirmReason,
  envPreset,
  hasConnFlags,
  isProductionEnv,
  needsWriteConfirm,
  tidyEnvLabel,
} from "../env";

describe("envPreset", () => {
  it("finds a preset whatever the case or spacing", () => {
    expect(envPreset("Production")?.color).toBe("red");
    expect(envPreset("  staging ")?.color).toBe("amber");
    expect(envPreset("DEVELOPMENT")?.color).toBe("green");
  });

  it("returns null for a custom, empty or missing label", () => {
    expect(envPreset("QA")).toBeNull();
    expect(envPreset("")).toBeNull();
    expect(envPreset(null)).toBeNull();
    expect(envPreset(undefined)).toBeNull();
  });
});

describe("tidyEnvLabel", () => {
  it("trims, and turns nothing into null", () => {
    expect(tidyEnvLabel("  QA  ")).toBe("QA");
    expect(tidyEnvLabel("   ")).toBeNull();
    expect(tidyEnvLabel(undefined)).toBeNull();
  });

  it("cuts to the limit in characters, not bytes", () => {
    expect(tidyEnvLabel("a".repeat(40))).toHaveLength(ENV_LABEL_MAX);
    const wide = "é".repeat(ENV_LABEL_MAX + 3);
    expect(Array.from(tidyEnvLabel(wide) ?? "")).toHaveLength(ENV_LABEL_MAX);
  });
});

describe("envColorKey", () => {
  it("is null without a label, even if a colour is set", () => {
    expect(envColorKey({})).toBeNull();
    expect(envColorKey({ env_color: "blue" })).toBeNull();
  });

  it("gives a preset its own colour and ignores the stored one", () => {
    expect(envColorKey({ env_label: "Production", env_color: "blue" })).toBe(
      "red",
    );
  });

  it("uses a custom label's colour, and grey when it is missing or unknown", () => {
    expect(envColorKey({ env_label: "QA", env_color: "purple" })).toBe(
      "purple",
    );
    expect(envColorKey({ env_label: "QA" })).toBe("grey");
    expect(envColorKey({ env_label: "QA", env_color: "hotpink" })).toBe("grey");
  });

  it("knows the same eight colours as the stylesheet", () => {
    expect([...ENV_COLORS]).toEqual([
      "red",
      "orange",
      "amber",
      "green",
      "teal",
      "blue",
      "purple",
      "grey",
    ]);
  });
});

describe("write confirmation", () => {
  it("asks for Production, and for confirm writes, and only those", () => {
    expect(needsWriteConfirm({ env_label: "production" })).toBe(true);
    expect(needsWriteConfirm({ confirm_writes: true })).toBe(true);
    expect(needsWriteConfirm({ env_label: "Staging" })).toBe(false);
    expect(needsWriteConfirm({ env_label: "QA" })).toBe(false);
    expect(needsWriteConfirm({})).toBe(false);
  });

  it("a custom label never asks by itself", () => {
    expect(isProductionEnv({ env_label: "Production 2" })).toBe(false);
    expect(needsWriteConfirm({ env_label: "Production 2" })).toBe(false);
  });

  it("says why it asks", () => {
    expect(envConfirmReason({ env_label: "Production" })).toMatch(/Production/);
    expect(envConfirmReason({ confirm_writes: true })).toMatch(
      /Confirm before/,
    );
    expect(envConfirmReason({ env_label: "QA" })).toBeNull();
  });
});

describe("hasConnFlags", () => {
  it("is true for a lock or a label, false for a plain connection", () => {
    expect(hasConnFlags({ read_only: true })).toBe(true);
    expect(hasConnFlags({ env_label: "QA" })).toBe(true);
    expect(hasConnFlags({ env_label: "  " })).toBe(false);
    expect(hasConnFlags({})).toBe(false);
  });
});
