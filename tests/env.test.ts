import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getAllowedEmails } from "../lib/env";

describe("getAllowedEmails", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.DASHBOARD_ALLOWED_EMAILS;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DASHBOARD_ALLOWED_EMAILS;
    } else {
      process.env.DASHBOARD_ALLOWED_EMAILS = original;
    }
  });

  it("returns empty set when env var is unset", () => {
    delete process.env.DASHBOARD_ALLOWED_EMAILS;
    const allowed = getAllowedEmails();
    assert.equal(allowed.size, 0);
  });

  it("returns empty set when env var is empty", () => {
    process.env.DASHBOARD_ALLOWED_EMAILS = "";
    assert.equal(getAllowedEmails().size, 0);
  });

  it("parses a single email", () => {
    process.env.DASHBOARD_ALLOWED_EMAILS = "alice@example.com";
    const allowed = getAllowedEmails();
    assert.equal(allowed.size, 1);
    assert.ok(allowed.has("alice@example.com"));
  });

  it("parses multiple emails and lowercases them", () => {
    process.env.DASHBOARD_ALLOWED_EMAILS = "Alice@Example.com, BOB@example.com";
    const allowed = getAllowedEmails();
    assert.equal(allowed.size, 2);
    assert.ok(allowed.has("alice@example.com"));
    assert.ok(allowed.has("bob@example.com"));
  });

  it("ignores empty entries from extra commas", () => {
    process.env.DASHBOARD_ALLOWED_EMAILS = "alice@example.com,,bob@example.com,";
    const allowed = getAllowedEmails();
    assert.equal(allowed.size, 2);
  });

  it("trims whitespace around entries", () => {
    process.env.DASHBOARD_ALLOWED_EMAILS = "   alice@example.com   ,bob@example.com  ";
    const allowed = getAllowedEmails();
    assert.ok(allowed.has("alice@example.com"));
    assert.ok(allowed.has("bob@example.com"));
  });
});
