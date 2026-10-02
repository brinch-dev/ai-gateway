import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../utils/logger.js";

// Logs metadata only; request/response bodies may contain business data.
export const requestLogging: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  res.on("finish", () => {
    logger.info("request", {
      requestId: req.requestId,
      clientId: req.clientId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    });
  });
  next();
};
