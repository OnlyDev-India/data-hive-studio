import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  EMPTY_GUARD_FORM,
  guardFromForm,
  type GuardFormValues,
} from "../../lib/guard-form";
import { GuardFields } from "../guard-fields";

afterEach(cleanup);

/** The fields with real state behind them, and the guard they would send. */
function Harness({
  initial = EMPTY_GUARD_FORM,
}: {
  initial?: GuardFormValues;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <GuardFields
        idPrefix="t"
        value={value}
        onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
      />
      <output data-testid="guard">
        {JSON.stringify(guardFromForm(value))}
      </output>
    </>
  );
}

const sent = () => JSON.parse(screen.getByTestId("guard").textContent ?? "{}");

async function pickEnvironment(name: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: /environment/i }));
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("GuardFields", () => {
  it("starts plain: no environment, nothing to confirm", () => {
    render(<Harness />);
    expect(
      screen.getByRole("switch", { name: /read only/i }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /confirm before writes/i }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("textbox", { name: /environment name/i }),
    ).toBeNull();
    expect(sent()).toEqual({ read_only: false });
  });

  it("Production shows a red chip and locks Confirm before writes on", async () => {
    render(<Harness />);
    await pickEnvironment(/^production$/i);

    expect(document.querySelector("[data-env-color=red]")).not.toBeNull();
    const confirm = screen.getByRole("checkbox", {
      name: /confirm before writes/i,
    });
    expect(confirm).toBeChecked();
    // The base checkbox is a span, so it says "disabled" with ARIA.
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/always on for production/i)).toBeInTheDocument();
    expect(sent()).toEqual({ read_only: false, env_label: "Production" });
  });

  it("keeps the confirm choice when the label moves off Production", async () => {
    render(<Harness />);
    await userEvent.click(
      screen.getByRole("checkbox", { name: /confirm before writes/i }),
    );
    await pickEnvironment(/^production$/i);
    await pickEnvironment(/^staging$/i);

    const confirm = screen.getByRole("checkbox", {
      name: /confirm before writes/i,
    });
    expect(confirm).toBeChecked();
    expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    expect(sent()).toMatchObject({
      env_label: "Staging",
      confirm_writes: true,
    });
  });

  it("Custom offers a name and eight colours, and sends the pick", async () => {
    render(<Harness />);
    await pickEnvironment(/custom/i);

    const name = screen.getByRole("textbox", { name: /environment name/i });
    expect(name).toHaveAttribute("maxlength", "24");
    // A custom environment with no name yet sends no environment.
    expect(sent()).toEqual({ read_only: false });

    await userEvent.type(name, "QA");
    const swatches = screen.getAllByRole("radio");
    expect(swatches).toHaveLength(8);
    await userEvent.click(screen.getByRole("radio", { name: "teal" }));

    expect(screen.getByRole("radio", { name: "teal" })).toBeChecked();
    expect(sent()).toEqual({
      read_only: false,
      env_label: "QA",
      env_color: "teal",
    });
  });

  it("None clears the label and the colour", async () => {
    render(
      <Harness
        initial={{ ...EMPTY_GUARD_FORM, env_label: "QA", env_color: "blue" }}
      />,
    );
    await pickEnvironment(/^none$/i);
    expect(sent()).toEqual({ read_only: false });
    expect(
      screen.queryByRole("textbox", { name: /environment name/i }),
    ).toBeNull();
  });

  it("carries the Read only switch", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("switch", { name: /read only/i }));
    expect(sent()).toEqual({ read_only: true });
  });
});
