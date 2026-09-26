import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

const { closeConnection } = vi.hoisted(() => ({ closeConnection: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  closeConnection,
}));

import { useStudioStore } from "../../store";
import { DisconnectDialog } from "../disconnect-dialog";

const pg = { id: "p1", name: "orders", kind: "postgres" } as const;

beforeEach(() => {
  closeConnection.mockReset().mockReturnValue(new Promise(() => {}));
  useStudioStore.getState().openConn(pg);
  useStudioStore.getState().setDisconnectPendingId(pg.id);
});

afterEach(() => {
  cleanup();
  useStudioStore.getState().closeConn(pg.id);
});

describe("DisconnectDialog", () => {
  it("goes home at once while the backend close is still running", async () => {
    render(<DisconnectDialog />);
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(closeConnection).toHaveBeenCalledWith(pg.id);
    const s = useStudioStore.getState();
    expect(s.view).toBe("home");
    expect(s.open).toHaveLength(0);
    expect(s.disconnectPendingId).toBeNull();
  });
});
