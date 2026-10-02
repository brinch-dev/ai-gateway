import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { TtlCache } from "../src/services/cache.js";
import { RefusalError, type LlmService } from "../src/services/llm.js";
import { selectModel } from "../src/services/model-router.js";

const config: Config = {
  port: 0,
  apiKeys: new Map([["secret-a", "erp"]]),
  rateLimit: { max: 3, windowMs: 60_000 },
  cache: { ttlMs: 60_000, maxEntries: 10 },
  maxInputChars: 1000,
};

function fakeLlm(): LlmService & { complete: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn(async (tier: string) => ({
      result: `ok from ${tier}`,
      model: tier,
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    })),
  };
}

const auth = { Authorization: "Bearer secret-a" };

describe("model router", () => {
  it("routes by complexity and latency", () => {
    expect(selectModel({ complexity: "low", latency: "standard" })).toBe("claude-haiku-4-5");
    expect(selectModel({ complexity: "high", latency: "realtime" })).toBe("claude-haiku-4-5");
    expect(selectModel({ complexity: "medium", latency: "standard" })).toBe("claude-sonnet-5-5");
    expect(selectModel({ complexity: "high", latency: "batch" })).toBe("claude-opus-5-5");
  });
});

describe("TtlCache", () => {
  it("evicts least recently used entries", () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("gateway", () => {
  it("serves health without auth", async () => {
    const res = await request(createApp(config, fakeLlm())).get("/healthz");
    expect(res.status).toBe(200);
  });

  it("rejects missing and invalid keys", async () => {
    const app = createApp(config, fakeLlm());
    expect((await request(app).post("/v1/analyze").send({})).status).toBe(401);
    expect(
      (await request(app).post("/v1/analyze").set("Authorization", "Bearer nope").send({})).status,
    ).toBe(401);
  });

  it("validates task-specific options", async () => {
    const res = await request(createApp(config, fakeLlm()))
      .post("/v1/analyze")
      .set(auth)
      .send({ task: "classify", input: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.issues[0].path).toBe("options.labels");
  });

  it("rejects oversized input", async () => {
    const res = await request(createApp(config, fakeLlm()))
      .post("/v1/analyze")
      .set(auth)
      .send({ task: "summarize", input: "x".repeat(1001) });
    expect(res.status).toBe(400);
  });

  it("routes, answers and caches", async () => {
    const llm = fakeLlm();
    const app = createApp(config, llm);
    const body = { task: "summarize", input: "long text", complexity: "high" };

    const first = await request(app).post("/v1/analyze").set(auth).send(body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ tier: "powerful", cached: false });

    const second = await request(app).post("/v1/analyze").set(auth).send(body);
    expect(second.body.cached).toBe(true);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it("maps refusals to 422", async () => {
    const llm = fakeLlm();
    llm.complete.mockRejectedValueOnce(new RefusalError("cyber"));
    const res = await request(createApp(config, llm))
      .post("/v1/analyze")
      .set(auth)
      .send({ task: "summarize", input: "x", cache: false });
    expect(res.status).toBe(422);
    expect(res.body.category).toBe("cyber");
  });

  it("rate limits per client", async () => {
    const app = createApp(config, fakeLlm());
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/v1/analyze").set(auth).send({ task: "summarize", input: `t${i}` });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
