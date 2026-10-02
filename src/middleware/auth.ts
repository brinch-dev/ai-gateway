import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function apiKeyAuth(keys: Map<string, string>): RequestHandler {
  const known = [...keys].map(([secret, clientId]) => ({ hash: digest(secret), clientId }));

  return (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : req.header("x-api-key");
    if (!token) {
      res.status(401).json({ error: "missing_api_key", requestId: req.requestId });
      return;
    }

    const presented = digest(token);
    let clientId: string | undefined;
    for (const k of known) {
      if (timingSafeEqual(k.hash, presented)) clientId = k.clientId;
    }

    if (!clientId) {
      res.status(401).json({ error: "invalid_api_key", requestId: req.requestId });
      return;
    }
    req.clientId = clientId;
    next();
  };
}
