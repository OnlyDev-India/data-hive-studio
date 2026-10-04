import "@testing-library/jest-dom/vitest";

// jsdom has no layout, so Range lacks the rect methods CodeMirror measures with.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
