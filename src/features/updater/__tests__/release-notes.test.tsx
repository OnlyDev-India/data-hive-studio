import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { ReleaseNotes, safe_link_url } from "../release-notes";

beforeEach(() => {
  opener.openUrl.mockReset();
  opener.openUrl.mockResolvedValue(undefined);
});

describe("safe_link_url", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com/"],
    ["HTTPS://Example.com/x", "https://example.com/x"],
  ])("accepts %s", (href, expected) => {
    expect(safe_link_url(href)).toBe(expected);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["ftp://example.com/file"],
    ["mailto:someone@example.com"],
    ["tauri://localhost"],
    ["#changelog"],
    ["/relative/path"],
    ["not a url"],
    [""],
  ])("rejects %j (AC-9)", (href) => {
    expect(safe_link_url(href)).toBeNull();
  });

  it("rejects a missing href", () => {
    expect(safe_link_url(undefined)).toBeNull();
  });
});

describe("ReleaseNotes formatting (AC-1)", () => {
  it("renders headings, bold, italic and inline code", () => {
    render(
      <ReleaseNotes
        markdown={"# Big\n\n## Medium\n\nSome **bold**, *italic* and `code`."}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Big" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Medium" }),
    ).toBeVisible();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });

  it("renders bullet and numbered lists as lists", () => {
    render(<ReleaseNotes markdown={"- one\n- two\n\n1. first\n2. second"} />);

    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders a fenced code block as preformatted text without the fences", () => {
    const { container } = render(
      <ReleaseNotes markdown={"```sh\nbun install\n```"} />,
    );

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent("bun install");
    expect(pre).not.toHaveTextContent("```");
  });

  it("renders a block quote", () => {
    const { container } = render(<ReleaseNotes markdown={"> careful here"} />);

    expect(container.querySelector("blockquote")).toHaveTextContent(
      "careful here",
    );
  });

  it("renders a table with its headers and cells", () => {
    render(
      <ReleaseNotes
        markdown={"| OS | Status |\n| --- | --- |\n| macOS | ok |"}
      />,
    );

    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "OS" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "macOS" })).toBeVisible();
  });

  it("renders an empty note without crashing", () => {
    const { container } = render(<ReleaseNotes markdown="" />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReleaseNotes untrusted content (AC-1, AC-9)", () => {
  it("shows raw HTML as inert text instead of parsing it", () => {
    const { container } = render(
      <ReleaseNotes markdown={"Hello <script>window.__pwned = 1</script>"} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("shows an HTML tag as visible text instead of an element", () => {
    const { container } = render(
      <ReleaseNotes markdown={'<b onclick="alert(1)">loud</b>'} />,
    );

    expect(container.querySelector("b")).toBeNull();
    expect(container).toHaveTextContent('<b onclick="alert(1)">loud</b>');
  });

  it("drops images", () => {
    const { container } = render(
      <ReleaseNotes
        markdown={"before ![tracker](https://evil.test/p.png) after"}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("before");
    expect(container).toHaveTextContent("after");
  });

  it("shows a javascript: link as plain text that does nothing", async () => {
    const user = userEvent.setup();
    render(<ReleaseNotes markdown={"[run me](javascript:alert(1))"} />);

    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByText("run me"));

    expect(opener.openUrl).not.toHaveBeenCalled();
  });

  it("shows a file: link as plain text", () => {
    render(<ReleaseNotes markdown={"[secrets](file:///etc/passwd)"} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("secrets")).toBeVisible();
  });

  it("shows an in page anchor as plain text", () => {
    render(<ReleaseNotes markdown={"[jump](#install)"} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("jump")).toBeVisible();
  });
});

describe("ReleaseNotes links (AC-9)", () => {
  it("opens an https link in the system browser, not in the app window", async () => {
    const user = userEvent.setup();
    render(<ReleaseNotes markdown={"[changelog](https://example.com/log)"} />);
    const link = screen.getByRole("link", { name: "changelog" });

    const notPrevented = link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await user.click(link);

    expect(notPrevented).toBe(false);
    await waitFor(() =>
      expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/log"),
    );
  });

  it("opens an http link too", async () => {
    const user = userEvent.setup();
    render(<ReleaseNotes markdown={"[old](http://example.com/old)"} />);

    await user.click(screen.getByRole("link", { name: "old" }));

    await waitFor(() =>
      expect(opener.openUrl).toHaveBeenCalledWith("http://example.com/old"),
    );
  });

  it("does not throw when the opener fails", async () => {
    const user = userEvent.setup();
    opener.openUrl.mockRejectedValue(new Error("no browser"));
    render(<ReleaseNotes markdown={"[docs](https://example.com)"} />);

    await user.click(screen.getByRole("link", { name: "docs" }));

    await waitFor(() => expect(opener.openUrl).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "docs" })).toBeVisible();
  });
});
