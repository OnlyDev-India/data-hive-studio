import type { Encoding } from "./types";

/** Decode file bytes in the chosen encoding. A byte order mark is dropped, and
 *  UTF-16 picks little or big endian from it (little endian without one). */
export function decodeText(bytes: Uint8Array, encoding: Encoding): string {
  if (encoding === "utf-16") {
    const big = bytes[0] === 0xfe && bytes[1] === 0xff;
    return new TextDecoder(big ? "utf-16be" : "utf-16le").decode(bytes);
  }
  // TextDecoder drops a UTF-8 BOM itself. `windows-1252` has no BOM.
  return new TextDecoder(encoding).decode(bytes);
}
