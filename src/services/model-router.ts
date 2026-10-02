import type { Complexity, Latency } from "../types.js";

export type ModelTier = "fast" | "balanced" | "powerful";

export const MODEL_MAP = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5-5",
  powerful: "claude-opus-5-5",
} as const satisfies Record<ModelTier, string>;

export function selectTier(task: { complexity: Complexity; latency: Latency }): ModelTier {
  if (task.latency === "realtime" || task.complexity === "low") return "fast";
  if (task.complexity === "high") return "powerful";
  return "balanced";
}

export function selectModel(task: { complexity: Complexity; latency: Latency }): string {
  return MODEL_MAP[selectTier(task)];
}
