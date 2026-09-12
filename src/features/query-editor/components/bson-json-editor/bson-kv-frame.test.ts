import { describe, it, expect } from "vitest";
import { currentKvFrame } from "./bson-kv-frame";

describe("currentKvFrame", () => {
  const doc = `{
  "_id": ObjectId("507f191e810c19729de860ea"),
  "name": "Alice",
  "age": 30,
  "address": { "city": "NYC" }
}`;

  it("frames the whole pair when the cursor is in the value", () => {
    const ageIdx = doc.indexOf('"age"');
    const cursor = doc.indexOf("30");
    const frame = currentKvFrame(doc, cursor);
    expect(frame).not.toBeNull();
    expect(frame!.start).toBe(ageIdx);
    expect(doc.slice(frame!.start, frame!.end)).toBe('"age": 30');
  });

  it("narrows to just the key's quotes when the cursor is inside the key", () => {
    const nameIdx = doc.indexOf('"name"');
    const cursor = nameIdx + 2; // inside "name"
    const frame = currentKvFrame(doc, cursor);
    expect(frame).not.toBeNull();
    expect(doc.slice(frame!.start, frame!.end)).toBe('"name"');
  });

  it("narrows to just the string value's quotes when the cursor is inside it", () => {
    const aliceIdx = doc.indexOf('"Alice"');
    const cursor = aliceIdx + 3; // inside "Alice"
    const frame = currentKvFrame(doc, cursor);
    expect(frame).not.toBeNull();
    expect(doc.slice(frame!.start, frame!.end)).toBe('"Alice"');
  });

  it("frames the innermost nested pair, not the whole object", () => {
    const cityIdx = doc.indexOf('"city"');
    const cursor = cityIdx + 2;
    const frame = currentKvFrame(doc, cursor);
    expect(frame).not.toBeNull();
    expect(doc.slice(frame!.start, frame!.end)).toBe('"city"');
  });

  it("frames a constructor-call value as a whole", () => {
    const idIdx = doc.indexOf('"_id"');
    const cursor = doc.indexOf("ObjectId") + 3;
    const frame = currentKvFrame(doc, cursor);
    expect(frame).not.toBeNull();
    expect(frame!.start).toBe(idIdx);
    expect(doc.slice(frame!.start, frame!.end)).toBe(
      '"_id": ObjectId("507f191e810c19729de860ea")',
    );
  });
});
