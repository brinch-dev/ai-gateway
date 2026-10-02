import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AnalyzeResult } from "../types.js";
import type { Prompt } from "../prompts/templates.js";
import { MODEL_MAP, type ModelTier } from "./model-router.js";

// Haiku 4.5 rejects `effort`; Opus 5.5 defaults to "medium", so set it explicitly.
const EFFORT: Record<ModelTier, "medium" | "high" | undefined> = {
  fast: undefined,
  balanced: "medium",
  powerful: "high",
};

export class RefusalError extends Error {
  constructor(public category: string | null) {
    super(`Model declined the request${category ? ` (${category})` : ""}`);
  }
}

export interface LlmService {
  complete(tier: ModelTier, prompt: Prompt, maxTokens: number): Promise<AnalyzeResult>;
}

export class AnthropicLlmService implements LlmService {
  constructor(private client: Anthropic = new Anthropic()) {}

  async complete(tier: ModelTier, prompt: Prompt, maxTokens: number): Promise<AnalyzeResult> {
    const effort = EFFORT[tier];
    const useFallbacks = tier !== "fast";

    const params: MessageCreateParamsNonStreaming = {
      model: MODEL_MAP[tier],
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      ...(effort && { output_config: { effort } }),
      ...(useFallbacks && { fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] }),
    };

    const response = await this.client.beta.messages.create(params);

    if (response.stop_reason === "refusal") {
      throw new RefusalError(response.stop_details?.category ?? null);
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      result: text,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
