import { z } from "zod";

export const TaskType = z.enum(["summarize", "classify", "extract", "custom"]);
export type TaskType = z.infer<typeof TaskType>;

export const Complexity = z.enum(["low", "medium", "high"]);
export type Complexity = z.infer<typeof Complexity>;

export const Latency = z.enum(["realtime", "standard", "batch"]);
export type Latency = z.infer<typeof Latency>;

export function analyzeRequestSchema(maxInputChars: number) {
  return z
    .object({
      task: TaskType,
      input: z.string().min(1).max(maxInputChars),
      complexity: Complexity.default("medium"),
      latency: Latency.default("standard"),
      options: z
        .object({
          labels: z.array(z.string().min(1).max(100)).min(2).max(50).optional(),
          fields: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
          instructions: z.string().min(1).max(4000).optional(),
          maxTokens: z.number().int().min(256).max(16000).optional(),
        })
        .strict()
        .default({}),
      cache: z.boolean().default(true),
    })
    .strict()
    .superRefine((req, ctx) => {
      if (req.task === "classify" && !req.options.labels) {
        ctx.addIssue({ code: "custom", path: ["options", "labels"], message: "required for classify" });
      }
      if (req.task === "extract" && !req.options.fields) {
        ctx.addIssue({ code: "custom", path: ["options", "fields"], message: "required for extract" });
      }
      if (req.task === "custom" && !req.options.instructions) {
        ctx.addIssue({ code: "custom", path: ["options", "instructions"], message: "required for custom" });
      }
    });
}

export type AnalyzeRequest = z.infer<ReturnType<typeof analyzeRequestSchema>>;

export interface AnalyzeResult {
  result: string;
  model: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

declare global {
  namespace Express {
    interface Request {
      clientId?: string;
      requestId?: string;
    }
  }
}
