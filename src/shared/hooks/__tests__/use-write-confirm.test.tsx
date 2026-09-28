import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStudioStore } from "@/shared/store";
import { useWriteConfirm } from "../use-write-confirm";

type Api = ReturnType<typeof useWriteConfirm>;
let api: Api;

/** Hands the hook's latest value to the test from an effect, not from render. */
function Probe({
  conn_id,
  onApi,
}: {
  conn_id: string;
  onApi: (a: Api) => void;
}) {
  const current = useWriteConfirm(conn_id);
  useEffect(() => onApi(current));
  return <>{current.dialog}</>;
}
const renderProbe = (conn_id: string) =>
  render(
    <Probe
      conn_id={conn_id}
      onApi={(a) => {
        api = a;
      }}
    />,
  );

const conn = (over: Record<string, unknown>) => ({
  id: "c1",
  name: "orders",
  kind: "postgres" as const,
  ...over,
});
const withConn = (over: Record<string, unknown>) =>
  useStudioStore.setState({ open: [conn(over)] });

beforeEach(() => useStudioStore.setState({ open: [] }));
afterEach(cleanup);

describe("useWriteConfirm", () => {
  it("does not ask on a plain connection", async () => {
    withConn({});
    renderProbe("c1");
    expect(api.needs).toBe(false);
    await expect(api.confirm_write("Apply 2 changes")).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask for a Staging label or a custom one", () => {
    withConn({ env_label: "Staging" });
    renderProbe("c1");
    expect(api.needs).toBe(false);
  });

  it("asks on Production, without an env chip, and resolves true on confirm", async () => {
    withConn({ env_label: "Production" });
    renderProbe("c1");
    expect(api.needs).toBe(true);

    let answer: Promise<boolean>;
    act(() => {
      answer = api.confirm_write("Apply 2 pending changes to users");
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Apply 2 pending changes to users");
    expect(dialog).toHaveTextContent(/Production connection/);
    expect(dialog.querySelector("[data-env-color]")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    await expect(answer!).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false on Cancel", async () => {
    withConn({ confirm_writes: true });
    renderProbe("c1");

    let answer: Promise<boolean>;
    act(() => {
      answer = api.confirm_write("Drop table users");
    });
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await expect(answer!).resolves.toBe(false);
  });

  it("never asks on a read only connection, so the backend refusal comes first", async () => {
    withConn({ env_label: "Production", read_only: true });
    renderProbe("c1");
    expect(api.needs).toBe(false);
    expect(api.env_reason).toBeNull();
    await expect(api.confirm_write("Drop table users")).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts every reason for one statement in one dialog", async () => {
    withConn({ env_label: "Production" });
    renderProbe("c1");

    act(() => {
      void api.ask({
        items: [
          {
            text: "DELETE FROM users",
            reasons: [
              "DELETE with no WHERE clause affects every row",
              "This is a Production connection.",
            ],
          },
        ],
        description: "This statement needs confirmation before it runs:",
      });
    });
    const dialogs = await screen.findAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveTextContent(/no WHERE clause/);
    expect(dialogs[0]).toHaveTextContent(/Production connection/);
  });
});
