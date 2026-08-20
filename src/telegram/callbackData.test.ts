import { describe, expect, it } from "vitest";
import {
  decodeCallbackData,
  encodeNavigateCallbackData,
  isCallbackDataTooLarge,
  MAX_CALLBACK_DATA_BYTES,
  SEARCH_HELP_CALLBACK_DATA,
  TOO_LONG_CALLBACK_DATA,
} from "./callbackData";

describe("encodeNavigateCallbackData", () => {
  it("encodes the root directory", () => {
    expect(encodeNavigateCallbackData("directory", "")).toBe("d:");
  });

  it("encodes a nested directory", () => {
    expect(encodeNavigateCallbackData("directory", "networking-mastery")).toBe(
      "d:networking-mastery",
    );
  });

  it("encodes a document", () => {
    expect(
      encodeNavigateCallbackData("document", "networking-mastery/01-tcp.md"),
    ).toBe("f:networking-mastery/01-tcp.md");
  });

  it("falls back to the too-long sentinel when the path would exceed Telegram's callback_data limit", () => {
    const longPath = "a-very-long-folder-name/".repeat(5) + "file.md";
    const data = encodeNavigateCallbackData("document", longPath);
    expect(data).toBe(TOO_LONG_CALLBACK_DATA);
  });
});

describe("decodeCallbackData", () => {
  it("decodes a root directory callback", () => {
    expect(decodeCallbackData("d:")).toEqual({ type: "directory", path: "" });
  });

  it("decodes a nested directory callback", () => {
    expect(decodeCallbackData("d:networking-mastery")).toEqual({
      type: "directory",
      path: "networking-mastery",
    });
  });

  it("decodes a document callback", () => {
    expect(decodeCallbackData("f:networking-mastery/01-tcp.md")).toEqual({
      type: "document",
      path: "networking-mastery/01-tcp.md",
    });
  });

  it("decodes the search-help sentinel", () => {
    expect(decodeCallbackData(SEARCH_HELP_CALLBACK_DATA)).toEqual({
      type: "search-help",
    });
  });

  it("decodes the too-long sentinel", () => {
    expect(decodeCallbackData(TOO_LONG_CALLBACK_DATA)).toEqual({
      type: "too-long",
    });
  });

  it("treats an unrecognized prefix as invalid", () => {
    expect(decodeCallbackData("garbage")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("")).toEqual({ type: "invalid" });
  });

  it("rejects a path traversal attempt embedded in callback data", () => {
    expect(decodeCallbackData("d:../etc")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("f:../../secret.md")).toEqual({
      type: "invalid",
    });
  });

  it("rejects an absolute or drive-letter path embedded in callback data", () => {
    expect(decodeCallbackData("d:/etc")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("f:C:\\Windows\\x.md")).toEqual({
      type: "invalid",
    });
  });

  it("rejects null-byte and percent-encoded traversal attempts", () => {
    expect(decodeCallbackData("f:x.md\0.txt")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("d:%2e%2e")).toEqual({ type: "invalid" });
  });

  it("round-trips a valid path through encode then decode", () => {
    const path = "networking-mastery/protocols/tcp.md";
    const decoded = decodeCallbackData(
      encodeNavigateCallbackData("document", path),
    );
    expect(decoded).toEqual({ type: "document", path });
  });
});

describe("isCallbackDataTooLarge", () => {
  it("accepts data within the limit", () => {
    expect(isCallbackDataTooLarge("d:short")).toBe(false);
  });

  it("rejects data over MAX_CALLBACK_DATA_BYTES", () => {
    expect(
      isCallbackDataTooLarge("d:" + "x".repeat(MAX_CALLBACK_DATA_BYTES)),
    ).toBe(true);
  });
});
