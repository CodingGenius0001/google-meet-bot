import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { __testing } from "../lib/storage";

const { sanitizeFileName, sanitizeJobId } = __testing;

describe("sanitizeFileName", () => {
  it("accepts a clean MP4 name", () => {
    assert.equal(sanitizeFileName("/tmp/output/job-1234567890.mp4"), "job-1234567890.mp4");
  });

  it("accepts a name with underscores and dots", () => {
    assert.equal(sanitizeFileName("recording_2026-04-07.mp4"), "recording_2026-04-07.mp4");
  });

  it("strips path traversal segments via basename", () => {
    // basename() neutralizes traversal — only the trailing file component is
    // ever considered, so "../../etc/passwd" reduces to "passwd" which is a
    // valid filename. The blob key is built from the safe basename, never
    // from the user-supplied path, so the traversal cannot escape.
    assert.equal(sanitizeFileName("../../etc/passwd"), "passwd");
  });

  it("rejects basename results that aren't pure files", () => {
    // basename of just "/" is "" which should be rejected as empty.
    assert.throws(() => sanitizeFileName("/"), /unsafe file name/);
  });

  it("rejects file names with spaces", () => {
    assert.throws(() => sanitizeFileName("my recording.mp4"), /unsupported characters/);
  });

  it("rejects file names with shell metacharacters", () => {
    assert.throws(() => sanitizeFileName("evil;rm -rf.mp4"), /unsupported characters/);
    assert.throws(() => sanitizeFileName("a$b.mp4"), /unsupported characters/);
  });

  it("rejects empty paths", () => {
    assert.throws(() => sanitizeFileName(""), /unsafe file name/);
  });

  it("rejects pure dot/dotdot", () => {
    assert.throws(() => sanitizeFileName("."), /unsafe file name/);
    assert.throws(() => sanitizeFileName(".."), /unsafe file name/);
  });

  it("strips forward-slash directory components via basename", () => {
    // basename collapses forward-slash paths to the trailing component on
    // every platform. We only assert the cross-platform behavior here.
    assert.equal(sanitizeFileName("a/b.mp4"), "b.mp4");
    assert.equal(sanitizeFileName("/var/tmp/recording-1.mp4"), "recording-1.mp4");
  });

  it("rejects unicode/non-ASCII names", () => {
    assert.throws(() => sanitizeFileName("récörding.mp4"), /unsupported characters/);
  });
});

describe("sanitizeJobId", () => {
  it("accepts cuid-style ids", () => {
    assert.equal(sanitizeJobId("clx9p7e3a0000abcd1234efgh"), "clx9p7e3a0000abcd1234efgh");
  });

  it("accepts ids with hyphens and underscores", () => {
    assert.equal(sanitizeJobId("job-abc_123"), "job-abc_123");
  });

  it("rejects ids with slashes", () => {
    assert.throws(() => sanitizeJobId("job/../etc"), /unsafe jobId/);
  });

  it("rejects ids with dots", () => {
    assert.throws(() => sanitizeJobId("job.id"), /unsafe jobId/);
  });

  it("rejects empty ids", () => {
    assert.throws(() => sanitizeJobId(""), /unsafe jobId/);
  });

  it("rejects ids with shell metacharacters", () => {
    assert.throws(() => sanitizeJobId("job;rm"), /unsafe jobId/);
    assert.throws(() => sanitizeJobId("job\nfoo"), /unsafe jobId/);
  });
});
