import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ensureString, normalizeMeetUrl } from "../lib/validators";

describe("normalizeMeetUrl", () => {
  it("accepts a canonical Google Meet URL", () => {
    const { meetUrl, meetCode } = normalizeMeetUrl("https://meet.google.com/abc-defg-hij");
    assert.equal(meetUrl, "https://meet.google.com/abc-defg-hij");
    assert.equal(meetCode, "abc-defg-hij");
  });

  it("normalizes uppercase codes to lowercase", () => {
    const { meetUrl, meetCode } = normalizeMeetUrl("https://meet.google.com/ABC-DEFG-HIJ");
    assert.equal(meetCode, "abc-defg-hij");
    assert.equal(meetUrl, "https://meet.google.com/abc-defg-hij");
  });

  it("strips query string and trailing path", () => {
    const { meetUrl } = normalizeMeetUrl(
      "https://meet.google.com/abc-defg-hij?authuser=0&pli=1"
    );
    assert.equal(meetUrl, "https://meet.google.com/abc-defg-hij");
  });

  it("rejects empty string", () => {
    assert.throws(() => normalizeMeetUrl(""), /Enter a full Google Meet URL/);
  });

  it("rejects garbage that isn't a URL", () => {
    assert.throws(() => normalizeMeetUrl("not a url"), /Enter a full Google Meet URL/);
  });

  it("rejects non-Meet hosts (SSRF guard)", () => {
    assert.throws(
      () => normalizeMeetUrl("https://evil.example.com/abc-defg-hij"),
      /Only Google Meet links are supported/
    );
  });

  it("rejects Meet URLs without a valid room code", () => {
    assert.throws(
      () => normalizeMeetUrl("https://meet.google.com/landing"),
      /standard Google Meet room/
    );
  });

  it("trims whitespace before parsing", () => {
    const { meetCode } = normalizeMeetUrl("   https://meet.google.com/abc-defg-hij   ");
    assert.equal(meetCode, "abc-defg-hij");
  });
});

describe("ensureString", () => {
  it("returns trimmed value when valid", () => {
    assert.equal(ensureString("  hello  ", "name"), "hello");
  });

  it("throws when value is missing", () => {
    assert.throws(() => ensureString(undefined, "name"), /name is required/);
  });

  it("throws when value is empty after trim", () => {
    assert.throws(() => ensureString("   ", "name"), /name is required/);
  });

  it("throws when value is wrong type", () => {
    assert.throws(() => ensureString(42 as unknown, "name"), /name is required/);
    assert.throws(() => ensureString(null as unknown, "name"), /name is required/);
  });
});
