import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnFlags, EnvChip, ReadOnlyLock } from "../env-chip";

afterEach(cleanup);

describe("EnvChip", () => {
  it("shows the label as text, in the preset's colour", () => {
    render(<EnvChip conn={{ env_label: "Production" }} />);
    const chip = screen.getByText("Production").closest("[data-slot=env-chip]");
    expect(chip).toHaveAttribute("data-env-color", "red");
    expect(chip).toHaveStyle({
      backgroundColor: "var(--env-red)",
      color: "var(--env-red-fg)",
    });
  });

  it("uses a custom label's colour, and grey for an unknown key", () => {
    const { rerender } = render(
      <EnvChip conn={{ env_label: "QA", env_color: "purple" }} />,
    );
    expect(
      screen.getByText("QA").closest("span[data-env-color]"),
    ).toHaveAttribute("data-env-color", "purple");
    rerender(<EnvChip conn={{ env_label: "QA", env_color: "nope" }} />);
    expect(
      screen.getByText("QA").closest("span[data-env-color]"),
    ).toHaveAttribute("data-env-color", "grey");
  });

  it("renders nothing without a label", () => {
    const { container } = render(<EnvChip conn={{ read_only: true }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReadOnlyLock", () => {
  it("is a labelled image, not colour alone", () => {
    render(<ReadOnlyLock />);
    expect(
      screen.getByRole("img", { name: /read only connection/i }),
    ).toBeInTheDocument();
  });
});

describe("ConnFlags", () => {
  it("shows the lock and the chip together", () => {
    render(<ConnFlags conn={{ read_only: true, env_label: "Staging" }} />);
    expect(screen.getByRole("img", { name: /read only/i })).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
  });

  it("shows only the lock for an unlabelled read only connection", () => {
    render(<ConnFlags conn={{ read_only: true }} />);
    expect(screen.getByRole("img", { name: /read only/i })).toBeInTheDocument();
    expect(document.querySelector("[data-slot=env-chip]")).toBeNull();
  });

  it("renders nothing for a plain connection, so it can sit beside any name", () => {
    const { container } = render(<ConnFlags conn={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
