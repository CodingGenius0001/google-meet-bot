import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { __testing } from "../lib/ai";

const { resolveOllamaHost, resolveHostedLLMBaseUrl } = __testing;

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

describe("resolveHostedLLMBaseUrl (SSRF guard)", () => {
  let savedBase: string | undefined;
  let savedAllow: string | undefined;

  beforeEach(() => {
    savedBase = process.env.LLM_BASE_URL;
    savedAllow = process.env.LLM_ALLOWED_HOSTS;
  });

  afterEach(() => {
    if (savedBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = savedBase;
    if (savedAllow === undefined) delete process.env.LLM_ALLOWED_HOSTS;
    else process.env.LLM_ALLOWED_HOSTS = savedAllow;
  });

  it("defaults to Groq when unset", () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_ALLOWED_HOSTS;
    const result = resolveHostedLLMBaseUrl();
    assert.match(result, /api\.groq\.com/);
  });

  it("accepts built-in providers (openrouter)", () => {
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    assert.doesNotThrow(() => resolveHostedLLMBaseUrl());
  });

  it("rejects arbitrary hosts not on the allow-list", () => {
    process.env.LLM_BASE_URL = "https://evil.example.com/v1";
    delete process.env.LLM_ALLOWED_HOSTS;
    assert.throws(() => resolveHostedLLMBaseUrl(), /not a known provider/i);
  });

  it("rejects cloud metadata IPs", () => {
    process.env.LLM_BASE_URL = "http://169.254.169.254/latest/meta-data";
    delete process.env.LLM_ALLOWED_HOSTS;
    assert.throws(() => resolveHostedLLMBaseUrl(), /not a known provider/i);
  });

  it("allows opting in via LLM_ALLOWED_HOSTS", () => {
    process.env.LLM_BASE_URL = "https://my-private-llm.example.com/v1";
    process.env.LLM_ALLOWED_HOSTS = "my-private-llm.example.com";
    assert.doesNotThrow(() => resolveHostedLLMBaseUrl());
  });

  it("rejects file:// protocol", () => {
    process.env.LLM_BASE_URL = "file:///etc/passwd";
    delete process.env.LLM_ALLOWED_HOSTS;
    assert.throws(() => resolveHostedLLMBaseUrl(), /must be http/i);
  });

  it("rejects garbage URLs", () => {
    process.env.LLM_BASE_URL = "not a url";
    assert.throws(() => resolveHostedLLMBaseUrl(), /not a valid URL/i);
  });

  it("strips trailing slashes", () => {
    process.env.LLM_BASE_URL = "https://api.groq.com/openai/v1///";
    const result = resolveHostedLLMBaseUrl();
    assert.equal(result.endsWith("/"), false);
  });
});
