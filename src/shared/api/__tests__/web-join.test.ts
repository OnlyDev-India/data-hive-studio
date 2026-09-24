import { afterEach, describe, expect, it } from "vitest";
import {
  forgetJoinCode,
  joinCodeFromSearch,
  joinLink,
  parseJoinCode,
  pendingJoinCode,
  rememberJoinCode,
  stripJoinParam,
} from "../web-join";

const CODE = "0123456789abcdef01234567";

afterEach(() => sessionStorage.clear());

describe("joinCodeFromSearch", () => {
  it("reads a code shaped like the server's", () => {
    expect(joinCodeFromSearch(`?join=${CODE}`)).toBe(CODE);
    expect(joinCodeFromSearch(`?x=1&join=${CODE.toUpperCase()}`)).toBe(
      CODE.toUpperCase(),
    );
  });

  it("ignores a missing, short or odd value", () => {
    expect(joinCodeFromSearch("")).toBeNull();
    expect(joinCodeFromSearch("?join=")).toBeNull();
    expect(joinCodeFromSearch("?join=abc")).toBeNull();
    expect(joinCodeFromSearch(`?join=${CODE}zz`)).toBeNull();
  });
});

describe("stripJoinParam", () => {
  it("removes only the join parameter", () => {
    expect(stripJoinParam(`?join=${CODE}`)).toBe("");
    expect(stripJoinParam(`?a=1&join=${CODE}&b=2`)).toBe("a=1&b=2");
    expect(stripJoinParam("?a=1")).toBe("a=1");
  });
});

describe("parseJoinCode", () => {
  it("takes a bare code, a link, or padded text", () => {
    expect(parseJoinCode(CODE)).toBe(CODE);
    expect(parseJoinCode(`  ${CODE}\n`)).toBe(CODE);
    expect(parseJoinCode(`https://db.acme.com/?join=${CODE}`)).toBe(CODE);
    expect(parseJoinCode(`https://db.acme.com:8080/app?x=1&join=${CODE}`)).toBe(
      CODE,
    );
  });

  it("hands back anything else as typed, for the server to refuse", () => {
    expect(parseJoinCode("nonsense")).toBe("nonsense");
    expect(parseJoinCode("https://db.acme.com/")).toBe("https://db.acme.com/");
  });
});

describe("joinLink", () => {
  it("joins the address and code without a doubled slash", () => {
    expect(joinLink("https://db.acme.com", CODE)).toBe(
      `https://db.acme.com/?join=${CODE}`,
    );
    expect(joinLink("https://db.acme.com/", CODE)).toBe(
      `https://db.acme.com/?join=${CODE}`,
    );
  });
});

describe("the remembered code", () => {
  it("lives in sessionStorage until forgotten", () => {
    expect(pendingJoinCode()).toBeNull();
    rememberJoinCode(CODE);
    expect(pendingJoinCode()).toBe(CODE);
    expect(localStorage.length).toBe(0);
    forgetJoinCode();
    expect(pendingJoinCode()).toBeNull();
  });
});
