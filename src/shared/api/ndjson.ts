/** One line of a streamed answer from the server (spec 0011). `chunk` lines
 *  carry rows, and columns when the list is new or grew; a healthy stream
 *  ends with a `done` line, and a run that failed after its first chunk with
 *  an `error` line. */
export type StreamEvent =
  | {
      t: "chunk";
      columns?: string[];
      rows: (string | null)[][];
      documents?: unknown[];
    }
  | { t: "done"; result: unknown }
  | { t: "error"; message: string };

/** Read an NDJSON body and hand each line to `onEvent` as it arrives, however
 *  the network cut it into pieces. Resolves when the body ends; a body cut
 *  short throws from the reader, and the caller decides what that means. */
export async function readNdjson(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const drain = (final: boolean) => {
    let at = pending.indexOf("\n");
    while (at >= 0) {
      const text = pending.slice(0, at).trim();
      pending = pending.slice(at + 1);
      if (text) onEvent(JSON.parse(text) as StreamEvent);
      at = pending.indexOf("\n");
    }
    if (final && pending.trim()) {
      onEvent(JSON.parse(pending) as StreamEvent);
      pending = "";
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    drain(false);
  }
  pending += decoder.decode();
  drain(true);
}
