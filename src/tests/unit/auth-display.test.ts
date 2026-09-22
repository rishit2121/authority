import { describe, expect, it } from "vitest";

import { initialsFor } from "@/lib/auth/display";

describe("initialsFor", () => {
  it("uses first and last initials of a full name", () => {
    expect(initialsFor("Maya Okafor", "maya@northwind.example")).toBe("MO");
    expect(initialsFor("Ada Lovelace King", "ada@example.com")).toBe("AK");
  });

  it("uses the first two letters of a single name", () => {
    expect(initialsFor("Prince", "prince@example.com")).toBe("PR");
  });

  it("falls back to the email when there is no display name", () => {
    expect(initialsFor("", "devi@example.com")).toBe("DE");
    expect(initialsFor("   ", "devi@example.com")).toBe("DE");
  });

  it("returns a placeholder rather than an empty chip", () => {
    expect(initialsFor("", "")).toBe("?");
    expect(initialsFor("   ", "  ")).toBe("?");
  });

  it("collapses extra whitespace", () => {
    expect(initialsFor("  Maya   Okafor  ", "m@example.com")).toBe("MO");
  });

  it("never returns more than two characters", () => {
    for (const name of ["Maya Okafor", "A B C D E F", "Prince", "", "Ada"]) {
      expect(initialsFor(name, "x@example.com").length).toBeLessThanOrEqual(2);
    }
  });

  it("uppercases a lowercase name", () => {
    expect(initialsFor("maya okafor", "m@example.com")).toBe("MO");
  });
});
