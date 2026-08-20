import { describe, expect, it } from "vitest";
import { secureCompare } from "./secureCompare";

describe("secureCompare", () => {
  it("returns true for identical strings", () => {
    expect(secureCompare("same-secret", "same-secret")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(secureCompare("secret-a", "secret-b")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(secureCompare("short", "much-much-longer-string")).toBe(false);
  });

  it("returns false comparing against an empty string", () => {
    expect(secureCompare("", "non-empty")).toBe(false);
  });

  it("returns true comparing two empty strings", () => {
    expect(secureCompare("", "")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(secureCompare("Secret", "secret")).toBe(false);
  });
});
