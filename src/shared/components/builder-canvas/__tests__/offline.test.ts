import { describe, expect, it } from "vitest";
import { isConnectionLost } from "../offline";

describe("isConnectionLost", () => {
  it("tells an unreachable server from a stage error", () => {
    expect(isConnectionLost("no open connection for id 'abc'")).toBe(true);
    expect(
      isConnectionLost("Server selection timeout: No available servers."),
    ).toBe(true);
    expect(isConnectionLost("Kind: I/O error: Connection reset by peer")).toBe(
      true,
    );
    expect(isConnectionLost("TypeError: Failed to fetch")).toBe(true);
    expect(
      isConnectionLost(
        "400 — pool timed out while waiting for an open connection",
      ),
    ).toBe(true);
    expect(
      isConnectionLost("attempted to acquire a connection on a closed pool"),
    ).toBe(true);
    expect(isConnectionLost("Unrecognized pipeline stage name: '$mtach'")).toBe(
      false,
    );
    expect(isConnectionLost(null)).toBe(false);
  });
});
