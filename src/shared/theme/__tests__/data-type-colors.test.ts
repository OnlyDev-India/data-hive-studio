import { describe, expect, it } from "vitest";
import { dataTypeFamily, dataTypeTextClass } from "../data-type-colors";

describe("dataTypeFamily", () => {
  it.each([
    // Postgres
    ["integer", "number"],
    ["bigint", "number"],
    ["int4", "number"],
    ["numeric(10,2)", "number"],
    ["double precision", "number"],
    ["bigserial", "number"],
    ["character varying(255)", "text"],
    ["text", "text"],
    ["boolean", "bool"],
    ["timestamp with time zone", "datetime"],
    ["interval", "datetime"],
    ["jsonb", "json"],
    ["integer[]", "json"],
    ["_text", "json"],
    ["uuid", "id"],
    ["bytea", "binary"],
    ["USER-DEFINED enum", "enum"],
    ["point", "other"],
    // SQLite
    ["INTEGER", "number"],
    ["REAL", "number"],
    ["BLOB", "binary"],
    ["VARCHAR(20)", "text"],
    // Mongo
    ["string", "text"],
    ["double", "number"],
    ["decimal", "number"],
    ["date", "datetime"],
    ["timestamp", "datetime"],
    ["objectid", "id"],
    ["object", "json"],
    ["array", "json"],
    ["binary", "binary"],
    ["regex", "text"],
    ["null", "other"],
    ["", "other"],
  ])("%s is %s", (type, family) => {
    expect(dataTypeFamily(type)).toBe(family);
  });

  it("gives unknown types the plain muted color", () => {
    expect(dataTypeTextClass(undefined)).toBe("text-muted-foreground");
    expect(dataTypeTextClass("int8")).toBe("text-type-number");
  });
});
