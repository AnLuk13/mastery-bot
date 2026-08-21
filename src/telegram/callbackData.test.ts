import { describe, expect, it } from "vitest";
import {
  decodeCallbackData,
  encodeLimitsCallbackData,
  encodeNavigateCallbackData,
  encodeRevertCallbackData,
  isCallbackDataTooLarge,
  MAX_CALLBACK_DATA_BYTES,
  REORGANIZE_CONFIRM_CALLBACK_DATA,
  REORGANIZE_DECLINE_CALLBACK_DATA,
  SAVE_ANSWER_CALLBACK_DATA,
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

  it("appends a cleanup hint for a directory callback", () => {
    expect(
      encodeNavigateCallbackData("directory", "networking-mastery", {
        firstMessageId: 12345,
        count: 2,
      }),
    ).toBe("d:networking-mastery%12345+2");
  });

  it("appends a cleanup hint to the root path", () => {
    expect(
      encodeNavigateCallbackData("directory", "", {
        firstMessageId: 5,
        count: 1,
      }),
    ).toBe("d:%5+1");
  });

  it("omits a zero-count cleanup hint", () => {
    expect(
      encodeNavigateCallbackData("directory", "networking-mastery", {
        firstMessageId: 5,
        count: 0,
      }),
    ).toBe("d:networking-mastery");
  });

  it("drops the cleanup hint (but keeps navigation working) if adding it would exceed the callback_data limit", () => {
    const longPath = "a-very-long-folder-name/".repeat(2) + "sub";
    const withoutCleanup = encodeNavigateCallbackData("directory", longPath);
    expect(isCallbackDataTooLarge(withoutCleanup)).toBe(false);

    const withHugeCleanup = encodeNavigateCallbackData("directory", longPath, {
      firstMessageId: 999999999,
      count: 999999999,
    });
    expect(withHugeCleanup).toBe(withoutCleanup);
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

  it("decodes the save-answer sentinel", () => {
    expect(decodeCallbackData(SAVE_ANSWER_CALLBACK_DATA)).toEqual({
      type: "save-answer",
    });
  });

  it("decodes the reorganize confirm/decline sentinels", () => {
    expect(decodeCallbackData(REORGANIZE_CONFIRM_CALLBACK_DATA)).toEqual({
      type: "reorganize-confirm",
    });
    expect(decodeCallbackData(REORGANIZE_DECLINE_CALLBACK_DATA)).toEqual({
      type: "reorganize-decline",
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

  it("decodes a directory callback carrying a cleanup hint", () => {
    expect(decodeCallbackData("d:networking-mastery%12345+2")).toEqual({
      type: "directory",
      path: "networking-mastery",
      cleanup: { firstMessageId: 12345, count: 2 },
    });
  });

  it("decodes a root directory callback carrying a cleanup hint", () => {
    expect(decodeCallbackData("d:%5+1")).toEqual({
      type: "directory",
      path: "",
      cleanup: { firstMessageId: 5, count: 1 },
    });
  });

  it("round-trips a cleanup hint through encode then decode", () => {
    const cleanup = { firstMessageId: 999, count: 3 };
    const decoded = decodeCallbackData(
      encodeNavigateCallbackData("directory", "dotnet-mastery", cleanup),
    );
    expect(decoded).toEqual({
      type: "directory",
      path: "dotnet-mastery",
      cleanup,
    });
  });

  it("rejects the whole callback when the suffix after % doesn't parse as a cleanup hint (a real path can never contain %)", () => {
    expect(decodeCallbackData("d:networking-mastery%not-a-hint")).toEqual({
      type: "invalid",
    });
  });

  it("still rejects %2e%2e-style traversal even with cleanup-hint parsing in play (the regression this guards)", () => {
    expect(decodeCallbackData("d:%2e%2e")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("d:foo%2e%2e%12+1")).toEqual({ type: "invalid" });
  });

  it("rejects the whole callback (not just the cleanup hint) when the count is zero or malformed — this string never comes from our own encoder", () => {
    expect(decodeCallbackData("d:networking-mastery%123+0")).toEqual({
      type: "invalid",
    });
  });
});

describe("encodeLimitsCallbackData / decode", () => {
  it("round-trips rate limit info through encode then decode", () => {
    const rateLimit = {
      remainingRequests: 998,
      limitRequests: 1000,
      remainingTokens: 7908,
      limitTokens: 8000,
    };
    const data = encodeLimitsCallbackData(rateLimit);
    expect(data).toBe("l:998-1000-7908-8000");
    expect(decodeCallbackData(data!)).toEqual({
      type: "limits",
      rateLimit,
    });
  });

  it("rejects a malformed limits callback", () => {
    expect(decodeCallbackData("l:not-numbers")).toEqual({ type: "invalid" });
    expect(decodeCallbackData("l:1-2-3")).toEqual({ type: "invalid" });
  });
});

describe("encodeRevertCallbackData / decode", () => {
  it("round-trips a path and abbreviated commit sha through encode then decode", () => {
    const data = encodeRevertCallbackData(
      "antonio/networking/dns.md",
      "abcdef1234567890abcdef1234567890abcdef12",
    );
    expect(data).toBe("v:antonio/networking/dns.md%abcdef123456");
    expect(decodeCallbackData(data!)).toEqual({
      type: "revert",
      target: {
        path: "antonio/networking/dns.md",
        beforeCommitSha: "abcdef123456",
      },
    });
  });

  it("rejects a malformed revert callback", () => {
    expect(decodeCallbackData("v:antonio/x.md%not-hex")).toEqual({
      type: "invalid",
    });
    expect(decodeCallbackData("v:antonio/x.md")).toEqual({ type: "invalid" });
  });

  it("rejects a path traversal attempt embedded in a revert callback", () => {
    expect(decodeCallbackData("v:../etc%abcdef123456")).toEqual({
      type: "invalid",
    });
  });

  it("returns undefined when the encoded data would exceed the callback_data limit", () => {
    const longPath = "a-very-long-folder-name/".repeat(3) + "file.md";
    expect(
      encodeRevertCallbackData(longPath, "abcdef1234567890"),
    ).toBeUndefined();
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
