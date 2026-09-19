import { describe, expect, it } from "vitest";
import {
  formatStoppedDuration,
  looksLikeMongoWrite,
  MONGO_WRITE_NOTE,
  stoppedStatusLine,
  WINDING_DOWN_NOTE,
} from "../stopped-status";

describe("formatStoppedDuration", () => {
  it("shows milliseconds under a second", () => {
    expect(formatStoppedDuration(850)).toBe("850ms");
    expect(formatStoppedDuration(0)).toBe("0ms");
  });

  it("shows one decimal of seconds under a minute", () => {
    expect(formatStoppedDuration(4200)).toBe("4.2s");
    expect(formatStoppedDuration(1000)).toBe("1.0s");
  });

  it("switches to minutes and seconds from one minute", () => {
    expect(formatStoppedDuration(125_000)).toBe("2m 5s");
  });
});

describe("stoppedStatusLine", () => {
  it("reports the time and the rows that had already arrived", () => {
    expect(stoppedStatusLine(4200, 1200)).toBe(
      "Stopped after 4.2s, 1,200 rows loaded",
    );
  });

  it("says so when nothing had arrived yet", () => {
    expect(stoppedStatusLine(850, 0)).toBe("Stopped after 850ms, no rows loaded");
  });

  it("uses the singular for one row", () => {
    expect(stoppedStatusLine(2000, 1)).toBe("Stopped after 2.0s, 1 row loaded");
  });
});

describe("WINDING_DOWN_NOTE", () => {
  it("matches the wording the spec fixes (AC-9)", () => {
    expect(WINDING_DOWN_NOTE).toBe(
      "Stopped, the database is still winding it down",
    );
  });
});

describe("looksLikeMongoWrite", () => {
  it("flags console commands that can change data", () => {
    for (const cmd of [
      'db.users.updateMany({}, {"$set": {"a": 1}})',
      "db.users.insertOne({a: 1})",
      "db.users.deleteMany({})",
      "db.users.findOneAndUpdate({}, {})",
      "db.users.bulkWrite([])",
      "db.users.drop()",
      'db.users . replaceOne({}, {})',
    ]) {
      expect(looksLikeMongoWrite(cmd), cmd).toBe(true);
    }
  });

  it("leaves reads alone", () => {
    for (const cmd of [
      "db.users.find({})",
      "db.users.aggregate([])",
      "db.users.countDocuments({})",
      'db.users.distinct("a")',
      "show collections",
      '{ "a": 1 }',
    ]) {
      expect(looksLikeMongoWrite(cmd), cmd).toBe(false);
    }
  });
});

describe("MONGO_WRITE_NOTE", () => {
  it("tells the user a stopped write is not rolled back", () => {
    expect(MONGO_WRITE_NOTE).toContain("stay changed");
  });
});
