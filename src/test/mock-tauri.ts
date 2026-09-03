import { vi } from "vitest";

/**
 * Central mock for the Tauri IPC boundary. `shared/api/client.ts` is the
 * only place `invoke()`/`Channel` are used anywhere in the app, so mocking
 * `@tauri-apps/api/core` once here covers every test that exercises it.
 *
 * Usage:
 *   vi.mock("@tauri-apps/api/core", () => mockTauriCore());
 *   import { invoke } from "@tauri-apps/api/core";
 *   (invoke as Mock).mockResolvedValueOnce({ ... });
 */
export function mockTauriCore() {
  class MockChannel<T> {
    onmessage: (payload: T) => void = () => {};
    // Real Channel serializes to an id string the backend calls back into;
    // tests don't need that plumbing, just something invoke() can accept
    // and tests can drive via `.onmessage(payload)` directly.
  }

  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
}
