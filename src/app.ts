import express, { type ErrorRequestHandler } from "express";
import type { Config } from "./config.js";
import { apiKeyAuth } from "./middleware/auth.js";
import { requestLogging } from "./middleware/logging.js";
import { perClientRateLimit } from "./middleware/rate-limit.js";
import { analyzeRouter } from "./routes/analyze.js";
import { healthRouter } from "./routes/health.js";
import { TtlCache } from "./services/cache.js";
import type { LlmService } from "./services/llm.js";
import type { AnalyzeResult } from "./types.js";

export function createApp(config: Config, llm: LlmService) {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestLogging);
  app.use(healthRouter());

  app.use(apiKeyAuth(config.apiKeys));
  app.use(perClientRateLimit(config.rateLimit.max, config.rateLimit.windowMs));
  // Body limit leaves headroom over maxInputChars for JSON escaping and options.
  app.use(express.json({ limit: config.maxInputChars * 4 + 16_384 }));

  app.use(
    analyzeRouter({
      llm,
      cache: new TtlCache<AnalyzeResult>(config.cache.ttlMs, config.cache.maxEntries),
      maxInputChars: config.maxInputChars,
    }),
  );

  app.use((req, res) => {
    res.status(404).json({ error: "not_found", requestId: req.requestId });
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const status = typeof err?.status === "number" && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "internal_error" : "bad_request", requestId: req.requestId });
  };
  app.use(onError);

  return app;
}
