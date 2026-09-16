import { describe, expect, it } from "vitest";
import { activeCallAt } from "../signature-help";

describe("activeCallAt", () => {
  it("resolves a known function with the cursor on its first argument", () => {
    const text = "SELECT ROUND(1.2345, 2)";
    const pos = text.indexOf("1.2345"); // inside the first argument
    const hit = activeCallAt(text, pos);
    expect(hit?.entry.name).toBe("ROUND");
    expect(hit?.argIndex).toBe(0);
  });

  it("advances the active argument index past a comma", () => {
    const text = "SELECT ROUND(1.2345, 2)";
    const pos = text.indexOf("2)"); // inside the second argument
    expect(activeCallAt(text, pos)?.argIndex).toBe(1);
  });

  it("returns null for an unknown function", () => {
    const text = "SELECT MADE_UP_FN(1, 2)";
    const pos = text.indexOf("1, 2");
    expect(activeCallAt(text, pos)).toBeNull();
  });

  it("returns null when the cursor is outside any call", () => {
    const text = "SELECT * FROM orders";
    expect(activeCallAt(text, 10)).toBeNull();
  });

  it("resolves the OUTER call when the cursor is between a nested call's args", () => {
    // Cursor sits right after "COUNT(" — inside COUNT's own call, not ROUND's.
    const text = "SELECT ROUND(COUNT(id), 2)";
    const pos = text.indexOf("COUNT(") + "COUNT(".length;
    expect(activeCallAt(text, pos)?.entry.name).toBe("COUNT");
  });

  it("resolves the outer call once past the nested call's closing paren", () => {
    const text = "SELECT ROUND(COUNT(id), 2)";
    const pos = text.indexOf(", 2");
    const hit = activeCallAt(text, pos);
    expect(hit?.entry.name).toBe("ROUND");
    expect(hit?.argIndex).toBe(0);
  });

  it("is not fooled by a comma inside a string literal argument", () => {
    const text = "SELECT CONCAT('a, b', 'c')";
    const pos = text.indexOf("'c'");
    expect(activeCallAt(text, pos)?.argIndex).toBe(1);
  });
});
