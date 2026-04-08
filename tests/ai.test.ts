import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { __testing } from "../lib/ai";

const { resolveOllamaHost } = __testing;

describe("resolveOllamaHost (SSRF guard)", () => {
  let savedHost: string | undefined;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedHost = process.env.OLLAMA_HOST;
    savedAllow = process.env.OLLAMA_ALLOWED_HOSTS;
  });

  afterEach(() => {
    if (savedHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = savedHost;
    if (savedAllow === undefined) delete process.env.OLLAMA_ALLOWED_HOSTS;
    else process.env.OLLAMA_ALLOWED_HOSTS = savedAllow;
  });

  it("defaults to localhost when env var is unset", () => {
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    const result = resolveOllamaHost();
    assert.match(result ?? "", /127\.0\.0\.1:11434/);
  });

  it("accepts http://localhost", () => {
    process.env.OLLAMA_HOST = "http://localhost:11434";
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    assert.match(resolveOllamaHost() ?? "", /localhost/);
  });

  it("accepts ::1 loopback", () => {
    process.env.OLLAMA_HOST = "http://[::1]:11434";
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    assert.ok(resolveOllamaHost());
  });

  it("rejects cloud metadata IP", () => {
    process.env.OLLAMA_HOST = "http://169.254.169.254/api";
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    assert.throws(() => resolveOllamaHost(), /not allowed/i);
  });

  it("rejects arbitrary internet host", () => {
    process.env.OLLAMA_HOST = "http://evil.example.com:11434";
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    assert.throws(() => resolveOllamaHost(), /not allowed/i);
  });

  it("accepts arbitrary host when explicitly allow-listed", () => {
    process.env.OLLAMA_HOST = "https://ollama.internal.corp:11434";
    process.env.OLLAMA_ALLOWED_HOSTS = "ollama.internal.corp";
    assert.ok(resolveOllamaHost());
  });

  it("rejects file:// protocol", () => {
    process.env.OLLAMA_HOST = "file:///etc/passwd";
    delete process.env.OLLAMA_ALLOWED_HOSTS;
    assert.throws(() => resolveOllamaHost(), /must be http/i);
  });

  it("rejects garbage URLs", () => {
    process.env.OLLAMA_HOST = "not a url";
    assert.throws(() => resolveOllamaHost(), /not a valid URL/i);
  });

  it("strips trailing slashes", () => {
    process.env.OLLAMA_HOST = "http://localhost:11434/////";
    const result = resolveOllamaHost();
    assert.equal(result?.endsWith("/"), false);
  });
});
