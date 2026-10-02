import Anthropic from "@anthropic-ai/sdk";
import { Router } from "express";
import { buildPrompt } from "../prompts/templates.js";
import { TtlCache } from "../services/cache.js";
import { RefusalError, type LlmService } from "../services/llm.js";
import { MODEL_MAP, selectTier } from "../services/model-router.js";
import { analyzeRequestSchema, type AnalyzeResult } from "../types.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MAX_TOKENS = 16000;

export function analyzeRouter(deps: {
  llm: LlmService;
  cache: TtlCache<AnalyzeResult>;
  maxInputChars: number;
}): Router {
  const router = Router();
  const schema = analyzeRequestSchema(deps.maxInputChars);

  router.post("/v1/analyze", async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId: req.requestId,
      });
      return;
    }

    const body = parsed.data;
    const tier = selectTier(body);
    const prompt = buildPrompt(body);
    const maxTokens = body.options.maxTokens ?? DEFAULT_MAX_TOKENS;
    const cacheKey = TtlCache.key([MODEL_MAP[tier], prompt, maxTokens]);

    if (body.cache) {
      const hit = deps.cache.get(cacheKey);
      if (hit) {
        res.json({ ...hit, tier, cached: true, requestId: req.requestId });
        return;
      }
    }

    try {
      const result = await deps.llm.complete(tier, prompt, maxTokens);
      if (body.cache && result.stopReason !== "max_tokens") deps.cache.set(cacheKey, result);

      logger.info("analyze", {
        requestId: req.requestId,
        clientId: req.clientId,
        task: body.task,
        tier,
        model: result.model,
        ...result.usage,
      });
      res.json({ ...result, tier, cached: false, requestId: req.requestId });
    } catch (error) {
      if (error instanceof RefusalError) {
        res.status(422).json({ error: "refused", category: error.category, requestId: req.requestId });
      } else if (error instanceof Anthropic.RateLimitError) {
        res.status(503).json({ error: "upstream_rate_limited", requestId: req.requestId });
      } else if (error instanceof Anthropic.APIError) {
        logger.error("upstream error", { requestId: req.requestId, status: error.status, message: error.message });
        res.status(502).json({ error: "upstream_error", requestId: req.requestId });
      } else {
        logger.error("unexpected error", { requestId: req.requestId, error: String(error) });
        res.status(500).json({ error: "internal_error", requestId: req.requestId });
      }
    }
  });

  return router;
}
