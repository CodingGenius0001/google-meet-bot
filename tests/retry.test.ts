import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { withRetry } from "../lib/retry";

describe("withRetry", () => {
  it("returns immediately on first success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts += 1;
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(attempts, 1);
  });

  it("retries failures up to attempts limit and then throws the last error", async () => {
    let attempts = 0;
    await assert.rejects(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error(`fail ${attempts}`);
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 }
      ),
      /fail 3/
    );
    assert.equal(attempts, 3);
  });

  it("succeeds after a transient failure", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new Error("transient");
        }
        return "ok";
      },
      { attempts: 4, baseDelayMs: 1, maxDelayMs: 2 }
    );
    assert.equal(result, "ok");
    assert.equal(attempts, 2);
  });

  it("does not retry when isRetryable returns false", async () => {
    let attempts = 0;
    await assert.rejects(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error("permanent");
        },
        {
          attempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 2,
          isRetryable: () => false
        }
      ),
      /permanent/
    );
    assert.equal(attempts, 1);
  });

  it("invokes onRetry callback for each retry", async () => {
    const events: number[] = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("retryme");
        }
        return "done";
      },
      {
        attempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 2,
        onRetry: (attempt) => events.push(attempt)
      }
    );
    assert.deepEqual(events, [1, 2]);
  });

  it("clamps attempts to at least 1", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        return "ok";
      },
      { attempts: 0 }
    );
    assert.equal(result, "ok");
    assert.equal(attempts, 1);
  });
});
