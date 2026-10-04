import { plainToMongo, renderMongoDocument } from "@/shared/lib/mongo-json";

/** A document in the shell's own syntax (`ObjectId(...)`, `ISODate(...)`). */
export function docText(doc: unknown): string {
  return renderMongoDocument(plainToMongo(doc));
}

/** The same text on one line, for a card's collapsed first document. */
export function docLine(doc: unknown): string {
  return docText(doc).replace(/\s*\n\s*/g, " ");
}

/** Every document, one after another, for a JSON view. */
export function docsText(docs: unknown[]): string {
  return docs.map(docText).join("\n");
}

/** "37 of first 1,000", or "37" when the cap did not cut the input. */
export function countLabel(count: number, cap: number, sampled: boolean) {
  const n = count.toLocaleString();
  return sampled ? `${n} of first ${cap.toLocaleString()}` : n;
}
