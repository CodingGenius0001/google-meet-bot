import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { isEmailAllowed } from "../lib/auth";

describe("isEmailAllowed", () => {
  it("rejects null/undefined emails", () => {
    assert.equal(isEmailAllowed(null, new Set(["alice@example.com"])), false);
    assert.equal(isEmailAllowed(undefined, new Set(["alice@example.com"])), false);
    assert.equal(isEmailAllowed("", new Set(["alice@example.com"])), false);
  });

  it("rejects all emails when allow list is empty (fail closed)", () => {
    assert.equal(isEmailAllowed("alice@example.com", new Set()), false);
  });

  it("matches case insensitively", () => {
    const allowed = new Set(["alice@example.com"]);
    assert.equal(isEmailAllowed("Alice@Example.com", allowed), true);
    assert.equal(isEmailAllowed("ALICE@EXAMPLE.COM", allowed), true);
  });

  it("trims whitespace before matching", () => {
    const allowed = new Set(["alice@example.com"]);
    assert.equal(isEmailAllowed("  alice@example.com  ", allowed), true);
  });

  it("rejects emails not on the list", () => {
    const allowed = new Set(["alice@example.com"]);
    assert.equal(isEmailAllowed("bob@example.com", allowed), false);
    assert.equal(isEmailAllowed("alice@evil.com", allowed), false);
  });
});
