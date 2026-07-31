import { describe, expect, it } from "vitest";

import { cn, firstOfMonth, initials } from "./utils";

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2", false, "px-4", { block: true })).toBe("px-4 block");
  });
});

describe("firstOfMonth", () => {
  it("formats the first day of a month with zero padding", () => {
    expect(firstOfMonth(new Date(2025, 0, 31))).toBe("2025-01-01");
    expect(firstOfMonth(new Date(2025, 10, 2))).toBe("2025-11-01");
  });
});

describe("initials", () => {
  it("handles names, email addresses, and missing values", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("grace.hopper@example.com")).toBe("GH");
    expect(initials("Plato")).toBe("PL");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});
