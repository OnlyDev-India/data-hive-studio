import { describe, expect, it } from "vitest";
import {
  DEFAULT_CUSTOM_COLOR,
  EMPTY_GUARD_FORM,
  applyGuardPatch,
  envModeOf,
  guardFromForm,
  guardToForm,
  isPlainGuard,
} from "../guard-form";

describe("guardToForm", () => {
  it("loads a connection saved before this feature as plain", () => {
    expect(guardToForm({})).toEqual(EMPTY_GUARD_FORM);
    expect(guardToForm(undefined)).toEqual(EMPTY_GUARD_FORM);
  });

  it("keeps a custom label's colour and drops a preset's", () => {
    expect(guardToForm({ env_label: "QA", env_color: "teal" })).toMatchObject({
      env_label: "QA",
      env_color: "teal",
    });
    expect(
      guardToForm({ env_label: "Production", env_color: "teal" }),
    ).toMatchObject({ env_label: "Production", env_color: "" });
  });

  it("ignores a colour with no label", () => {
    expect(guardToForm({ env_color: "teal" }).env_color).toBe("");
  });
});

describe("guardFromForm", () => {
  it("sends only read_only for a plain form", () => {
    expect(guardFromForm(EMPTY_GUARD_FORM)).toEqual({ read_only: false });
  });

  it("sends a preset without a colour, and confirm only when on", () => {
    expect(
      guardFromForm({ ...EMPTY_GUARD_FORM, env_label: "Staging" }),
    ).toEqual({ read_only: false, env_label: "Staging" });
    expect(
      guardFromForm({ ...EMPTY_GUARD_FORM, confirm_writes: true }),
    ).toEqual({ read_only: false, confirm_writes: true });
  });

  it("sends a custom label with its colour, defaulting to grey", () => {
    expect(
      guardFromForm({
        ...EMPTY_GUARD_FORM,
        env_label: "QA",
        env_color: "blue",
      }),
    ).toMatchObject({ env_label: "QA", env_color: "blue" });
    expect(
      guardFromForm({ ...EMPTY_GUARD_FORM, env_label: "QA" }).env_color,
    ).toBe(DEFAULT_CUSTOM_COLOR);
  });

  it("sends no environment for a custom choice whose name is still empty", () => {
    const pending = { ...EMPTY_GUARD_FORM, env_color: DEFAULT_CUSTOM_COLOR };
    expect(guardFromForm(pending)).toEqual({ read_only: false });
  });

  it("round trips through the form", () => {
    const saved = {
      read_only: true,
      env_label: "QA",
      env_color: "purple",
      confirm_writes: true,
    };
    expect(guardFromForm(guardToForm(saved))).toEqual(saved);
  });
});

describe("envModeOf", () => {
  it("tells none, a preset and custom apart, including a custom with no name yet", () => {
    expect(envModeOf(EMPTY_GUARD_FORM)).toBe("none");
    expect(envModeOf({ ...EMPTY_GUARD_FORM, env_label: "production" })).toBe(
      "Production",
    );
    expect(envModeOf({ ...EMPTY_GUARD_FORM, env_label: "QA" })).toBe("custom");
    expect(
      envModeOf({ ...EMPTY_GUARD_FORM, env_color: DEFAULT_CUSTOM_COLOR }),
    ).toBe("custom");
  });
});

describe("isPlainGuard", () => {
  it("is true only when nothing is set", () => {
    expect(isPlainGuard({})).toBe(true);
    expect(isPlainGuard({ read_only: false })).toBe(true);
    expect(isPlainGuard({ read_only: true })).toBe(false);
    expect(isPlainGuard({ env_label: "QA" })).toBe(false);
    expect(isPlainGuard({ confirm_writes: true })).toBe(false);
  });
});

describe("applyGuardPatch", () => {
  it("sets each changed field on a flat form", () => {
    const seen: [string, string | boolean][] = [];
    applyGuardPatch((k, v) => seen.push([k, v]), {
      env_label: "QA",
      env_color: "blue",
    });
    expect(seen).toEqual([
      ["env_label", "QA"],
      ["env_color", "blue"],
    ]);
  });
});
