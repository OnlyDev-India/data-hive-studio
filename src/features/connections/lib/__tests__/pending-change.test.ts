import { describe, expect, it } from "vitest";
import type { ConnectionInfo } from "@/shared/api";
import type { SavedConnParams } from "@/shared/store";
import {
  guardsDiffer,
  pendingGuardChange,
  savedNameFor,
} from "../pending-change";

const pg = (over: Partial<SavedConnParams> = {}): SavedConnParams => ({
  kind: "postgres",
  host: "db.example",
  port: 5432,
  user: "app",
  password: "",
  database: "orders",
  ...over,
});
const live = (over: Partial<ConnectionInfo> = {}): ConnectionInfo => ({
  id: "c1",
  name: "orders",
  kind: "postgres",
  ...over,
});

describe("guardsDiffer", () => {
  it("is false for two plain guards, and for an unchanged one", () => {
    expect(guardsDiffer({}, { read_only: false })).toBe(false);
    expect(
      guardsDiffer(
        { read_only: true, env_label: "QA", env_color: "blue" },
        { read_only: true, env_label: " QA ", env_color: "blue" },
      ),
    ).toBe(false);
  });

  it("sees read only, confirm, label and colour changes", () => {
    expect(guardsDiffer({}, { read_only: true })).toBe(true);
    expect(guardsDiffer({}, { confirm_writes: true })).toBe(true);
    expect(guardsDiffer({}, { env_label: "QA" })).toBe(true);
    expect(
      guardsDiffer(
        { env_label: "QA", env_color: "blue" },
        { env_label: "QA", env_color: "teal" },
      ),
    ).toBe(true);
  });

  it("does not see a colour change on a preset, which always wears its own", () => {
    expect(
      guardsDiffer(
        { env_label: "Production", env_color: "blue" },
        { env_label: "Production", env_color: "teal" },
      ),
    ).toBe(false);
  });
});

describe("savedNameFor", () => {
  it("follows the display name the connect form recorded", () => {
    const saved = { Orders: pg(), Other: pg({ database: "other" }) };
    expect(savedNameFor(live(), { ...pg(), name: "Orders" }, saved)).toBe(
      "Orders",
    );
  });

  it("falls back to the same server, user and database", () => {
    const saved = { Other: pg({ database: "other" }), Orders: pg() };
    expect(savedNameFor(live(), pg(), saved)).toBe("Orders");
  });

  it("does not match a different database or kind", () => {
    expect(savedNameFor(live(), pg({ database: "x" }), { A: pg() })).toBeNull();
    expect(
      savedNameFor(live({ kind: "mongodb" }), pg(), { A: pg() }),
    ).toBeNull();
  });

  it("treats a DocumentDB profile as MongoDB", () => {
    const saved = { M: pg({ kind: "documentdb" }) };
    expect(savedNameFor(live({ kind: "mongodb" }), pg(), saved)).toBe("M");
  });

  it("matches a SQLite file by path", () => {
    const file = {
      name: "app.db",
      kind: "sqlite" as const,
      source_path: "/d/app.db",
    };
    const saved = {
      App: pg({ kind: "sqlite", source_path: "/d/app.db", host: "" }),
      Other: pg({ kind: "sqlite", source_path: "/d/other.db", host: "" }),
    };
    expect(savedNameFor({ id: "s", ...file }, undefined, saved)).toBe("App");
  });

  it("is null when nothing was saved", () => {
    expect(savedNameFor(live(), pg(), {})).toBeNull();
  });
});

describe("pendingGuardChange", () => {
  it("reports the saved connection when its guard moved on from the live one", () => {
    const saved = { Orders: pg({ read_only: true }) };
    const pending = pendingGuardChange(
      live(),
      { ...pg(), name: "Orders" },
      saved,
    );
    expect(pending?.name).toBe("Orders");
    expect(pending?.saved.read_only).toBe(true);
  });

  it("is null when they agree, or when there is no saved connection", () => {
    const saved = { Orders: pg({ read_only: true }) };
    expect(
      pendingGuardChange(
        live({ read_only: true }),
        { ...pg(), name: "Orders" },
        saved,
      ),
    ).toBeNull();
    expect(pendingGuardChange(live(), pg(), {})).toBeNull();
  });
});
